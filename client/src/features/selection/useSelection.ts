import type {
  EdgeMouseEvent,
  NodeChange,
  NodeDragEvent,
  NodeMouseEvent
} from "@vue-flow/core";
import { computed, nextTick } from "vue";
import type { SyncNode } from "@vue-flow-sync/shared";
import type { JsonOp } from "sharedb/lib/client";
import {
  createGraphCache,
  getRenderedNodeBounds,
  withDefaultEdges,
  type FlowEdge
} from "../../domain/graph";
import type { FlowEditorServices } from "../../app/flowEditorServices";
import type { FlowRuntime } from "../../flowRuntime";
import { useSelectionMove } from "./useSelectionMove";
import { useSelectionOverlayModel } from "./useSelectionOverlayModel";
import { areSelectionIdsEqual, useSelectionState } from "./useSelectionState";

type LassoNodeBounds = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type LassoPointerRect = {
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
};

const nodeInteractiveSelector =
  "input, textarea, button, label, select, [contenteditable], [data-node-interactive]";
const nodeMoveBlockedSelector =
  `${nodeInteractiveSelector}, .vue-flow__handle, .vue-flow__resize-control, .node-resizer-layer`;

export function useSelection(runtime: FlowRuntime, services: FlowEditorServices) {
  let lassoBoundsCache: LassoNodeBounds[] = [];
  let pendingLassoRect: LassoPointerRect | null = null;
  let lassoPanelOrigin = { left: 0, top: 0 };
  let lassoPointerCaptureTarget: HTMLElement | null = null;
  let lassoSelectionBox: HTMLDivElement | null = null;
  let hasPendingCursorClientPoint = false;
  let pendingCursorClientX = 0;
  let pendingCursorClientY = 0;
  let cursorCoordinateFrame: number | undefined;

  const selectionOverlay = useSelectionOverlayModel(runtime, services);
  const {
    getSelectedClientBounds,
    isPointInsideSelectedBounds,
    isSingleNodeSelection,
    selectedBoundsStyle
  } = selectionOverlay;

  const lassoPreviewRects = computed(() => {
    if (!runtime.isLassoSelecting.value || runtime.lassoPreviewNodeIds.value.size === 0) {
      return [];
    }

    const viewport = runtime.currentViewport.value;
    const previewIds = runtime.lassoPreviewNodeIds.value;
    const rects: Array<{ id: string; style: Record<string, string> }> = [];

    for (const bounds of lassoBoundsCache) {
      if (!previewIds.has(bounds.id)) {
        continue;
      }

      rects.push({
        id: bounds.id,
        style: {
          left: `${bounds.x * viewport.zoom + viewport.x}px`,
          top: `${bounds.y * viewport.zoom + viewport.y}px`,
          width: `${bounds.width * viewport.zoom}px`,
          height: `${bounds.height * viewport.zoom}px`
        }
      });
    }

    return rects;
  });

  const selectionState = useSelectionState(runtime, services);
  const {
    clearNodeSelection,
    getSelectedNodeIds,
    isNodeSelected,
    selectOnlyNode,
    setSelectedNodes
  } = selectionState;
  const selectionMove = useSelectionMove(runtime, services, {
    getSelectedNodeIds
  });

  function getCurrentSyncNodes() {
    return services.getCurrentSyncNodes();
  }

  function submitOperation(operation: JsonOp[]) {
    services.submitOperation(operation);
  }

  function scheduleSelectionBoundsRefresh() {
    services.scheduleSelectionBoundsRefresh();
  }

  function closeContextMenu() {
    services.closeContextMenu();
  }

  function setLassoPreviewNodes(nodeIds: string[]) {
    if (areSelectionIdsEqual(runtime.lassoPreviewNodeIds.value, nodeIds)) {
      return;
    }

    runtime.lassoPreviewNodeIds.value = new Set(nodeIds);
  }

  function ensureLassoSelectionBox() {
    if (lassoSelectionBox) {
      return lassoSelectionBox;
    }

    lassoSelectionBox = document.createElement("div");
    lassoSelectionBox.className = "right-drag-selection";
    document.body.appendChild(lassoSelectionBox);

    return lassoSelectionBox;
  }

  function paintLassoSelectionBox(selection: NonNullable<typeof runtime.rightSelection.value>) {
    const element = ensureLassoSelectionBox();

    const left = Math.min(selection.startClientX, selection.currentClientX);
    const top = Math.min(selection.startClientY, selection.currentClientY);
    const width = Math.abs(selection.currentClientX - selection.startClientX);
    const height = Math.abs(selection.currentClientY - selection.startClientY);

    element.style.display = "block";
    element.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
  }

  function resetLassoSelectionBox() {
    const element = lassoSelectionBox;

    if (!element) {
      return;
    }

    element.style.display = "none";
    element.style.transform = "translate3d(0, 0, 0)";
    element.style.width = "0px";
    element.style.height = "0px";
  }

  function removeLassoSelectionBox() {
    lassoSelectionBox?.remove();
    lassoSelectionBox = null;
  }

  function isNodeInteractiveTarget(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest(nodeInteractiveSelector));
  }

  function isNodeMoveBlockedTarget(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest(nodeMoveBlockedSelector));
  }

  function getNodeElementFromTarget(target: EventTarget | null) {
    return target instanceof Element
      ? target.closest<HTMLElement>(".vue-flow__node[data-id]")
      : null;
  }

  function getCachedFlowCoordinate(clientX: number, clientY: number) {
    const bounds = runtime.canvasClientBounds.value;
    const viewport = runtime.currentViewport.value;

    if (!bounds || bounds.width <= 0 || bounds.height <= 0 || viewport.zoom <= 0) {
      return runtime.screenToFlowCoordinate({ x: clientX, y: clientY });
    }

    return {
      x: (clientX - bounds.left - viewport.x) / viewport.zoom,
      y: (clientY - bounds.top - viewport.y) / viewport.zoom
    };
  }

  function handleNodeClick(payload: NodeMouseEvent) {
    if (!runtime.isLoggedIn.value) {
      return;
    }

    if (isNodeInteractiveTarget(payload.event.target)) {
      return;
    }

    if (Date.now() < runtime.interaction.ignoreVueFlowSelectionUntil) {
      if (payload.event instanceof MouseEvent) {
        payload.event.stopPropagation();
      }

      return;
    }

    const selectedIds = getSelectedNodeIds();

    if (selectedIds.length > 1 && selectedIds.includes(payload.node.id)) {
      if (payload.event instanceof MouseEvent) {
        payload.event.stopPropagation();
      }

      runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350;
      setSelectedNodes(selectedIds);
      return;
    }

    setSelectedNodes([payload.node.id]);
  }

  function handleEdgeClick(payload: EdgeMouseEvent) {
    if (!runtime.isLoggedIn.value) {
      return;
    }

    clearNodeSelection();
    runtime.edges.value = runtime.edges.value.map((edge) => ({
      ...edge,
      selected: edge.id === payload.edge.id
    })) as unknown as FlowEdge[];
  }

  function handleNodeDragStart(payload: NodeDragEvent) {
    if (!runtime.isLoggedIn.value) {
      return;
    }

    const selectedIds = getSelectedNodeIds();

    if (selectedIds.length > 1 && selectedIds.includes(payload.node.id)) {
      runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350;
      selectionMove.handleSectionNodeDragStart(payload.node.id);
      return;
    }

    setSelectedNodes([payload.node.id]);
    runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350;
    selectionMove.handleSectionNodeDragStart(payload.node.id);
  }

  function handleNodeDragStop() {
    selectionMove.clearSectionNodeDragPreview();
  }

  function deleteSelectedElements() {
    if (!runtime.isLoggedIn.value) {
      return;
    }

    const activeElement = document.activeElement;

    if (
      activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement
    ) {
      return;
    }

    const selectedNodeIds = getSelectedNodeIds();
    const selectedEdgeIds: string[] = [];

    runtime.edges.value.forEach((edge) => {
      if ((edge as FlowEdge & { selected?: boolean }).selected) {
        selectedEdgeIds.push(edge.id);
      }
    });
    const flowDocumentValue = runtime.flowDocument.value;

    if (!flowDocumentValue) {
      return;
    }

    if (selectedNodeIds.length > 0) {
      services.deleteNodesById(selectedNodeIds);
      return;
    }

    if (selectedEdgeIds.length > 0) {
      const selectedEdgeSet = new Set(selectedEdgeIds);
      const nextEdges = flowDocumentValue.data.edges.filter(
        (edge) => !selectedEdgeSet.has(edge.id)
      );

      runtime.edges.value = withDefaultEdges(
        nextEdges,
        createGraphCache(getCurrentSyncNodes(), nextEdges)
      );
      submitOperation([
        {
          p: ["edges"],
          od: flowDocumentValue.data.edges,
          oi: nextEdges
        }
      ]);
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "Delete" && event.key !== "Backspace") {
      return;
    }

    deleteSelectedElements();
  }

  function handleNodesChange(changes: NodeChange[]) {
    if (
      !runtime.interaction.selectionMoveDrag &&
      changes.some((change) => change.type === "dimensions" || change.type === "position")
    ) {
      nextTick(() => {
        scheduleSelectionBoundsRefresh();
      });
    }

    if (changes.some((change) => change.type === "select")) {
      if (
        runtime.rightSelection.value ||
        runtime.isLassoSelecting.value ||
        runtime.interaction.suppressNextContextMenu ||
        Date.now() < runtime.interaction.ignoreVueFlowSelectionUntil
      ) {
        return;
      }

      nextTick(() => {
        scheduleSelectionBoundsRefresh();
        services.updatePresenceSelection();
      });
    }
  }

  function isCanvasSelectionTarget(target: EventTarget | null) {
    if (!(target instanceof Element)) {
      return false;
    }

    return !target.closest(
      ".vue-flow__node, .vue-flow__edge, .vue-flow__minimap, .vue-flow__resize-control, .selected-nodes-outline, .selected-bounds-hit, .context-menu, input, textarea, button, label"
    );
  }

  function isSelectionOverlayTarget(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest(".selected-nodes-outline"));
  }

  function rebuildLassoBoundsCache() {
    const graphNodes = getCurrentSyncNodes();
    const graph = createGraphCache(graphNodes);

    lassoBoundsCache = graphNodes.map((node) => {
      const bounds = getRenderedNodeBounds(node, graph);

      return {
        id: node.id,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      };
    });
  }

  function hasGraphBoundsOverlap(
    nodeBounds: LassoNodeBounds,
    selectionBounds: { x: number; y: number; width: number; height: number }
  ) {
    return (
      Math.min(nodeBounds.x + nodeBounds.width, selectionBounds.x + selectionBounds.width) >
        Math.max(nodeBounds.x, selectionBounds.x) &&
      Math.min(nodeBounds.y + nodeBounds.height, selectionBounds.y + selectionBounds.height) >
        Math.max(nodeBounds.y, selectionBounds.y)
    );
  }

  function getFlowSelectionBounds(rect: LassoPointerRect) {
    const viewport = runtime.currentViewport.value;
    const localLeft = Math.min(rect.startClientX, rect.currentClientX) - lassoPanelOrigin.left;
    const localTop = Math.min(rect.startClientY, rect.currentClientY) - lassoPanelOrigin.top;
    const localRight = Math.max(rect.startClientX, rect.currentClientX) - lassoPanelOrigin.left;
    const localBottom = Math.max(rect.startClientY, rect.currentClientY) - lassoPanelOrigin.top;

    return {
      x: (localLeft - viewport.x) / viewport.zoom,
      y: (localTop - viewport.y) / viewport.zoom,
      width: (localRight - localLeft) / viewport.zoom,
      height: (localBottom - localTop) / viewport.zoom
    };
  }

  function getLassoSelectedIds(rect: LassoPointerRect) {
    const selectionBounds = getFlowSelectionBounds(rect);
    const selectedIds: string[] = [];

    for (const bounds of lassoBoundsCache) {
      if (hasGraphBoundsOverlap(bounds, selectionBounds)) {
        selectedIds.push(bounds.id);
      }
    }

    return selectedIds;
  }

  function updateLassoPreview(rect: LassoPointerRect) {
    setLassoPreviewNodes(getLassoSelectedIds(rect));
    runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350;
  }

  function scheduleLassoPreview(rect: LassoPointerRect) {
    pendingLassoRect = rect;

    if (runtime.timers.lassoSelectionFrame) {
      return;
    }

    runtime.timers.lassoSelectionFrame = window.requestAnimationFrame(() => {
      runtime.timers.lassoSelectionFrame = undefined;
      const nextRect = pendingLassoRect;
      pendingLassoRect = null;

      if (nextRect) {
        updateLassoPreview(nextRect);
      }
    });
  }

  function flushLassoPreview(fallbackRect: LassoPointerRect) {
    if (runtime.timers.lassoSelectionFrame) {
      window.cancelAnimationFrame(runtime.timers.lassoSelectionFrame);
      runtime.timers.lassoSelectionFrame = undefined;
    }

    const nextRect = pendingLassoRect ?? fallbackRect;
    pendingLassoRect = null;
    updateLassoPreview(nextRect);
  }

  function clearLassoPreview() {
    if (runtime.timers.lassoSelectionFrame) {
      window.cancelAnimationFrame(runtime.timers.lassoSelectionFrame);
      runtime.timers.lassoSelectionFrame = undefined;
    }

    pendingLassoRect = null;
    lassoBoundsCache = [];
    runtime.isLassoSelecting.value = false;
    runtime.lassoPreviewNodeIds.value = new Set();
    resetLassoSelectionBox();
  }

  function handleCanvasPointerDown(event: PointerEvent) {
    const activeElement = document.activeElement;

    const targetIsEditor =
      event.target instanceof Element && Boolean(event.target.closest("input, textarea"));

    if (
      !targetIsEditor &&
      (activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement)
    ) {
      activeElement.blur();
    }

    if (!runtime.isLoggedIn.value || runtime.pendingCreate.value || event.button !== 0) {
      return;
    }

    const selectedIds = getSelectedNodeIds();
    const isResizeTarget =
      event.target instanceof Element && Boolean(event.target.closest(".vue-flow__resize-control"));

    if (isResizeTarget) {
      runtime.isResizingNode.value = true;
      runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350;
      return;
    }

    const selectedNodeElement = getNodeElementFromTarget(event.target);

    if (selectedNodeElement?.dataset.id) {
      const nodeId = selectedNodeElement.dataset.id;
      const shouldMoveSelection = selectedIds.length > 1 && selectedIds.includes(nodeId);

      if (isNodeMoveBlockedTarget(event.target)) {
        return;
      }

      if (!shouldMoveSelection) {
        setSelectedNodes([nodeId]);
      }

      runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350;
      closeContextMenu();
      selectionMove.beginNodePointerMove(event, nodeId);
      return;
    }

    const selectedBounds = getSelectedClientBounds();

    if (
      selectedIds.length > 1 &&
      selectedBounds &&
      (isCanvasSelectionTarget(event.target) || isSelectionOverlayTarget(event.target)) &&
      event.clientX >= selectedBounds.left &&
      event.clientX <= selectedBounds.right &&
      event.clientY >= selectedBounds.top &&
      event.clientY <= selectedBounds.bottom
    ) {
      selectionMove.handleSelectedBoundsPointerDown(event);
      return;
    }

    if (!isCanvasSelectionTarget(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    closeContextMenu();
    runtime.interaction.suppressNextContextMenu = false;

    const panel = event.currentTarget as HTMLElement;
    const rect = panel.getBoundingClientRect();
    lassoPanelOrigin = { left: rect.left, top: rect.top };
    lassoPointerCaptureTarget = panel;
    if (typeof panel.setPointerCapture === "function") {
      try {
        panel.setPointerCapture(event.pointerId);
      } catch {
        lassoPointerCaptureTarget = null;
      }
    }
    rebuildLassoBoundsCache();
    runtime.isLassoSelecting.value = true;
    runtime.lassoPreviewNodeIds.value = new Set();
    runtime.rightSelection.value = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      startLocalX: event.clientX - rect.left,
      startLocalY: event.clientY - rect.top,
      currentLocalX: event.clientX - rect.left,
      currentLocalY: event.clientY - rect.top
    };
    paintLassoSelectionBox(runtime.rightSelection.value);
    window.addEventListener("pointermove", handleRightSelectionMove, { capture: true });
    window.addEventListener("pointerup", handleRightSelectionEnd, { capture: true, once: true });
  }

  function scheduleCoalescedCursorUpdate(clientX: number, clientY: number) {
    hasPendingCursorClientPoint = true;
    pendingCursorClientX = clientX;
    pendingCursorClientY = clientY;

    if (cursorCoordinateFrame) {
      return;
    }

    cursorCoordinateFrame = window.requestAnimationFrame(() => {
      cursorCoordinateFrame = undefined;
      const shouldUpdateCursor = hasPendingCursorClientPoint;
      const nextClientX = pendingCursorClientX;
      const nextClientY = pendingCursorClientY;
      hasPendingCursorClientPoint = false;

      if (!shouldUpdateCursor || !runtime.isLoggedIn.value) {
        return;
      }

      services.scheduleCursorUpdate(getCachedFlowCoordinate(nextClientX, nextClientY));
    });
  }

  function handleRightSelectionMove(event: PointerEvent) {
    const selection = runtime.rightSelection.value;

    if (!selection) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    selection.currentClientX = event.clientX;
    selection.currentClientY = event.clientY;
    selection.currentLocalX = event.clientX - lassoPanelOrigin.left;
    selection.currentLocalY = event.clientY - lassoPanelOrigin.top;
    paintLassoSelectionBox(selection);

    if (
      Math.abs(selection.currentClientX - selection.startClientX) > 4 ||
      Math.abs(selection.currentClientY - selection.startClientY) > 4
    ) {
      runtime.interaction.suppressNextContextMenu = true;
      scheduleLassoPreview({
        startClientX: selection.startClientX,
        startClientY: selection.startClientY,
        currentClientX: selection.currentClientX,
        currentClientY: selection.currentClientY
      });
    }
  }

  function handleRightSelectionEnd(event: PointerEvent) {
    window.removeEventListener("pointermove", handleRightSelectionMove, true);

    const selection = runtime.rightSelection.value;
    runtime.rightSelection.value = null;
    resetLassoSelectionBox();
    if (lassoPointerCaptureTarget?.hasPointerCapture(event.pointerId)) {
      lassoPointerCaptureTarget.releasePointerCapture(event.pointerId);
    }
    lassoPointerCaptureTarget = null;

    if (!selection) {
      return;
    }

    if (!runtime.interaction.suppressNextContextMenu) {
      clearLassoPreview();
      setSelectedNodes([]);
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    flushLassoPreview({
      startClientX: selection.startClientX,
      startClientY: selection.startClientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY
    });
    setSelectedNodes(Array.from(runtime.lassoPreviewNodeIds.value));
    clearLassoPreview();
    runtime.interaction.suppressNextContextMenu = false;
  }

  function handleCanvasPointerMove(event: PointerEvent) {
    if (!runtime.isLoggedIn.value) {
      return;
    }

    const shouldCheckSelectionBounds =
      runtime.selectedNodeIds.value.size > 1 &&
      !runtime.interaction.selectionMoveDrag &&
      isCanvasSelectionTarget(event.target);
    const nextIsHoveringSelection =
      shouldCheckSelectionBounds && isPointInsideSelectedBounds(event);

    if (runtime.isHoveringSelection.value !== nextIsHoveringSelection) {
      runtime.isHoveringSelection.value = nextIsHoveringSelection;
    }

    scheduleCoalescedCursorUpdate(event.clientX, event.clientY);
  }

  function handleCanvasPointerLeave() {
    if (runtime.isHoveringSelection.value) {
      runtime.isHoveringSelection.value = false;
    }
  }

  function cleanupSelection() {
    window.removeEventListener("pointermove", handleRightSelectionMove, true);
    window.removeEventListener("pointerup", handleRightSelectionEnd, true);
    selectionMove.cleanupSelectionMove();
    if (cursorCoordinateFrame) {
      window.cancelAnimationFrame(cursorCoordinateFrame);
      cursorCoordinateFrame = undefined;
    }
    hasPendingCursorClientPoint = false;
    lassoPointerCaptureTarget = null;
    clearLassoPreview();
    removeLassoSelectionBox();
  }

  return {
    cleanupSelection,
    deleteSelectedElements,
    getSelectedClientBounds,
    getSelectedNodeIds,
    handleCanvasPointerDown,
    handleCanvasPointerLeave,
    handleCanvasPointerMove,
    handleKeyDown,
    handleEdgeClick,
    handleNodeClick,
    handleNodeDragStart,
    handleNodeDragStop,
    handleNodesChange,
    handleSelectedBoundsPointerDown: selectionMove.handleSelectedBoundsPointerDown,
    isCanvasSelectionTarget,
    isNodeSelected,
    isSingleNodeSelection,
    lassoPreviewRects,
    selectOnlyNode,
    selectionMovePreview: selectionMove.selectionMovePreview,
    selectedBoundsStyle,
    setSelectedNodes
  };
}



