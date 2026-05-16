import type {
  EdgeMouseEvent,
  NodeChange,
  NodeDragEvent,
  NodeDragItem,
  NodeMouseEvent
} from "@vue-flow/core";
import { computed, nextTick } from "vue";
import type { SyncEdge, SyncNode } from "@vue-flow-sync/shared";
import type { JsonOp } from "sharedb/lib/client";
import {
  applySectionMembershipForMovedNode,
  createGraphCache,
  getAbsolutePosition,
  getNodeBounds,
  getNodeSize,
  getRenderedNodeBounds,
  normalizeNode,
  sameJson,
  stripParentExtent,
  withDefaultEdges,
  type FlowEdge,
  type FlowNode
} from "./graph";
import type { FlowRuntime } from "./flowRuntime";
import type { SelectionMoveDrag } from "./flowTypes";

type LargeSelectionMovePreviewMode = "bundle" | "visible";

const largeSelectionMovePreviewMode: LargeSelectionMovePreviewMode = "bundle";
const largeSelectionMovePreviewThreshold = 8;
const hideSelectedNodesDuringBundleMove = true;
const maxSelectionMovePreviewShapes = 36;
const selectionMovePreviewShapeIndexes = Array.from(
  { length: maxSelectionMovePreviewShapes },
  (_, index) => index
);

function getAction<T>(runtime: FlowRuntime, name: string) {
  return runtime.actions[name] as T;
}

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

export function useSelection(runtime: FlowRuntime) {
  let lassoBoundsCache: LassoNodeBounds[] = [];
  let pendingLassoRect: LassoPointerRect | null = null;
  let lassoPanelOrigin = { left: 0, top: 0 };
  let lassoPointerCaptureTarget: HTMLElement | null = null;
  let lassoSelectionBox: HTMLDivElement | null = null;
  let selectionMovePointerCaptureTarget: HTMLElement | null = null;
  let selectionMovePreviewElement: HTMLElement | null = null;
  let selectionMoveHiddenElements: Array<{
    element: HTMLElement;
    pointerEvents: string;
    visibility: string;
  }> = [];
  let hasPendingCursorClientPoint = false;
  let pendingCursorClientX = 0;
  let pendingCursorClientY = 0;
  let cursorCoordinateFrame: number | undefined;

  const selectedBoundsStyle = computed<Record<string, string> | null>(() => {
    if (
      !runtime.isLoggedIn.value ||
      runtime.rightSelection.value ||
      runtime.selectedNodeIds.value.size < 2
    ) {
      return null;
    }

    const selectionMoveDrag = runtime.interaction.selectionMoveDrag;
    if (selectionMoveDrag?.selectedBounds) {
      runtime.selectionBoundsVersion.value;

      return {
        left: `${selectionMoveDrag.selectedBounds.left}px`,
        top: `${selectionMoveDrag.selectedBounds.top}px`,
        width: `${selectionMoveDrag.selectedBounds.width}px`,
        height: `${selectionMoveDrag.selectedBounds.height}px`
      };
    }

    runtime.selectionBoundsVersion.value;
    const graphNodes = getCurrentSyncNodes();
    const graph = createGraphCache(graphNodes);
    const selectedIds = runtime.selectedNodeIds.value;
    const viewport = runtime.currentViewport.value;
    let selectedCount = 0;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const node of graphNodes) {
      if (!selectedIds.has(node.id)) {
        continue;
      }

      const bounds = getNodeBounds(node, graph);
      const x = bounds.x * viewport.zoom + viewport.x;
      const y = bounds.y * viewport.zoom + viewport.y;
      const width = bounds.width * viewport.zoom;
      const height = bounds.height * viewport.zoom;

      selectedCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + height);
    }

    if (selectedCount === 0) {
      return null;
    }

    const padding = 4;

    return {
      left: `${minX - padding}px`,
      top: `${minY - padding}px`,
      width: `${maxX - minX + padding * 2}px`,
      height: `${maxY - minY + padding * 2}px`
    };
  });

  const isSingleNodeSelection = computed(() => runtime.selectedNodeIds.value.size <= 1);

  const selectionMovePreview = computed(() => {
    const selectionMoveDrag = runtime.interaction.selectionMoveDrag;

    if (
      !runtime.isMovingSelection.value ||
      selectionMoveDrag?.mode !== "bundle" ||
      selectionMoveDrag.movingIndexes.length === 0
    ) {
      return {
        active: false,
        count: 0,
        shapes: [] as number[]
      };
    }

    return {
      active: true,
      count: selectionMoveDrag.movingIndexes.length,
      shapes: selectionMovePreviewShapeIndexes.slice(
        0,
        Math.min(selectionMoveDrag.movingIndexes.length, maxSelectionMovePreviewShapes)
      )
    };
  });

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

  function getCurrentSyncNodes() {
    return getAction<() => SyncNode[]>(runtime, "getCurrentSyncNodes")();
  }

  function getCurrentSyncEdges(nextNodes?: SyncNode[]) {
    return getAction<(nodes?: SyncNode[]) => SyncEdge[]>(runtime, "getCurrentSyncEdges")(
      nextNodes
    );
  }

  function submitOperation(operation: JsonOp[]) {
    getAction<(operation: JsonOp[]) => void>(runtime, "submitOperation")(operation);
  }

  function submitGraphSnapshot() {
    getAction<() => void>(runtime, "submitGraphSnapshot")();
  }

  function scheduleSelectionBoundsRefresh() {
    getAction<() => void>(runtime, "scheduleSelectionBoundsRefresh")();
  }

  function updatePresenceSelection() {
    getAction<() => void>(runtime, "updatePresenceSelection")();
  }

  function closeContextMenu() {
    getAction<() => void>(runtime, "closeContextMenu")();
  }

  function withSelectionState(nodes: FlowNode[]) {
    return getAction<(nodes: FlowNode[]) => FlowNode[]>(runtime, "withSelectionState")(nodes);
  }

  function getSelectedNodeIds() {
    return Array.from(runtime.selectedNodeIds.value);
  }

  function clearEdgeSelection() {
    let changed = false;
    const nextEdges = runtime.edges.value.map((edge) => {
      if ((edge as FlowEdge & { selected?: boolean }).selected) {
        changed = true;
        return { ...edge, selected: false } as unknown as FlowEdge;
      }

      return edge;
    });

    if (changed) {
      runtime.edges.value = nextEdges;
    }
  }

  function clearNodeSelection() {
    if (runtime.selectedNodeIds.value.size === 0) {
      return;
    }

    runtime.selectedNodeIds.value = new Set();
    nextTick(() => {
      scheduleSelectionBoundsRefresh();
      updatePresenceSelection();
    });
  }

  function isNodeSelected(nodeId: string) {
    return runtime.selectedNodeIds.value.has(nodeId);
  }

  function areIdsEqual(currentIds: Set<string>, nextIds: string[]) {
    if (currentIds.size !== nextIds.length) {
      return false;
    }

    return nextIds.every((nodeId) => currentIds.has(nodeId));
  }

  function setSelectedNodes(nodeIds: string[]) {
    if (nodeIds.length > 0) {
      clearEdgeSelection();
    }

    if (areIdsEqual(runtime.selectedNodeIds.value, nodeIds)) {
      return;
    }

    runtime.selectedNodeIds.value = new Set(nodeIds);
    nextTick(() => {
      scheduleSelectionBoundsRefresh();
      updatePresenceSelection();
    });
  }

  function setLassoPreviewNodes(nodeIds: string[]) {
    if (areIdsEqual(runtime.lassoPreviewNodeIds.value, nodeIds)) {
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

  function selectOnlyNode(nodeId: string) {
    if (!runtime.isLoggedIn.value) {
      return;
    }

    setSelectedNodes([nodeId]);
  }

  function handleNodeClick(payload: NodeMouseEvent) {
    if (!runtime.isLoggedIn.value) {
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
      return;
    }

    setSelectedNodes([payload.node.id]);
    runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350;
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
      getAction<(nodeIds: string[]) => void>(runtime, "deleteNodesById")(selectedNodeIds);
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
        updatePresenceSelection();
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

    const selectedNodeElement = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".vue-flow__node[data-id]")
      : null;

    if (
      selectedIds.length > 1 &&
      selectedNodeElement?.dataset.id &&
      selectedIds.includes(selectedNodeElement.dataset.id)
    ) {
      runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350;
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
      handleSelectedBoundsPointerDown(event);
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

  function isPointInsideSelectedBounds(event: PointerEvent | MouseEvent) {
    if (runtime.selectedNodeIds.value.size < 2) {
      return false;
    }

    const selectedBounds = getSelectedClientBounds();

    return Boolean(
      selectedBounds &&
        event.clientX >= selectedBounds.left &&
        event.clientX <= selectedBounds.right &&
        event.clientY >= selectedBounds.top &&
        event.clientY <= selectedBounds.bottom
    );
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

      getAction<(position: { x: number; y: number }) => void>(
        runtime,
        "scheduleCursorUpdate"
      )(runtime.screenToFlowCoordinate({ x: nextClientX, y: nextClientY }));
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

  function hasSelectedAncestor(node: SyncNode, selectedIds: Set<string>, allNodes: SyncNode[]) {
    let parentId = node.parentNode;

    while (parentId) {
      if (selectedIds.has(parentId)) {
        return true;
      }

      parentId = allNodes.find((candidate) => candidate.id === parentId)?.parentNode;
    }

    return false;
  }

  function getMovableSelectedIds(allNodes: SyncNode[]) {
    const selectedIds = new Set(getSelectedNodeIds());

    return new Set(
      allNodes
        .filter((node) => selectedIds.has(node.id) && !hasSelectedAncestor(node, selectedIds, allNodes))
        .map((node) => node.id)
    );
  }

  function getSelectedBoundsSnapshot() {
    const style = selectedBoundsStyle.value;

    if (!style) {
      return null;
    }

    return {
      left: Number.parseFloat(style.left),
      top: Number.parseFloat(style.top),
      width: Number.parseFloat(style.width),
      height: Number.parseFloat(style.height)
    };
  }

  function getSelectionMoveDelta(selectionMoveDrag: SelectionMoveDrag) {
    const viewport = runtime.currentViewport.value;

    return {
      x: (selectionMoveDrag.currentClientX - selectionMoveDrag.startClientX) / viewport.zoom,
      y: (selectionMoveDrag.currentClientY - selectionMoveDrag.startClientY) / viewport.zoom
    };
  }

  function getFlowNodeElement(nodeId: string) {
    const escapedNodeId =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(nodeId)
        : nodeId.replace(/["\\]/g, "\\$&");

    return runtime.canvasPanel.value?.querySelector<HTMLElement>(
      `.vue-flow__node[data-id="${escapedNodeId}"]`
    ) ?? null;
  }

  function clearSelectionMoveHiddenNodes() {
    selectionMoveHiddenElements.forEach(({ element, pointerEvents, visibility }) => {
      element.classList.remove("selection-drag-hidden");
      element.style.visibility = visibility;
      element.style.pointerEvents = pointerEvents;
    });
    selectionMoveHiddenElements = [];
  }

  function hideBundleSelectionNodes(selectionMoveDrag: SelectionMoveDrag) {
    clearSelectionMoveHiddenNodes();

    if (!hideSelectedNodesDuringBundleMove || selectionMoveDrag.mode !== "bundle") {
      return;
    }

    selectionMoveDrag.movingIds.forEach((nodeId) => {
      const element = getFlowNodeElement(nodeId);

      if (!element) {
        return;
      }

      element.classList.add("selection-drag-hidden");
      selectionMoveHiddenElements.push({
        element,
        pointerEvents: element.style.pointerEvents,
        visibility: element.style.visibility
      });
      element.style.visibility = "hidden";
      element.style.pointerEvents = "none";
    });
  }

  function buildSelectionMoveDragMetadata(
    originalSyncNodes: SyncNode[],
    movingIds: Set<string>
  ) {
    const graph = createGraphCache(originalSyncNodes);
    const dragItems: NodeDragItem[] = [];
    const originalPositionsById = new Map<string, { x: number; y: number }>();

    movingIds.forEach((nodeId) => {
      const syncNode = graph.nodeById.get(nodeId);

      if (!syncNode) {
        return;
      }

      const flowNode = runtime.findNode(nodeId) as
        | (FlowNode & {
            computedPosition?: { x: number; y: number };
            dimensions?: { width?: number; height?: number };
            extent?: NodeDragItem["extent"];
            expandParent?: boolean;
          })
        | undefined;
      const absolutePosition = flowNode?.computedPosition
        ? {
            x: flowNode.computedPosition.x,
            y: flowNode.computedPosition.y
          }
        : getAbsolutePosition(syncNode, graph);
      const dimensions = flowNode?.dimensions?.width && flowNode.dimensions.height
        ? {
            width: flowNode.dimensions.width,
            height: flowNode.dimensions.height
          }
        : getNodeSize(syncNode, syncNode.type === "section" ? 720 : 240, syncNode.type === "section" ? 620 : 190);

      originalPositionsById.set(nodeId, absolutePosition);
      dragItems.push({
        id: nodeId,
        position: { ...absolutePosition },
        distance: { x: 0, y: 0 },
        dimensions,
        from: { ...absolutePosition },
        extent: flowNode?.extent,
        parentNode: syncNode.parentNode,
        expandParent: syncNode.expandParent ?? flowNode?.expandParent
      });
    });

    return {
      dragItems,
      originalPositionsById
    };
  }

  function updateSelectionDragItemPositions(selectionMoveDrag: SelectionMoveDrag) {
    const delta = getSelectionMoveDelta(selectionMoveDrag);
    let changed = false;

    selectionMoveDrag.dragItems.forEach((dragItem) => {
      const originalPosition = selectionMoveDrag.originalPositionsById.get(dragItem.id) ?? dragItem.from;
      const nextPosition = {
        x: Math.round(originalPosition.x + delta.x),
        y: Math.round(originalPosition.y + delta.y)
      };

      if (dragItem.position.x !== nextPosition.x || dragItem.position.y !== nextPosition.y) {
        changed = true;
      }

      dragItem.position = nextPosition;
    });

    return changed;
  }

  function applyVisibleSelectionMove(selectionMoveDrag: SelectionMoveDrag, dragging: boolean) {
    const changed = updateSelectionDragItemPositions(selectionMoveDrag);

    if (changed) {
      runtime.updateNodePositions(selectionMoveDrag.dragItems, true, dragging);
    } else if (!dragging) {
      runtime.updateNodePositions(selectionMoveDrag.dragItems, false, false);
    }
  }

  function applySelectionMoveFrame() {
    const selectionMoveDrag = runtime.interaction.selectionMoveDrag;

    if (!selectionMoveDrag) {
      return;
    }

    selectionMoveDrag.frame = undefined;
    paintSelectionMovePreview(selectionMoveDrag);

    if (selectionMoveDrag.mode === "bundle") {
      return;
    }

    applyVisibleSelectionMove(selectionMoveDrag, true);
  }

  function paintSelectionMovePreview(
    selectionMoveDrag: SelectionMoveDrag
  ) {
    const element = selectionMovePreviewElement;
    const deltaX = selectionMoveDrag.currentClientX - selectionMoveDrag.startClientX;
    const deltaY = selectionMoveDrag.currentClientY - selectionMoveDrag.startClientY;

    if (element) {
      element.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
    }
  }

  function clearSelectionMovePreview() {
    if (selectionMovePreviewElement) {
      selectionMovePreviewElement.style.transform = "";
      selectionMovePreviewElement.style.willChange = "";
    }

    selectionMovePreviewElement = null;
    clearSelectionMoveHiddenNodes();
  }

  function buildCommittedSelectionMoveNodes(
    selectionMoveDrag: SelectionMoveDrag
  ) {
    const delta = getSelectionMoveDelta(selectionMoveDrag);

    return selectionMoveDrag.originalSyncNodes.map((node) => {
      if (!selectionMoveDrag.movingIds.has(node.id)) {
        return node;
      }

      return {
        ...node,
        position: {
          x: Math.round(node.position.x + delta.x),
          y: Math.round(node.position.y + delta.y)
        }
      };
    });
  }

  function hasCommittedSelectionMovePositionChange(
    selectionMoveDrag: SelectionMoveDrag
  ) {
    const delta = getSelectionMoveDelta(selectionMoveDrag);

    for (const nodeId of selectionMoveDrag.movingIds) {
      const node = selectionMoveDrag.originalSyncNodesById.get(nodeId);

      if (!node) {
        continue;
      }

      if (
        Math.round(node.position.x + delta.x) !== node.position.x ||
        Math.round(node.position.y + delta.y) !== node.position.y
      ) {
        return true;
      }
    }

    return false;
  }

  function getStableNodeChanges(documentNodes: SyncNode[], nextNodes: SyncNode[]) {
    if (documentNodes.length !== nextNodes.length) {
      return null;
    }

    const changes: Array<{ index: number; oldNode: SyncNode; nextNode: SyncNode }> = [];

    for (let index = 0; index < documentNodes.length; index += 1) {
      const oldNode = documentNodes[index];
      const nextNode = nextNodes[index];

      if (oldNode.id !== nextNode.id) {
        return null;
      }

      if (!sameJson(oldNode, nextNode)) {
        changes.push({ index, oldNode, nextNode });
      }
    }

    return changes;
  }

  function isPositionOnlyNodeChange(oldNode: SyncNode, nextNode: SyncNode) {
    if (oldNode.id !== nextNode.id) {
      return false;
    }

    return sameJson(oldNode, {
      ...nextNode,
      position: oldNode.position
    });
  }

  function submitPositionOnlySelectionMove(
    drag: SelectionMoveDrag,
    changes: Array<{ index: number; oldNode: SyncNode; nextNode: SyncNode }>
  ) {
    if (drag.mode === "bundle") {
      applyVisibleSelectionMove(drag, false);
    } else {
      updateSelectionDragItemPositions(drag);
      runtime.updateNodePositions(drag.dragItems, false, false);
    }

    submitOperation(
      changes.map(({ index, oldNode, nextNode }) => ({
        p: ["nodes", index],
        ld: oldNode,
        li: nextNode
      }) as JsonOp)
    );
  }

  function scheduleSelectionMoveFrame() {
    const selectionMoveDrag = runtime.interaction.selectionMoveDrag;

    if (!selectionMoveDrag || selectionMoveDrag.frame) {
      return;
    }

    selectionMoveDrag.frame = window.requestAnimationFrame(applySelectionMoveFrame);
  }

  function flushSelectionMoveFrame() {
    const selectionMoveDrag = runtime.interaction.selectionMoveDrag;

    if (!selectionMoveDrag) {
      return;
    }

    if (selectionMoveDrag.frame) {
      window.cancelAnimationFrame(selectionMoveDrag.frame);
      selectionMoveDrag.frame = undefined;
    }

    applySelectionMoveFrame();
  }

  function handleSelectedBoundsPointerDown(event: PointerEvent) {
    if (!runtime.isLoggedIn.value || event.button !== 0) {
      return;
    }

    const selectedIds = getSelectedNodeIds();

    if (selectedIds.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    closeContextMenu();

    const normalizedOriginalNodes = (runtime.nodes.value as FlowNode[]).map(normalizeNode);
    const movingIds = getMovableSelectedIds(normalizedOriginalNodes);
    const movingIndexes = normalizedOriginalNodes
      .map((node, index) => (movingIds.has(node.id) ? index : -1))
      .filter((index) => index >= 0);
    const mode =
      largeSelectionMovePreviewMode === "bundle" &&
      movingIndexes.length > largeSelectionMovePreviewThreshold
        ? "bundle"
        : "visible";
    const originalSyncNodesById = new Map(normalizedOriginalNodes.map((node) => [node.id, node]));
    const { dragItems, originalPositionsById } = buildSelectionMoveDragMetadata(
      normalizedOriginalNodes,
      movingIds
    );
    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const previewElement =
      (event.target instanceof Element
        ? event.target.closest<HTMLElement>(".selected-nodes-outline")
        : null) ??
      target?.closest<HTMLElement>(".selected-nodes-outline") ??
      runtime.canvasPanel.value?.querySelector<HTMLElement>(".selected-nodes-outline") ??
      null;

    selectionMovePointerCaptureTarget = target;
    clearSelectionMovePreview();
    selectionMovePreviewElement = previewElement;
    if (selectionMovePreviewElement) {
      selectionMovePreviewElement.style.willChange = "transform";
    }
    if (target && typeof target.setPointerCapture === "function") {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        selectionMovePointerCaptureTarget = null;
      }
    }

    runtime.interaction.selectionMoveDrag = {
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      originalSyncNodes: normalizedOriginalNodes,
      originalSyncNodesById,
      originalPositionsById,
      dragItems,
      movingIds,
      movingIndexes,
      selectedBounds: getSelectedBoundsSnapshot()
    };
    hideBundleSelectionNodes(runtime.interaction.selectionMoveDrag);
    runtime.isMovingSelection.value = true;
    window.addEventListener("pointermove", handleSelectedBoundsPointerMove, { capture: true });
    window.addEventListener("pointerup", handleSelectedBoundsPointerUp, { capture: true, once: true });
  }

  function handleSelectedBoundsPointerMove(event: PointerEvent) {
    const selectionMoveDrag = runtime.interaction.selectionMoveDrag;

    if (!selectionMoveDrag) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    selectionMoveDrag.currentClientX = event.clientX;
    selectionMoveDrag.currentClientY = event.clientY;
    scheduleSelectionMoveFrame();
  }

  function handleSelectedBoundsPointerUp(event: PointerEvent) {
    window.removeEventListener("pointermove", handleSelectedBoundsPointerMove, true);
    runtime.isResizingNode.value = false;

    const drag = runtime.interaction.selectionMoveDrag;
    if (drag) {
      drag.currentClientX = event.clientX;
      drag.currentClientY = event.clientY;
    }
    flushSelectionMoveFrame();
    if (selectionMovePointerCaptureTarget?.hasPointerCapture(event.pointerId)) {
      selectionMovePointerCaptureTarget.releasePointerCapture(event.pointerId);
    }
    selectionMovePointerCaptureTarget = null;

    if (!drag) {
      runtime.interaction.selectionMoveDrag = null;
      runtime.isMovingSelection.value = false;
      scheduleSelectionBoundsRefresh();
      clearSelectionMovePreview();
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    const committed = commitMovedSelectedNodes(drag);
    runtime.interaction.selectionMoveDrag = null;
    runtime.isMovingSelection.value = false;
    scheduleSelectionBoundsRefresh();
    if (committed) {
      nextTick(clearSelectionMovePreview);
    } else {
      clearSelectionMovePreview();
    }
  }

  function commitMovedSelectedNodes(
    drag: SelectionMoveDrag
  ) {
    const document = runtime.flowDocument.value;
    const movingIds = drag.movingIds;

    if (!document || movingIds.size === 0) {
      submitGraphSnapshot();
      return false;
    }

    if (!hasCommittedSelectionMovePositionChange(drag)) {
      runtime.updateNodePositions(drag.dragItems, false, false);
      return false;
    }

    const nextNodes = buildCommittedSelectionMoveNodes(drag);
    const nextEdges = getCurrentSyncEdges(nextNodes);
    const previousNodesById = new Map(document.data.nodes.map((node) => [node.id, node]));
    const graph = createGraphCache(nextNodes, nextEdges);

    movingIds.forEach((nodeId) => {
      const node = graph.nodeById.get(nodeId);

      if (!node) {
        return;
      }

      applySectionMembershipForMovedNode(
        node.id,
        getAbsolutePosition(node, graph),
        getNodeSize(node, node.type === "section" ? 720 : 240, node.type === "section" ? 620 : 190),
        nextNodes,
        nextEdges,
        previousNodesById.get(node.id),
        graph
      );
    });

    const nodeChanges = getStableNodeChanges(document.data.nodes, nextNodes);
    const edgesChanged = !sameJson(document.data.edges, nextEdges);
    const canSubmitPositionOnly =
      nodeChanges !== null &&
      !edgesChanged &&
      nodeChanges.length > 0 &&
      nodeChanges.every(({ oldNode, nextNode }) =>
        movingIds.has(nextNode.id) && isPositionOnlyNodeChange(oldNode, nextNode)
      );

    if (canSubmitPositionOnly) {
      submitPositionOnlySelectionMove(drag, nodeChanges);
      return true;
    }

    runtime.nodes.value = withSelectionState(nextNodes.map(stripParentExtent) as FlowNode[]);
    runtime.edges.value = withDefaultEdges(nextEdges, createGraphCache(nextNodes, nextEdges));
    submitOperation(
      [
        !sameJson(document.data.nodes, nextNodes) && {
        p: ["nodes"],
        od: document.data.nodes,
        oi: nextNodes
      },
        edgesChanged && {
        p: ["edges"],
        od: document.data.edges,
        oi: nextEdges
      }
      ].filter(Boolean) as JsonOp[]
    );
    return true;
  }

  function getSelectedClientBounds() {
    const style = selectedBoundsStyle.value;
    const panelRect = runtime.canvasPanel.value?.getBoundingClientRect();

    if (!style || !panelRect) {
      return null;
    }

    const left = panelRect.left + Number.parseFloat(style.left);
    const top = panelRect.top + Number.parseFloat(style.top);
    const width = Number.parseFloat(style.width);
    const height = Number.parseFloat(style.height);

    return {
      left,
      top,
      right: left + width,
      bottom: top + height
    };
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
    window.removeEventListener("pointermove", handleSelectedBoundsPointerMove, true);
    window.removeEventListener("pointerup", handleSelectedBoundsPointerUp, true);
    if (runtime.interaction.selectionMoveDrag?.frame) {
      window.cancelAnimationFrame(runtime.interaction.selectionMoveDrag.frame);
      runtime.interaction.selectionMoveDrag.frame = undefined;
    }
    if (cursorCoordinateFrame) {
      window.cancelAnimationFrame(cursorCoordinateFrame);
      cursorCoordinateFrame = undefined;
    }
    hasPendingCursorClientPoint = false;
    clearSelectionMovePreview();
    runtime.interaction.selectionMoveDrag = null;
    selectionMovePointerCaptureTarget = null;
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
    handleNodesChange,
    handleSelectedBoundsPointerDown,
    isCanvasSelectionTarget,
    isNodeSelected,
    isSingleNodeSelection,
    lassoPreviewRects,
    selectOnlyNode,
    selectionMovePreview,
    selectedBoundsStyle,
    setSelectedNodes
  };
}
