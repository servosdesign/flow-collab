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
  let lastLassoPreviewKey = "";

  const selectionBoxStyle = computed(() => {
    const selection = runtime.rightSelection.value;

    if (!selection) {
      return {};
    }

    const left = Math.min(selection.startLocalX, selection.currentLocalX);
    const top = Math.min(selection.startLocalY, selection.currentLocalY);
    const width = Math.abs(selection.currentLocalX - selection.startLocalX);
    const height = Math.abs(selection.currentLocalY - selection.startLocalY);

    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`
    };
  });

  const selectedBoundsStyle = computed<Record<string, string> | null>(() => {
    if (
      !runtime.isLoggedIn.value ||
      runtime.rightSelection.value ||
      runtime.selectedNodeIds.value.size < 2
    ) {
      return null;
    }

    runtime.selectionBoundsVersion.value;
    const graphNodes = getCurrentSyncNodes();
    const graph = createGraphCache(graphNodes);
    const selectedBounds = graphNodes
      .filter((node) => runtime.selectedNodeIds.value.has(node.id))
      .map((node) => {
        const bounds = getNodeBounds(node, graph);
        const viewport = runtime.currentViewport.value;

        return {
          x: bounds.x * viewport.zoom + viewport.x,
          y: bounds.y * viewport.zoom + viewport.y,
          width: bounds.width * viewport.zoom,
          height: bounds.height * viewport.zoom
        };
      });

    if (selectedBounds.length === 0) {
      return null;
    }

    const minX = Math.min(...selectedBounds.map((bounds) => bounds.x));
    const minY = Math.min(...selectedBounds.map((bounds) => bounds.y));
    const maxX = Math.max(...selectedBounds.map((bounds) => bounds.x + bounds.width));
    const maxY = Math.max(...selectedBounds.map((bounds) => bounds.y + bounds.height));
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

    return lassoBoundsCache
      .filter((bounds) => previewIds.has(bounds.id))
      .map((bounds) => ({
        id: bounds.id,
        style: {
          left: `${bounds.x * viewport.zoom + viewport.x}px`,
          top: `${bounds.y * viewport.zoom + viewport.y}px`,
          width: `${bounds.width * viewport.zoom}px`,
          height: `${bounds.height * viewport.zoom}px`
        }
      }));
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
    const nextKey = nodeIds.join("\u0000");

    if (nextKey === lastLassoPreviewKey) {
      return;
    }

    lastLassoPreviewKey = nextKey;
    runtime.lassoPreviewNodeIds.value = new Set(nodeIds);
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
    const topLeft = runtime.screenToFlowCoordinate({
      x: Math.min(rect.startClientX, rect.currentClientX),
      y: Math.min(rect.startClientY, rect.currentClientY)
    });
    const bottomRight = runtime.screenToFlowCoordinate({
      x: Math.max(rect.startClientX, rect.currentClientX),
      y: Math.max(rect.startClientY, rect.currentClientY)
    });

    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y
    };
  }

  function getLassoSelectedIds(rect: LassoPointerRect) {
    const selectionBounds = getFlowSelectionBounds(rect);

    return lassoBoundsCache
      .filter((bounds) => hasGraphBoundsOverlap(bounds, selectionBounds))
      .map((bounds) => bounds.id);
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
    lastLassoPreviewKey = "";
    lassoBoundsCache = [];
    runtime.isLassoSelecting.value = false;
    runtime.lassoPreviewNodeIds.value = new Set();
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
    rebuildLassoBoundsCache();
    runtime.isLassoSelecting.value = true;
    runtime.lassoPreviewNodeIds.value = new Set();
    lastLassoPreviewKey = "";
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
    window.addEventListener("pointermove", handleRightSelectionMove);
    window.addEventListener("pointerup", handleRightSelectionEnd, { once: true });
  }

  function isPointInsideSelectedBounds(event: PointerEvent | MouseEvent) {
    const selectedBounds = getSelectedClientBounds();

    return Boolean(
      selectedBounds &&
        getSelectedNodeIds().length > 1 &&
        event.clientX >= selectedBounds.left &&
        event.clientX <= selectedBounds.right &&
        event.clientY >= selectedBounds.top &&
        event.clientY <= selectedBounds.bottom
    );
  }

  function handleRightSelectionMove(event: PointerEvent) {
    const selection = runtime.rightSelection.value;

    if (!selection) {
      return;
    }

    const panel = document.querySelector<HTMLElement>(".canvas-panel");
    const rect = panel?.getBoundingClientRect();

    selection.currentClientX = event.clientX;
    selection.currentClientY = event.clientY;

    if (rect) {
      selection.currentLocalX = event.clientX - rect.left;
      selection.currentLocalY = event.clientY - rect.top;
    }

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
    window.removeEventListener("pointermove", handleRightSelectionMove);

    const selection = runtime.rightSelection.value;
    runtime.rightSelection.value = null;

    if (!selection) {
      return;
    }

    if (!runtime.interaction.suppressNextContextMenu) {
      clearLassoPreview();
      setSelectedNodes([]);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
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

    const originalNodes = (runtime.nodes.value as FlowNode[]).map(normalizeNode);
    runtime.interaction.selectionMoveDrag = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      originalNodes,
      movingIds: getMovableSelectedIds(originalNodes)
    };
    runtime.isMovingSelection.value = true;
    window.addEventListener("pointermove", handleSelectedBoundsPointerMove);
    window.addEventListener("pointerup", handleSelectedBoundsPointerUp, { once: true });
  }

  function handleSelectedBoundsPointerMove(event: PointerEvent) {
    const selectionMoveDrag = runtime.interaction.selectionMoveDrag;

    if (!selectionMoveDrag) {
      return;
    }

    event.preventDefault();
    const viewport = runtime.currentViewport.value;
    const deltaX = (event.clientX - selectionMoveDrag.startClientX) / viewport.zoom;
    const deltaY = (event.clientY - selectionMoveDrag.startClientY) / viewport.zoom;

    runtime.nodes.value = withSelectionState(
      selectionMoveDrag.originalNodes.map((node) =>
        selectionMoveDrag.movingIds.has(node.id)
          ? ({
              ...node,
              position: {
                x: Math.round(node.position.x + deltaX),
                y: Math.round(node.position.y + deltaY)
              }
            } as FlowNode)
          : (node as FlowNode)
      )
    );
    scheduleSelectionBoundsRefresh();
  }

  function handleSelectedBoundsPointerUp(event: PointerEvent) {
    window.removeEventListener("pointermove", handleSelectedBoundsPointerMove);
    runtime.isResizingNode.value = false;

    const drag = runtime.interaction.selectionMoveDrag;
    runtime.interaction.selectionMoveDrag = null;
    runtime.isMovingSelection.value = false;
    scheduleSelectionBoundsRefresh();

    if (!drag) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
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

    movingIds.forEach((nodeId) => {
      const graph = createGraphCache(nextNodes, nextEdges);
      const node = nextNodes.find((candidate) => candidate.id === nodeId);

      if (!node) {
        return;
      }

      applySectionMembershipForMovedNode(
        node.id,
        getAbsolutePosition(node, graph),
        getNodeSize(node, node.type === "section" ? 720 : 240, node.type === "section" ? 620 : 190),
        nextNodes,
        nextEdges,
        document.data.nodes.find((candidate) => candidate.id === node.id)
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

    runtime.currentViewport.value = runtime.toObject().viewport;
    runtime.isHoveringSelection.value =
      !runtime.interaction.selectionMoveDrag &&
      isCanvasSelectionTarget(event.target) &&
      isPointInsideSelectedBounds(event);
    getAction<(position: { x: number; y: number }) => void>(
      runtime,
      "scheduleCursorUpdate"
    )(runtime.screenToFlowCoordinate({ x: event.clientX, y: event.clientY }));
  }

  function handleCanvasPointerLeave() {
    runtime.isHoveringSelection.value = false;
  }

  function cleanupSelection() {
    window.removeEventListener("pointermove", handleRightSelectionMove);
    window.removeEventListener("pointermove", handleSelectedBoundsPointerMove);
    clearLassoPreview();
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
    selectionBoxStyle,
    setSelectedNodes
  };
}
