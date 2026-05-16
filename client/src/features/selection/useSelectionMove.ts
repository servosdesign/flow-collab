import type { NodeDragItem } from "@vue-flow/core";
import type { SyncEdge, SyncNode } from "@vue-flow-sync/shared";
import { computed, nextTick, type ComputedRef } from "vue";
import type { JsonOp } from "sharedb/lib/client";
import type { FlowEditorServices } from "../../app/flowEditorServices";
import {
  applySectionMembershipForMovedNode,
  createGraphCache,
  getAbsolutePosition,
  getNodeBounds,
  getNodeSize,
  getRenderedNodeBounds,
  getOverlapRatio,
  isAncestorSection,
  normalizeNode,
  sameJson,
  stripParentExtent,
  withDefaultEdges,
  type FlowNode
} from "../../domain/graph";
import type { FlowRuntime } from "../../flowRuntime";
import type {
  SelectionMoveDrag,
  SelectionMovePreviewCounts,
  SelectionMovePreviewShapeKind
} from "../../flowTypes";

type LargeSelectionMovePreviewMode = "bundle" | "visible";

const largeSelectionMovePreviewMode: LargeSelectionMovePreviewMode = "bundle";
const largeSelectionMovePreviewThreshold = 8;
const hideSelectedNodesDuringBundleMove = true;
const maxSelectionMovePreviewShapes = 36;
const selectionDragHiddenClass = "selection-drag-hidden";

type UseSelectionMoveOptions = {
  selectedBoundsStyle: ComputedRef<Record<string, string> | null>;
  getSelectedNodeIds: () => string[];
};

type SelectionMovePreviewShape = {
  id: number;
  kind: SelectionMovePreviewShapeKind;
};

type HiddenNodeClassSnapshot = {
  id: string;
  hadClass: boolean;
  className: FlowNode["class"];
};

export function useSelectionMove(
  runtime: FlowRuntime,
  services: FlowEditorServices,
  options: UseSelectionMoveOptions
) {
  let selectionMovePointerCaptureTarget: HTMLElement | null = null;
  let selectionMovePreviewElement: HTMLElement | null = null;
  let selectionMoveHiddenClassSnapshots: HiddenNodeClassSnapshot[] = [];

  const selectionMovePreview = computed(() => {
    const sectionDragPreview = runtime.sectionNodeDragPreview.value;

    if (sectionDragPreview) {
      return {
        active: true,
        ...sectionDragPreview.previewCounts,
        shapes: [{ id: 0, kind: "section" }] as SelectionMovePreviewShape[]
      };
    }

    const selectionMoveDrag = runtime.interaction.selectionMoveDrag;

    if (
      !runtime.isMovingSelection.value ||
      selectionMoveDrag?.mode !== "bundle" ||
      selectionMoveDrag.movingIndexes.length === 0
    ) {
      return {
        active: false,
        itemCount: 0,
        sectionCount: 0,
        containedCount: 0,
        containedSectionCount: 0,
        shapes: [] as SelectionMovePreviewShape[]
      };
    }

    const shapes = selectionMoveDrag.previewShapeKinds
      .slice(0, Math.min(selectionMoveDrag.previewShapeKinds.length, maxSelectionMovePreviewShapes))
      .map((kind, index) => ({ id: index, kind }));

    return {
      active: true,
      ...selectionMoveDrag.previewCounts,
      shapes
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

  function addDescendantIds(nodeId: string, graph: ReturnType<typeof createGraphCache>, ids: Set<string>) {
    const children = graph.childrenByParentId.get(nodeId) ?? [];

    children.forEach((child) => {
      if (ids.has(child.id)) {
        return;
      }

      ids.add(child.id);
      addDescendantIds(child.id, graph, ids);
    });
  }

  function countSectionIds(ids: Set<string>, graph: ReturnType<typeof createGraphCache>) {
    let count = 0;

    ids.forEach((nodeId) => {
      if (graph.nodeById.get(nodeId)?.type === "section") {
        count += 1;
      }
    });

    return count;
  }

  function buildSelectionMoveHiddenIds(allNodes: SyncNode[], movingIds: Set<string>) {
    const graph = createGraphCache(allNodes);
    const hiddenIds = new Set(movingIds);

    movingIds.forEach((nodeId) => {
      const node = graph.nodeById.get(nodeId);

      if (node?.type === "section") {
        addDescendantIds(nodeId, graph, hiddenIds);
      }
    });

    return hiddenIds;
  }

  function buildSelectionMovePreviewMetadata(
    allNodes: SyncNode[],
    movingIds: Set<string>,
    hiddenIds: Set<string>
  ) {
    const counts: SelectionMovePreviewCounts = {
      itemCount: 0,
      sectionCount: 0,
      containedCount: Math.max(0, hiddenIds.size - movingIds.size),
      containedSectionCount: 0
    };
    const shapeKinds: SelectionMovePreviewShapeKind[] = [];

    allNodes.forEach((node) => {
      if (hiddenIds.has(node.id) && !movingIds.has(node.id) && node.type === "section") {
        counts.containedSectionCount += 1;
      }

      if (!movingIds.has(node.id)) {
        return;
      }

      if (node.type === "section") {
        counts.sectionCount += 1;
        shapeKinds.push("section");
        return;
      }

      counts.itemCount += 1;
      shapeKinds.push("item");
    });

    return {
      counts,
      shapeKinds
    };
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

  function hasClassName(className: FlowNode["class"], name: string) {
    return typeof className === "string" && className.split(/\s+/).includes(name);
  }

  function withClassName(className: FlowNode["class"], name: string) {
    const classNames = typeof className === "string"
      ? className.split(/\s+/).filter(Boolean)
      : [];

    if (!classNames.includes(name)) {
      classNames.push(name);
    }

    return classNames.join(" ");
  }

  function restoreNodeClass(node: FlowNode, snapshot: HiddenNodeClassSnapshot) {
    if (snapshot.hadClass) {
      return {
        ...node,
        class: snapshot.className
      };
    }

    const { class: _className, ...nextNode } = node;

    return nextNode as FlowNode;
  }

  function clearSelectionMoveHiddenNodes() {
    if (selectionMoveHiddenClassSnapshots.length === 0) {
      return;
    }

    const snapshotsById = new Map(
      selectionMoveHiddenClassSnapshots.map((snapshot) => [snapshot.id, snapshot])
    );
    let changed = false;
    const nextNodes = (runtime.nodes.value as FlowNode[]).map((node) => {
      const snapshot = snapshotsById.get(node.id);

      if (!snapshot || !hasClassName(node.class, selectionDragHiddenClass)) {
        return node;
      }

      changed = true;
      return restoreNodeClass(node, snapshot);
    });

    selectionMoveHiddenClassSnapshots = [];

    if (changed) {
      runtime.nodes.value = nextNodes;
    }
  }

  function hideSelectionMoveNodes(hiddenIds: Set<string>) {
    clearSelectionMoveHiddenNodes();

    if (hiddenIds.size === 0) {
      return;
    }

    const nextSnapshots: HiddenNodeClassSnapshot[] = [];
    let changed = false;
    const nextNodes = (runtime.nodes.value as FlowNode[]).map((node) => {
      if (!hiddenIds.has(node.id)) {
        return node;
      }

      nextSnapshots.push({
        id: node.id,
        hadClass: Object.prototype.hasOwnProperty.call(node, "class"),
        className: node.class
      });

      const nextClassName = withClassName(node.class, selectionDragHiddenClass);

      if (node.class === nextClassName) {
        return node;
      }

      changed = true;

      return {
        ...node,
        class: nextClassName
      };
    });

    selectionMoveHiddenClassSnapshots = nextSnapshots;

    if (changed) {
      runtime.nodes.value = nextNodes;
    }
  }

  function hideBundleSelectionNodes(selectionMoveDrag: SelectionMoveDrag) {
    if (!hideSelectedNodesDuringBundleMove || selectionMoveDrag.mode !== "bundle") {
      clearSelectionMoveHiddenNodes();
      return;
    }

    hideSelectionMoveNodes(selectionMoveDrag.hiddenIds);
  }

  function handleSectionNodeDragStart(sectionId: string) {
    const allNodes = (runtime.nodes.value as FlowNode[]).map(normalizeNode);
    const graph = createGraphCache(allNodes);
    const section = graph.nodeById.get(sectionId);

    if (section?.type !== "section") {
      return;
    }

    const descendantIds = new Set<string>();
    addDescendantIds(sectionId, graph, descendantIds);
    const sectionBounds = getNodeBounds(section, graph);

    allNodes.forEach((node) => {
      if (
        node.id === sectionId ||
        descendantIds.has(node.id) ||
        isAncestorSection(node.id, sectionId, graph)
      ) {
        return;
      }

      if (getOverlapRatio(getRenderedNodeBounds(node, graph), sectionBounds) >= 0.5) {
        descendantIds.add(node.id);

        if (node.type === "section") {
          addDescendantIds(node.id, graph, descendantIds);
        }
      }
    });

    if (descendantIds.size + 1 <= largeSelectionMovePreviewThreshold) {
      return;
    }

    runtime.sectionNodeDragPreview.value = {
      sectionId,
      previewCounts: {
        itemCount: 0,
        sectionCount: 1,
        containedCount: descendantIds.size,
        containedSectionCount: countSectionIds(descendantIds, graph)
      },
      hiddenIds: descendantIds
    };
    hideSelectionMoveNodes(descendantIds);
  }

  function clearSectionNodeDragPreview() {
    const preview = runtime.sectionNodeDragPreview.value;

    if (!preview) {
      return;
    }

    runtime.sectionNodeDragPreview.value = null;
    clearSelectionMoveHiddenNodes();
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
    const hiddenIds = buildSelectionMoveHiddenIds(normalizedOriginalNodes, movingIds);
    const { counts: previewCounts, shapeKinds: previewShapeKinds } =
      buildSelectionMovePreviewMetadata(normalizedOriginalNodes, movingIds, hiddenIds);
    const movingIndexes = normalizedOriginalNodes
      .map((node, index) => (movingIds.has(node.id) ? index : -1))
      .filter((index) => index >= 0);
    const mode =
      largeSelectionMovePreviewMode === "bundle" &&
      hiddenIds.size > largeSelectionMovePreviewThreshold
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
      hiddenIds,
      previewCounts,
      previewShapeKinds,
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
    clearSectionNodeDragPreview();
  }

  return {
    cleanupSelectionMove,
    clearSectionNodeDragPreview,
    handleSelectedBoundsPointerDown,
    handleSectionNodeDragStart,
    selectionMovePreview
  };
}
