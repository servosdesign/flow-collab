import type { EdgeMouseEvent, NodeChange, NodeDragEvent, NodeMouseEvent } from "@vue-flow/core";
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
  stripParentExtent,
  withDefaultEdges,
  type FlowEdge,
  type FlowNode
} from "./graph";
import type { FlowRuntime } from "./flowRuntime";

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
      const deltaX = selectionMoveDrag.currentClientX - selectionMoveDrag.startClientX;
      const deltaY = selectionMoveDrag.currentClientY - selectionMoveDrag.startClientY;

      return {
        left: `${selectionMoveDrag.selectedBounds.left + deltaX}px`,
        top: `${selectionMoveDrag.selectedBounds.top + deltaY}px`,
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
    if (changes.some((change) => change.type === "dimensions" || change.type === "position")) {
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

  function buildSelectionDragPreviewNodes() {
    const selectionMoveDrag = runtime.interaction.selectionMoveDrag;

    if (!selectionMoveDrag) {
      return null;
    }

    const viewport = runtime.currentViewport.value;
    const deltaX = (selectionMoveDrag.currentClientX - selectionMoveDrag.startClientX) / viewport.zoom;
    const deltaY = (selectionMoveDrag.currentClientY - selectionMoveDrag.startClientY) / viewport.zoom;
    const nextNodes = selectionMoveDrag.originalNodes.slice() as FlowNode[];

    selectionMoveDrag.movingIndexes.forEach((index) => {
      const node = selectionMoveDrag.originalNodes[index];

      if (!node) {
        return;
      }

      nextNodes[index] = {
        ...node,
        position: {
          x: Math.round(node.position.x + deltaX),
          y: Math.round(node.position.y + deltaY)
        }
      } as FlowNode;
    });

    return nextNodes;
  }

  function applySelectionMoveFrame() {
    const selectionMoveDrag = runtime.interaction.selectionMoveDrag;

    if (!selectionMoveDrag) {
      return;
    }

    selectionMoveDrag.frame = undefined;
    const nextNodes = buildSelectionDragPreviewNodes();

    if (!nextNodes) {
      return;
    }

    runtime.nodes.value = nextNodes;
    runtime.selectionBoundsVersion.value += 1;
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
    const originalNodes = withSelectionState(
      normalizedOriginalNodes.map(stripParentExtent) as FlowNode[]
    );
    const movingIds = getMovableSelectedIds(normalizedOriginalNodes);
    const movingIndexes = originalNodes
      .map((node, index) => (movingIds.has(node.id) ? index : -1))
      .filter((index) => index >= 0);
    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;

    selectionMovePointerCaptureTarget = target;
    if (target && typeof target.setPointerCapture === "function") {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        selectionMovePointerCaptureTarget = null;
      }
    }

    runtime.interaction.selectionMoveDrag = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      originalNodes,
      movingIds,
      movingIndexes,
      selectedBounds: getSelectedBoundsSnapshot()
    };
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
    runtime.interaction.selectionMoveDrag = null;
    runtime.isMovingSelection.value = false;
    scheduleSelectionBoundsRefresh();
    if (selectionMovePointerCaptureTarget?.hasPointerCapture(event.pointerId)) {
      selectionMovePointerCaptureTarget.releasePointerCapture(event.pointerId);
    }
    selectionMovePointerCaptureTarget = null;

    if (!drag) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    commitMovedSelectedNodes(drag.movingIds);
  }

  function commitMovedSelectedNodes(movingIds: Set<string>) {
    const document = runtime.flowDocument.value;

    if (!document || movingIds.size === 0) {
      submitGraphSnapshot();
      return;
    }

    const nextNodes = getCurrentSyncNodes();
    const nextEdges = getCurrentSyncEdges(nextNodes);
    const previousNodesById = new Map(document.data.nodes.map((node) => [node.id, node]));

    Array.from(movingIds).forEach((nodeId) => {
      const graph = createGraphCache(nextNodes, nextEdges);
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
        previousNodesById.get(node.id)
      );
    });

    runtime.nodes.value = withSelectionState(nextNodes.map(stripParentExtent) as FlowNode[]);
    runtime.edges.value = withDefaultEdges(nextEdges, createGraphCache(nextNodes, nextEdges));
    submitOperation([
      {
        p: ["nodes"],
        od: document.data.nodes,
        oi: nextNodes
      },
      {
        p: ["edges"],
        od: document.data.edges,
        oi: nextEdges
      }
    ]);
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
    selectedBoundsStyle,
    setSelectedNodes
  };
}
