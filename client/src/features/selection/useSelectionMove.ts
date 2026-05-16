import type { NodeDragItem } from "@vue-flow/core";
import type { SyncEdge, SyncNode } from "@vue-flow-sync/shared";
import { computed, nextTick, type ComputedRef } from "vue";
import type { JsonOp } from "sharedb/lib/client";
import type { FlowEditorServices } from "../../app/flowEditorServices";
import {
  applySectionMembershipForMovedNode,
  createGraphCache,
  getAbsolutePosition,
  getNodeSize,
  normalizeNode,
  sameJson,
  stripParentExtent,
  withDefaultEdges,
  type FlowNode
} from "../../domain/graph";
import type { FlowRuntime } from "../../flowRuntime";
import type { SelectionMoveDrag } from "../../flowTypes";

type LargeSelectionMovePreviewMode = "bundle" | "visible";

const largeSelectionMovePreviewMode: LargeSelectionMovePreviewMode = "bundle";
const largeSelectionMovePreviewThreshold = 8;
const hideSelectedNodesDuringBundleMove = true;
const maxSelectionMovePreviewShapes = 36;
const selectionMovePreviewShapeIndexes = Array.from(
  { length: maxSelectionMovePreviewShapes },
  (_, index) => index
);

type UseSelectionMoveOptions = {
  selectedBoundsStyle: ComputedRef<Record<string, string> | null>;
  getSelectedNodeIds: () => string[];
};

export function useSelectionMove(
  runtime: FlowRuntime,
  services: FlowEditorServices,
  options: UseSelectionMoveOptions
) {
  let selectionMovePointerCaptureTarget: HTMLElement | null = null;
  let selectionMovePreviewElement: HTMLElement | null = null;
  let selectionMoveHiddenElements: Array<{
    element: HTMLElement;
    pointerEvents: string;
    visibility: string;
  }> = [];

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
    const selectedIds = new Set(options.getSelectedNodeIds());

    return new Set(
      allNodes
        .filter((node) => selectedIds.has(node.id) && !hasSelectedAncestor(node, selectedIds, allNodes))
        .map((node) => node.id)
    );
  }

  function getSelectedBoundsSnapshot() {
    const style = options.selectedBoundsStyle.value;

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

  function buildSelectionMoveDragMetadata(originalSyncNodes: SyncNode[], movingIds: Set<string>) {
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

  function paintSelectionMovePreview(selectionMoveDrag: SelectionMoveDrag) {
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

  function buildCommittedSelectionMoveNodes(selectionMoveDrag: SelectionMoveDrag) {
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

  function hasCommittedSelectionMovePositionChange(selectionMoveDrag: SelectionMoveDrag) {
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

    services.submitOperation(
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

    const selectedIds = options.getSelectedNodeIds();

    if (selectedIds.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    services.closeContextMenu();

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
      services.scheduleSelectionBoundsRefresh();
      clearSelectionMovePreview();
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    const committed = commitMovedSelectedNodes(drag);
    runtime.interaction.selectionMoveDrag = null;
    runtime.isMovingSelection.value = false;
    services.scheduleSelectionBoundsRefresh();
    if (committed) {
      nextTick(clearSelectionMovePreview);
    } else {
      clearSelectionMovePreview();
    }
  }

  function commitMovedSelectedNodes(drag: SelectionMoveDrag) {
    const document = runtime.flowDocument.value;
    const movingIds = drag.movingIds;

    if (!document || movingIds.size === 0) {
      services.submitGraphSnapshot();
      return false;
    }

    if (!hasCommittedSelectionMovePositionChange(drag)) {
      runtime.updateNodePositions(drag.dragItems, false, false);
      return false;
    }

    const nextNodes = buildCommittedSelectionMoveNodes(drag);
    const nextEdges = services.getCurrentSyncEdges(nextNodes);
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

    runtime.nodes.value = services.withSelectionState(nextNodes.map(stripParentExtent) as FlowNode[]);
    runtime.edges.value = withDefaultEdges(nextEdges, createGraphCache(nextNodes, nextEdges));
    services.submitOperation(
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

  function cleanupSelectionMove() {
    window.removeEventListener("pointermove", handleSelectedBoundsPointerMove, true);
    window.removeEventListener("pointerup", handleSelectedBoundsPointerUp, true);
    if (runtime.interaction.selectionMoveDrag?.frame) {
      window.cancelAnimationFrame(runtime.interaction.selectionMoveDrag.frame);
      runtime.interaction.selectionMoveDrag.frame = undefined;
    }
    clearSelectionMovePreview();
    runtime.interaction.selectionMoveDrag = null;
    selectionMovePointerCaptureTarget = null;
  }

  return {
    cleanupSelectionMove,
    handleSelectedBoundsPointerDown,
    selectionMovePreview
  };
}
