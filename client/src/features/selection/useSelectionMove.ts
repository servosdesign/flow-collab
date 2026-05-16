import type { NodeChange, NodeDragItem } from "@vue-flow/core";
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
  SelectionMoveRuntimeSnapshot,
  SelectionMovePreviewShapeKind
} from "../../flowTypes";

type LargeSelectionMovePreviewMode = "bundle" | "visible";

const largeSelectionMovePreviewMode: LargeSelectionMovePreviewMode = "bundle";
const largeSelectionMovePreviewThreshold = 8;
const hideSelectedNodesDuringBundleMove = true;
const maxSelectionMovePreviewShapes = 36;
const nodePointerMoveThreshold = 3;
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

type RuntimePositionedFlowNode = FlowNode & {
  computedPosition?: { x: number; y: number; z?: number };
  dragging?: boolean;
};

type SelectionMoveStartOptions = {
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  pointerId: number;
  target: HTMLElement | null;
  previewElement: HTMLElement | null;
  movingIds: Set<string>;
  selectedBounds: SelectionMoveDrag["selectedBounds"];
  forceVisible?: boolean;
};

type PendingNodePointerMove = {
  nodeId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  target: HTMLElement | null;
};

export function useSelectionMove(
  runtime: FlowRuntime,
  services: FlowEditorServices,
  options: UseSelectionMoveOptions
) {
  let selectionMovePointerCaptureTarget: HTMLElement | null = null;
  let selectionMovePreviewElement: HTMLElement | null = null;
  let selectionMoveHiddenClassSnapshots: HiddenNodeClassSnapshot[] = [];
  let selectionMovePointerId: number | null = null;
  let pendingNodePointerMove: PendingNodePointerMove | null = null;

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

  function getNodeBoundsSnapshot(nodeId: string, allNodes: SyncNode[]) {
    const graph = createGraphCache(allNodes);
    const node = graph.nodeById.get(nodeId);

    if (!node) {
      return null;
    }

    const bounds = getNodeBounds(node, graph);
    const viewport = runtime.currentViewport.value;
    const padding = 4;

    return {
      left: bounds.x * viewport.zoom + viewport.x - padding,
      top: bounds.y * viewport.zoom + viewport.y - padding,
      width: bounds.width * viewport.zoom + padding * 2,
      height: bounds.height * viewport.zoom + padding * 2
    };
  }

  function getSelectionOutlineElement(event: PointerEvent, target: HTMLElement | null) {
    return (
      (event.target instanceof Element
        ? event.target.closest<HTMLElement>(".selected-nodes-outline")
        : null) ??
      target?.closest<HTMLElement>(".selected-nodes-outline") ??
      runtime.canvasPanel.value?.querySelector<HTMLElement>(".selected-nodes-outline") ??
      null
    );
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

    const runtimeSnapshotsById = buildSelectionMoveRuntimeSnapshots(movingIds);

    return {
      dragItems,
      originalPositionsById,
      runtimeSnapshotsById
    };
  }

  function buildSelectionMoveRuntimeSnapshots(movingIds: Set<string>) {
    const snapshotsById = new Map<string, SelectionMoveRuntimeSnapshot>();

    movingIds.forEach((nodeId) => {
      const node = runtime.findNode(nodeId) as RuntimePositionedFlowNode | undefined;

      if (!node) {
        return;
      }

      const hasComputedPosition = Object.prototype.hasOwnProperty.call(node, "computedPosition");
      const hasDragging = Object.prototype.hasOwnProperty.call(node, "dragging");

      snapshotsById.set(nodeId, {
        id: nodeId,
        position: { ...node.position },
        hadComputedPosition: hasComputedPosition,
        computedPosition: node.computedPosition ? { ...node.computedPosition } : undefined,
        hadDragging: hasDragging,
        dragging: node.dragging
      });
    });

    return snapshotsById;
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

  function getDragItemRuntimePosition(dragItem: NodeDragItem) {
    if (!dragItem.parentNode) {
      return { ...dragItem.position };
    }

    const parentNode = runtime.findNode(dragItem.parentNode) as RuntimePositionedFlowNode | undefined;

    return {
      x: Math.round(dragItem.position.x - (parentNode?.computedPosition?.x ?? 0)),
      y: Math.round(dragItem.position.y - (parentNode?.computedPosition?.y ?? 0))
    };
  }

  function getDragItemComputedPosition(dragItem: NodeDragItem, node: RuntimePositionedFlowNode) {
    return {
      ...(node.computedPosition ?? { z: 0 }),
      x: dragItem.position.x,
      y: dragItem.position.y
    };
  }

  function applyRuntimeDragItemPositions(dragItems: NodeDragItem[], dragging: boolean) {
    const changes: NodeChange[] = [];
    const runtimeUpdates: Array<{
      id: string;
      position: { x: number; y: number };
      computedPosition: { x: number; y: number; z?: number };
    }> = [];

    dragItems.forEach((dragItem) => {
      const node = runtime.findNode(dragItem.id) as RuntimePositionedFlowNode | undefined;

      if (!node) {
        return;
      }

      const nextPosition = getDragItemRuntimePosition(dragItem);
      const nextComputedPosition = getDragItemComputedPosition(dragItem, node);
      const positionChanged =
        node.position.x !== nextPosition.x ||
        node.position.y !== nextPosition.y ||
        node.dragging !== dragging;
      const computedPositionChanged =
        node.computedPosition?.x !== nextComputedPosition.x ||
        node.computedPosition?.y !== nextComputedPosition.y;

      if (!positionChanged && !computedPositionChanged) {
        return;
      }

      if (positionChanged) {
        changes.push({
          id: dragItem.id,
          type: "position",
          position: nextPosition,
          from: dragItem.from,
          dragging
        });
      }

      runtimeUpdates.push({
        id: dragItem.id,
        position: nextPosition,
        computedPosition: nextComputedPosition
      });
    });

    if (changes.length > 0) {
      runtime.applyNodeChanges(changes);
    }

    runtimeUpdates.forEach((update) => {
      const node = runtime.findNode(update.id) as RuntimePositionedFlowNode | undefined;

      if (!node) {
        return;
      }

      if (
        node.position.x !== update.position.x ||
        node.position.y !== update.position.y
      ) {
        node.position = update.position;
      }

      node.computedPosition = update.computedPosition;
      node.dragging = dragging;
    });
  }

  function restoreSelectionMoveRuntimeSnapshots(drag: SelectionMoveDrag) {
    drag.runtimeSnapshotsById.forEach((snapshot) => {
      const node = runtime.findNode(snapshot.id) as RuntimePositionedFlowNode | undefined;

      if (!node) {
        return;
      }

      node.position = { ...snapshot.position };

      if (snapshot.hadComputedPosition && snapshot.computedPosition) {
        node.computedPosition = { ...snapshot.computedPosition };
      } else {
        delete node.computedPosition;
      }

      if (snapshot.hadDragging) {
        node.dragging = snapshot.dragging;
      } else {
        delete node.dragging;
      }
    });
  }

  function applyVisibleSelectionMove(selectionMoveDrag: SelectionMoveDrag, dragging: boolean) {
    const changed = updateSelectionDragItemPositions(selectionMoveDrag);

    if (changed || !dragging) {
      applyRuntimeDragItemPositions(selectionMoveDrag.dragItems, dragging);
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

  function buildCommittedSelectionMoveNodes(
    selectionMoveDrag: SelectionMoveDrag,
    baseNodes = selectionMoveDrag.originalSyncNodes
  ) {
    const delta = getSelectionMoveDelta(selectionMoveDrag);

    return baseNodes.map((node) => {
      if (!selectionMoveDrag.movingIds.has(node.id)) {
        return node;
      }

      const originalNode = selectionMoveDrag.originalSyncNodesById.get(node.id);

      if (!originalNode) {
        return node;
      }

      return {
        ...node,
        position: {
          x: Math.round(originalNode.position.x + delta.x),
          y: Math.round(originalNode.position.y + delta.y)
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
    applyVisibleSelectionMove(drag, false);

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

  function beginSelectionMove(options: SelectionMoveStartOptions) {
    const normalizedOriginalNodes = (runtime.nodes.value as FlowNode[]).map(normalizeNode);
    const movingIds = options.movingIds;

    if (movingIds.size === 0) {
      return false;
    }

    const hiddenIds = buildSelectionMoveHiddenIds(normalizedOriginalNodes, movingIds);
    const { counts: previewCounts, shapeKinds: previewShapeKinds } =
      buildSelectionMovePreviewMetadata(normalizedOriginalNodes, movingIds, hiddenIds);
    const movingIndexes = normalizedOriginalNodes
      .map((node, index) => (movingIds.has(node.id) ? index : -1))
      .filter((index) => index >= 0);
    const mode =
      !options.forceVisible &&
      largeSelectionMovePreviewMode === "bundle" &&
      hiddenIds.size > largeSelectionMovePreviewThreshold
        ? "bundle"
        : "visible";
    const originalSyncNodesById = new Map(normalizedOriginalNodes.map((node) => [node.id, node]));
    const { dragItems, originalPositionsById, runtimeSnapshotsById } = buildSelectionMoveDragMetadata(
      normalizedOriginalNodes,
      movingIds
    );

    if (dragItems.length === 0 || movingIndexes.length === 0) {
      return false;
    }

    selectionMovePointerCaptureTarget = options.target;
    selectionMovePointerId = options.pointerId;
    clearSelectionMovePreview();
    selectionMovePreviewElement = options.previewElement;
    if (selectionMovePreviewElement) {
      selectionMovePreviewElement.style.willChange = "transform";
    }
    if (options.target && typeof options.target.setPointerCapture === "function") {
      try {
        options.target.setPointerCapture(options.pointerId);
      } catch {
        selectionMovePointerCaptureTarget = null;
      }
    }

    runtime.interaction.selectionMoveDrag = {
      mode,
      startClientX: options.startClientX,
      startClientY: options.startClientY,
      currentClientX: options.currentClientX,
      currentClientY: options.currentClientY,
      originalSyncNodes: normalizedOriginalNodes,
      originalSyncNodesById,
      originalPositionsById,
      runtimeSnapshotsById,
      dragItems,
      movingIds,
      movingIndexes,
      hiddenIds,
      previewCounts,
      previewShapeKinds,
      selectedBounds: options.selectedBounds
    };
    hideBundleSelectionNodes(runtime.interaction.selectionMoveDrag);
    runtime.isMovingSelection.value = true;

    return true;
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
    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;

    const started = beginSelectionMove({
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      pointerId: event.pointerId,
      target,
      previewElement: getSelectionOutlineElement(event, target),
      movingIds,
      selectedBounds: getSelectedBoundsSnapshot()
    });

    if (!started) {
      return;
    }

    window.addEventListener("pointermove", handleSelectedBoundsPointerMove, { capture: true });
    window.addEventListener("pointerup", handleSelectedBoundsPointerUp, { capture: true, once: true });
  }

  function handleSelectedBoundsPointerMove(event: PointerEvent) {
    if (selectionMovePointerId !== null && event.pointerId !== selectionMovePointerId) {
      return;
    }

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

  function clearSelectionMovePresentation() {
    clearSelectionMovePreview();
    clearSectionNodeDragPreview();
  }

  function finishSelectionMovePointerUp(event: PointerEvent) {
    if (selectionMovePointerId !== null && event.pointerId !== selectionMovePointerId) {
      return;
    }

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
    selectionMovePointerId = null;

    if (!drag) {
      runtime.interaction.selectionMoveDrag = null;
      runtime.isMovingSelection.value = false;
      services.scheduleSelectionBoundsRefresh();
      clearSelectionMovePresentation();
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350;
    const committed = commitMovedSelectedNodes(drag);
    runtime.interaction.selectionMoveDrag = null;
    runtime.isMovingSelection.value = false;
    services.scheduleSelectionBoundsRefresh();
    if (committed) {
      nextTick(clearSelectionMovePresentation);
    } else {
      clearSelectionMovePresentation();
    }
  }

  function handleSelectedBoundsPointerUp(event: PointerEvent) {
    if (selectionMovePointerId !== null && event.pointerId !== selectionMovePointerId) {
      return;
    }

    window.removeEventListener("pointermove", handleSelectedBoundsPointerMove, true);
    runtime.isResizingNode.value = false;
    finishSelectionMovePointerUp(event);
  }

  function attachSelectionMovePreviewElementOnNextTick() {
    nextTick(() => {
      const drag = runtime.interaction.selectionMoveDrag;

      if (!drag || selectionMovePreviewElement) {
        return;
      }

      const element = runtime.canvasPanel.value?.querySelector<HTMLElement>(".selected-nodes-outline") ?? null;

      if (!element) {
        return;
      }

      selectionMovePreviewElement = element;
      selectionMovePreviewElement.style.willChange = "transform";
      paintSelectionMovePreview(drag);
    });
  }

  function startPendingNodePointerMove(event: PointerEvent, pending: PendingNodePointerMove) {
    const normalizedOriginalNodes = (runtime.nodes.value as FlowNode[]).map(normalizeNode);
    const selectedIds = options.getSelectedNodeIds();
    const selectedIdSet = new Set(selectedIds);
    const node = normalizedOriginalNodes.find((candidate) => candidate.id === pending.nodeId);

    if (!node) {
      return false;
    }

    const moveSelection = selectedIds.length > 1 && selectedIdSet.has(pending.nodeId);
    const movingIds = moveSelection
      ? getMovableSelectedIds(normalizedOriginalNodes)
      : new Set([pending.nodeId]);
    const useSingleSectionPreview = !moveSelection && node.type === "section";
    const selectedBounds = moveSelection
      ? getSelectedBoundsSnapshot()
      : useSingleSectionPreview
        ? getNodeBoundsSnapshot(pending.nodeId, normalizedOriginalNodes)
        : null;
    const started = beginSelectionMove({
      startClientX: pending.startClientX,
      startClientY: pending.startClientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      pointerId: pending.pointerId,
      target: pending.target,
      previewElement: moveSelection
        ? getSelectionOutlineElement(event, pending.target)
        : null,
      movingIds,
      selectedBounds,
      forceVisible: useSingleSectionPreview
    });

    if (!started) {
      return false;
    }

    if (useSingleSectionPreview) {
      handleSectionNodeDragStart(pending.nodeId);
      attachSelectionMovePreviewElementOnNextTick();
    }

    runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350;
    return true;
  }

  function clearPendingNodePointerMove(event?: PointerEvent) {
    if (
      event &&
      selectionMovePointerCaptureTarget?.hasPointerCapture(event.pointerId)
    ) {
      selectionMovePointerCaptureTarget.releasePointerCapture(event.pointerId);
    }

    pendingNodePointerMove = null;
    selectionMovePointerCaptureTarget = null;
    selectionMovePointerId = null;
    window.removeEventListener("pointermove", handleNodePointerMove, true);
    window.removeEventListener("pointerup", handleNodePointerUp, true);
    window.removeEventListener("pointercancel", handleNodePointerCancel, true);
  }

  function handleNodePointerMove(event: PointerEvent) {
    if (runtime.interaction.selectionMoveDrag) {
      handleSelectedBoundsPointerMove(event);
      return;
    }

    const pending = pendingNodePointerMove;

    if (!pending || event.pointerId !== pending.pointerId) {
      return;
    }

    if (!runtime.interaction.selectionMoveDrag) {
      const movedPastThreshold =
        Math.abs(event.clientX - pending.startClientX) > nodePointerMoveThreshold ||
        Math.abs(event.clientY - pending.startClientY) > nodePointerMoveThreshold;

      if (!movedPastThreshold) {
        return;
      }

      if (!startPendingNodePointerMove(event, pending)) {
        clearPendingNodePointerMove(event);
        return;
      }

      pendingNodePointerMove = null;
    }

    handleSelectedBoundsPointerMove(event);
  }

  function handleNodePointerUp(event: PointerEvent) {
    const pending = pendingNodePointerMove;

    if (
      (pending && event.pointerId !== pending.pointerId) ||
      (selectionMovePointerId !== null && event.pointerId !== selectionMovePointerId)
    ) {
      return;
    }

    window.removeEventListener("pointermove", handleNodePointerMove, true);
    window.removeEventListener("pointerup", handleNodePointerUp, true);
    window.removeEventListener("pointercancel", handleNodePointerCancel, true);
    pendingNodePointerMove = null;
    runtime.isResizingNode.value = false;

    if (!runtime.interaction.selectionMoveDrag) {
      if (selectionMovePointerCaptureTarget?.hasPointerCapture(event.pointerId)) {
        selectionMovePointerCaptureTarget.releasePointerCapture(event.pointerId);
      }
      selectionMovePointerCaptureTarget = null;
      selectionMovePointerId = null;
      return;
    }

    finishSelectionMovePointerUp(event);
  }

  function handleNodePointerCancel(event: PointerEvent) {
    const pending = pendingNodePointerMove;

    if (
      (pending && event.pointerId !== pending.pointerId) ||
      (selectionMovePointerId !== null && event.pointerId !== selectionMovePointerId)
    ) {
      return;
    }

    clearPendingNodePointerMove(event);
    if (runtime.interaction.selectionMoveDrag?.frame) {
      window.cancelAnimationFrame(runtime.interaction.selectionMoveDrag.frame);
      runtime.interaction.selectionMoveDrag.frame = undefined;
    }
    if (runtime.interaction.selectionMoveDrag) {
      restoreSelectionMoveRuntimeSnapshots(runtime.interaction.selectionMoveDrag);
    }
    runtime.interaction.selectionMoveDrag = null;
    runtime.isMovingSelection.value = false;
    runtime.isResizingNode.value = false;
    clearSelectionMovePresentation();
    services.scheduleSelectionBoundsRefresh();
  }

  function beginNodePointerMove(event: PointerEvent, nodeId: string) {
    if (
      !runtime.isLoggedIn.value ||
      event.button !== 0 ||
      runtime.interaction.selectionMoveDrag ||
      pendingNodePointerMove
    ) {
      return false;
    }

    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".vue-flow__node[data-id]")
      : null;

    pendingNodePointerMove = {
      nodeId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      target
    };
    selectionMovePointerCaptureTarget = target;
    selectionMovePointerId = event.pointerId;
    if (target && typeof target.setPointerCapture === "function") {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        selectionMovePointerCaptureTarget = null;
      }
    }

    window.addEventListener("pointermove", handleNodePointerMove, { capture: true });
    window.addEventListener("pointerup", handleNodePointerUp, { capture: true, once: true });
    window.addEventListener("pointercancel", handleNodePointerCancel, { capture: true, once: true });

    return true;
  }

  function commitMovedSelectedNodes(drag: SelectionMoveDrag) {
    const document = runtime.flowDocument.value;
    const movingIds = drag.movingIds;

    if (!document || movingIds.size === 0) {
      services.submitGraphSnapshot();
      return false;
    }

    if (!hasCommittedSelectionMovePositionChange(drag)) {
      restoreSelectionMoveRuntimeSnapshots(drag);
      return false;
    }

    const nextNodes = buildCommittedSelectionMoveNodes(drag, document.data.nodes);
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
    window.removeEventListener("pointermove", handleNodePointerMove, true);
    window.removeEventListener("pointerup", handleNodePointerUp, true);
    window.removeEventListener("pointercancel", handleNodePointerCancel, true);
    if (runtime.interaction.selectionMoveDrag?.frame) {
      window.cancelAnimationFrame(runtime.interaction.selectionMoveDrag.frame);
      runtime.interaction.selectionMoveDrag.frame = undefined;
    }
    if (runtime.interaction.selectionMoveDrag) {
      restoreSelectionMoveRuntimeSnapshots(runtime.interaction.selectionMoveDrag);
    }
    clearSelectionMovePresentation();
    runtime.interaction.selectionMoveDrag = null;
    selectionMovePointerCaptureTarget = null;
    selectionMovePointerId = null;
    pendingNodePointerMove = null;
  }

  return {
    cleanupSelectionMove,
    clearSectionNodeDragPreview,
    beginNodePointerMove,
    handleSelectedBoundsPointerDown,
    handleSectionNodeDragStart,
    selectionMovePreview
  };
}
