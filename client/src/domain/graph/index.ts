import { MarkerType, type Edge, type Node } from "@vue-flow/core";
import type {
  FlowNodeKind,
  SyncEdge,
  SyncNode,
  SyncNodeData,
  SyncPort
} from "@vue-flow-sync/shared";

export { cloneJson, createReplaceOp, sameJson } from "./json";

export type FlowNode = Node<SyncNodeData, Record<string, never>, FlowNodeKind> & {
  selected?: boolean;
};
export type FlowEdge = Edge<Record<string, never>>;
export type ResizeParams = { x?: number; y?: number; width: number; height: number };
export type MovedNodeMembershipChange = {
  nodeId: string;
  absolutePosition?: { x: number; y: number };
  dimensions?: { width: number; height: number };
  existingNode?: SyncNode;
};

export type GraphCache = {
  nodes: SyncNode[];
  edges: SyncEdge[];
  nodeById: Map<string, SyncNode>;
  edgeById: Map<string, SyncEdge>;
  childrenByParentId: Map<string, SyncNode[]>;
  edgesByNodeId: Map<string, SyncEdge[]>;
  sections: SyncNode[];
};

export function defaultPorts(): SyncPort[] {
  return [{ id: "main", color: "#0f766e" }];
}

export function toNodeSizeStyle(width: number, height: number) {
  return {
    width: `${Math.round(width)}px`,
    height: `${Math.round(height)}px`
  };
}

export function getNodeSize(
  node: Pick<SyncNode, "style" | "width" | "height"> & {
    dimensions?: { width?: number; height?: number };
  },
  fallbackWidth: number,
  fallbackHeight: number
) {
  const width =
    typeof node.style?.width === "number"
      ? node.style.width
      : Number.parseFloat(
          String(node.style?.width ?? node.width ?? node.dimensions?.width ?? fallbackWidth)
        );
  const height =
    typeof node.style?.height === "number"
      ? node.style.height
      : Number.parseFloat(
          String(node.style?.height ?? node.height ?? node.dimensions?.height ?? fallbackHeight)
        );

  return {
    width: Number.isFinite(width) ? width : fallbackWidth,
    height: Number.isFinite(height) ? height : fallbackHeight
  };
}

export const itemBodyCharactersPerLine = 70;
const itemNodePaddingHeight = 24;
const itemNodeGridGap = 9;
const itemNodeHeaderHeight = 32;
const itemNodeDividerHeight = 1;
const itemNodeToolsHeight = 36;
const itemNodeMinimumTextAreaHeight = 30;
const itemNodeImageHeight = 130;
const itemNodeBarsWidgetHeight = 46;
const itemNodeGaugeWidgetHeight = 48;
const itemNodeMatrixWidgetHeight = 72;

export function estimateBodyHeight(body: string, charactersPerLine = itemBodyCharactersPerLine) {
  if (!body) {
    return 72;
  }

  const rows = body
    .split("\n")
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);

  return Math.max(72, rows * 17 + 18);
}

function getItemWidgetHeight(nodeId: string) {
  const seed = Array.from(nodeId).reduce(
    (total, character) => total + character.charCodeAt(0),
    0
  );

  switch (seed % 4) {
    case 0:
      return itemNodeBarsWidgetHeight;
    case 1:
      return itemNodeMatrixWidgetHeight;
    case 2:
      return itemNodeGaugeWidgetHeight;
    default:
      return 0;
  }
}

export function getMeasuredItemNodeHeight(node: SyncNode, measuredBodyHeight?: number) {
  const body = node.data.body ?? node.data.text ?? "";
  const bodyHeight =
    typeof measuredBodyHeight === "number" && Number.isFinite(measuredBodyHeight)
      ? Math.max(itemNodeMinimumTextAreaHeight, Math.ceil(measuredBodyHeight))
      : estimateBodyHeight(body);
  const imageHeight = node.data.imageUrl ? itemNodeImageHeight : 0;
  const widgetHeight = getItemWidgetHeight(node.id);
  const portHeight = Math.max(0, (node.data.ports?.length ?? 1) - 6) * 22;
  const rowCount = 4 + (imageHeight > 0 ? 1 : 0) + (widgetHeight > 0 ? 1 : 0);
  const gapHeight = Math.max(0, rowCount - 1) * itemNodeGridGap;

  return Math.max(
    190,
    itemNodePaddingHeight +
      itemNodeHeaderHeight +
      itemNodeDividerHeight +
      bodyHeight +
      itemNodeToolsHeight +
      imageHeight +
      widgetHeight +
      gapHeight +
      portHeight
  );
}

export function getMinimumNodeHeight(node: SyncNode) {
  if (node.type === "section") {
    return getNodeSize(node, 520, 360).height;
  }

  return getMeasuredItemNodeHeight(node);
}

export function getMinimumNodeWidth(node: SyncNode) {
  if (node.type === "section") {
    return getNodeSize(node, 520, 360).width;
  }

  const ports = node.data.ports?.length ?? 1;

  return 320 + Math.max(0, ports - 8) * 14;
}

export function withContentSizedNode(node: SyncNode): SyncNode {
  if (node.type !== "item") {
    return node;
  }

  const size = getNodeSize(node, 260, 260);
  const minimumHeight = Math.ceil(getMinimumNodeHeight(node));
  const minimumWidth = Math.ceil(getMinimumNodeWidth(node));

  if (size.height >= minimumHeight && size.width >= minimumWidth) {
    return {
      ...node,
      width: Math.round(size.width),
      height: Math.round(size.height),
      style: {
        ...(node.style ?? {}),
        ...toNodeSizeStyle(size.width, size.height)
      }
    };
  }

  const width = Math.max(size.width, minimumWidth);
  const height = Math.max(size.height, minimumHeight);

  return {
    ...node,
    width: Math.round(width),
    height: Math.round(height),
    style: {
      ...(node.style ?? {}),
      ...toNodeSizeStyle(width, height)
    }
  };
}

export function normalizeNode(node: FlowNode): SyncNode {
  const measuredNode = node as FlowNode & { dimensions?: { width?: number; height?: number } };
  const nodeType: FlowNodeKind = node.type === "section" ? "section" : "item";
  const data = node.data ?? { nodeType, title: node.id, body: "" };
  const title = data.title ?? data.text ?? node.id;
  const body = data.body ?? (data.title ? "" : data.text ?? "");
  const ports = data.ports?.length ? data.ports : defaultPorts();
  const normalized: SyncNode = {
    id: node.id,
    type: nodeType,
    position: {
      x: Math.round(node.position.x),
      y: Math.round(node.position.y)
    },
    selectable: true,
    data: {
      nodeType,
      title: String(title),
      body: String(body),
      imageUrl: data.imageUrl,
      ports: ports.map((port) => ({ ...port }))
    }
  };

  if (node.parentNode) {
    normalized.parentNode = node.parentNode;
    normalized.expandParent = false;
  }

  if (node.style) {
    normalized.style = node.style as Record<string, string | number>;
  }

  const size = getNodeSize(
    {
      ...normalized,
      dimensions: measuredNode.dimensions
    },
    nodeType === "section" ? 720 : 240,
    nodeType === "section" ? 620 : 190
  );
  normalized.width = Math.round(size.width);
  normalized.height = Math.round(size.height);
  normalized.style = {
    ...(normalized.style ?? {}),
    ...toNodeSizeStyle(size.width, size.height)
  };

  return normalized;
}

export function stripParentExtent(node: SyncNode): SyncNode {
  const nextNode = { ...node };
  delete nextNode.extent;
  delete nextNode.dragHandle;

  const size = getNodeSize(
    nextNode,
    nextNode.type === "section" ? 720 : 240,
    nextNode.type === "section" ? 620 : 190
  );
  nextNode.width = Math.round(size.width);
  nextNode.height = Math.round(size.height);
  nextNode.style = {
    ...(nextNode.style ?? {}),
    ...toNodeSizeStyle(size.width, size.height)
  };

  return nextNode;
}

export function createGraphCache(nodes: SyncNode[], edges: SyncEdge[] = []): GraphCache {
  const nodeById = new Map<string, SyncNode>();
  const edgeById = new Map<string, SyncEdge>();
  const childrenByParentId = new Map<string, SyncNode[]>();
  const edgesByNodeId = new Map<string, SyncEdge[]>();
  const sections: SyncNode[] = [];

  for (const node of nodes) {
    nodeById.set(node.id, node);
    if (node.type === "section") {
      sections.push(node);
    }
    if (node.parentNode) {
      const children = childrenByParentId.get(node.parentNode) ?? [];
      children.push(node);
      childrenByParentId.set(node.parentNode, children);
    }
  }

  for (const edge of edges) {
    edgeById.set(edge.id, edge);
    const sourceEdges = edgesByNodeId.get(edge.source) ?? [];
    sourceEdges.push(edge);
    edgesByNodeId.set(edge.source, sourceEdges);
    const targetEdges = edgesByNodeId.get(edge.target) ?? [];
    targetEdges.push(edge);
    edgesByNodeId.set(edge.target, targetEdges);
  }

  return {
    nodes,
    edges,
    nodeById,
    edgeById,
    childrenByParentId,
    edgesByNodeId,
    sections
  };
}

export function orderNodesByHierarchy(nodes: SyncNode[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const originalIndexById = new Map(nodes.map((node, index) => [node.id, index]));
  const childrenByParentId = new Map<string, SyncNode[]>();
  const remainingParentsById = new Map<string, number>();

  for (const node of nodes) {
    const parent = node.parentNode ? nodeById.get(node.parentNode) : undefined;

    if (!parent || parent.id === node.id) {
      remainingParentsById.set(node.id, 0);
      continue;
    }

    remainingParentsById.set(node.id, 1);
    const children = childrenByParentId.get(parent.id) ?? [];
    children.push(node);
    childrenByParentId.set(parent.id, children);
  }

  const ordered: SyncNode[] = [];
  const available = nodes.filter((node) => (remainingParentsById.get(node.id) ?? 0) === 0);

  function sortByOriginalOrder(candidates: SyncNode[]) {
    candidates.sort(
      (left, right) =>
        (originalIndexById.get(left.id) ?? 0) - (originalIndexById.get(right.id) ?? 0)
    );
  }

  sortByOriginalOrder(available);

  while (available.length > 0) {
    const node = available.shift();

    if (!node) {
      break;
    }

    ordered.push(node);

    const children = childrenByParentId.get(node.id) ?? [];
    for (const child of children) {
      const remainingParents = Math.max(0, (remainingParentsById.get(child.id) ?? 0) - 1);
      remainingParentsById.set(child.id, remainingParents);

      if (remainingParents === 0) {
        available.push(child);
      }
    }

    sortByOriginalOrder(available);
  }

  if (ordered.length < nodes.length) {
    const orderedIds = new Set(ordered.map((node) => node.id));
    ordered.push(...nodes.filter((node) => !orderedIds.has(node.id)));
  }

  nodes.splice(0, nodes.length, ...ordered);

  return nodes;
}

export function isNodeInsideSection(
  nodeId: string | null | undefined,
  sectionId: string,
  graph: GraphCache
) {
  if (!nodeId) {
    return false;
  }

  let current = graph.nodeById.get(nodeId);

  while (current?.parentNode) {
    if (current.parentNode === sectionId) {
      return true;
    }

    current = graph.nodeById.get(current.parentNode);
  }

  return false;
}

export function isDirectChildOfSection(
  nodeId: string | null | undefined,
  sectionId: string,
  graph: GraphCache
) {
  const node = graph.nodeById.get(nodeId ?? "");

  return node?.parentNode === sectionId;
}

export function shouldUseSectionThroughEdge(
  edge: Pick<SyncEdge, "source" | "target" | "sourceHandle" | "targetHandle">,
  graph: GraphCache
) {
  const source = graph.nodeById.get(edge.source);
  const target = graph.nodeById.get(edge.target);

  if (!source || !target) {
    return false;
  }

  return (
    (source.type === "section" &&
      edge.sourceHandle === "section-left" &&
      isDirectChildOfSection(target.id, source.id, graph)) ||
    (target.type === "section" &&
      edge.targetHandle === "section-right" &&
      isDirectChildOfSection(source.id, target.id, graph)) ||
    (target.type === "section" &&
      edge.targetHandle === "section-left" &&
      isDirectChildOfSection(source.id, target.id, graph))
  );
}

export function getEdgeRenderType(
  edge: Pick<SyncEdge, "source" | "target" | "sourceHandle" | "targetHandle" | "type">,
  graph: GraphCache
) {
  const source = graph.nodeById.get(edge.source);
  const target = graph.nodeById.get(edge.target);
  const usesSectionPort =
    (source?.type === "section" && edge.sourceHandle?.startsWith("section-")) ||
    (target?.type === "section" && edge.targetHandle?.startsWith("section-"));

  return usesSectionPort || shouldUseSectionThroughEdge(edge, graph) ? "section-through" : "step";
}

export function normalizeEdge(edge: FlowEdge, graph: GraphCache): SyncEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
    type: getEdgeRenderType(edge, graph),
    animated: Boolean(edge.animated),
    markerEnd: MarkerType.ArrowClosed
  };
}

export function withDefaultEdges(flowEdges: SyncEdge[], graph: GraphCache) {
  return flowEdges.map((edge) => ({
    ...edge,
    type: getEdgeRenderType(edge, graph),
    markerEnd: MarkerType.ArrowClosed
  })) as FlowEdge[];
}

export function getAbsolutePosition(
  node: Pick<SyncNode, "id" | "parentNode" | "position">,
  graph: GraphCache
): { x: number; y: number } {
  if (!node.parentNode) {
    return { ...node.position };
  }

  const parent = graph.nodeById.get(node.parentNode);

  if (!parent) {
    return { ...node.position };
  }

  const parentPosition = getAbsolutePosition(parent, graph);

  return {
    x: parentPosition.x + node.position.x,
    y: parentPosition.y + node.position.y
  };
}

export function isAncestorSection(ancestorId: string, nodeId: string, graph: GraphCache) {
  let current = graph.nodeById.get(nodeId);

  while (current?.parentNode) {
    if (current.parentNode === ancestorId) {
      return true;
    }

    current = graph.nodeById.get(current.parentNode);
  }

  return false;
}

export function getNodeBounds(node: SyncNode, graph: GraphCache) {
  const size = getNodeSize(
    node,
    node.type === "section" ? 720 : 240,
    node.type === "section" ? 620 : 190
  );
  const position = getAbsolutePosition(node, graph);

  return {
    ...position,
    ...size
  };
}

export function getRenderedNodeBounds(node: SyncNode, graph: GraphCache) {
  const bounds = getNodeBounds(node, graph);

  if (node.type === "item") {
    bounds.height = Math.max(bounds.height, getMinimumNodeHeight(node));
  }

  return bounds;
}

export function getOverlapRatio(
  nodeBounds: { x: number; y: number; width: number; height: number },
  sectionBounds: { x: number; y: number; width: number; height: number }
) {
  const overlapWidth = Math.max(
    0,
    Math.min(nodeBounds.x + nodeBounds.width, sectionBounds.x + sectionBounds.width) -
      Math.max(nodeBounds.x, sectionBounds.x)
  );
  const overlapHeight = Math.max(
    0,
    Math.min(nodeBounds.y + nodeBounds.height, sectionBounds.y + sectionBounds.height) -
      Math.max(nodeBounds.y, sectionBounds.y)
  );
  return (overlapWidth * overlapHeight) / getBoundsArea(nodeBounds);
}

function getBoundsArea(bounds: { width: number; height: number }) {
  return Math.max(1, bounds.width * bounds.height);
}

function isBoundsCoveredEnough(
  boundsToCover: { x: number; y: number; width: number; height: number },
  coveringBounds: { x: number; y: number; width: number; height: number }
) {
  return getOverlapRatio(boundsToCover, coveringBounds) >= 0.5;
}

export function findContainingSectionForBounds(
  draggedNodeId: string,
  draggedBounds: { x: number; y: number; width: number; height: number },
  graph: GraphCache
) {
  let bestSection: SyncNode | undefined;
  let bestRatio = 0;
  let bestArea = Number.POSITIVE_INFINITY;

  for (const node of graph.sections) {
    if (node.id === draggedNodeId || isAncestorSection(draggedNodeId, node.id, graph)) {
      continue;
    }

    const sectionBounds = getNodeBounds(node, graph);
    const ratio = getOverlapRatio(draggedBounds, sectionBounds);
    const area = getBoundsArea(sectionBounds);

    if (ratio >= 0.5 && (ratio > bestRatio || (ratio === bestRatio && area < bestArea))) {
      bestSection = node;
      bestRatio = ratio;
      bestArea = area;
    }
  }

  return bestSection;
}

export function isNodeInsideSectionEnough(node: SyncNode, section: SyncNode, graph: GraphCache) {
  return isBoundsCoveredEnough(getRenderedNodeBounds(node, graph), getNodeBounds(section, graph));
}

export function setNodeParentForSection(node: SyncNode, section: SyncNode, graph: GraphCache) {
  const absolutePosition = getAbsolutePosition(node, graph);
  const sectionPosition = getAbsolutePosition(section, graph);

  node.parentNode = section.id;
  node.expandParent = false;
  delete node.extent;
  node.position = {
    x: Math.round(absolutePosition.x - sectionPosition.x),
    y: Math.round(absolutePosition.y - sectionPosition.y)
  };
}

export function removeNodeFromSection(node: SyncNode, graph: GraphCache) {
  const absolutePosition = getAbsolutePosition(node, graph);

  delete node.parentNode;
  delete node.expandParent;
  delete node.extent;
  node.position = {
    x: Math.round(absolutePosition.x),
    y: Math.round(absolutePosition.y)
  };
}

export function adoptContainedNodesIntoSection(section: SyncNode, graph: GraphCache) {
  if (section.type !== "section") {
    return false;
  }

  let changed = false;

  for (const node of graph.nodes) {
    if (
      node.id === section.id ||
      isNodeInsideSection(node.id, section.id, graph) ||
      isAncestorSection(node.id, section.id, graph)
    ) {
      continue;
    }

    if (isNodeInsideSectionEnough(node, section, graph)) {
      setNodeParentForSection(node, section, graph);
      changed = true;
    }
  }

  return changed;
}

export function pruneEdgesAfterSectionExit(
  edgesToFilter: SyncEdge[],
  movedNodeId: string,
  oldSectionId: string,
  graph: GraphCache
) {
  const oldSectionNodeIds = new Set(
    graph.nodes
      .filter((node) => node.id === oldSectionId || node.parentNode === oldSectionId)
      .map((node) => node.id)
  );

  return edgesToFilter.filter((edge) => {
    if (edge.source === movedNodeId) {
      return !oldSectionNodeIds.has(edge.target);
    }

    if (edge.target === movedNodeId) {
      return !oldSectionNodeIds.has(edge.source);
    }

    return true;
  });
}

export function pruneInvalidSectionConnections(edgesToFilter: SyncEdge[], graph: GraphCache) {
  return edgesToFilter.filter((edge) => isValidSectionConnection(edge, graph));
}

export function recalculateSectionMembershipInGraph(
  sectionId: string,
  nextNodes: SyncNode[],
  edgesToRecalculate: SyncEdge[],
  previousNodes: SyncNode[]
) {
  let graph = createGraphCache(nextNodes, edgesToRecalculate);
  const previousGraph = createGraphCache(previousNodes);
  const section = graph.nodeById.get(sectionId);

  if (!section || section.type !== "section") {
    return edgesToRecalculate;
  }

  let nextEdges = edgesToRecalculate;

  for (const node of nextNodes) {
    if (node.id === sectionId || isAncestorSection(node.id, sectionId, graph)) {
      continue;
    }

    const oldParent = previousGraph.nodeById.get(node.id)?.parentNode;
    const inside = isNodeInsideSectionEnough(node, section, graph);

    if (inside && (!node.parentNode || node.parentNode === sectionId)) {
      setNodeParentForSection(node, section, graph);
      graph = createGraphCache(nextNodes, nextEdges);
      continue;
    }

    if (!inside && oldParent === sectionId) {
      removeNodeFromSection(node, graph);
      nextEdges = pruneEdgesAfterSectionExit(nextEdges, node.id, sectionId, graph);
      graph = createGraphCache(nextNodes, nextEdges);
    }
  }

  orderNodesByHierarchy(nextNodes);

  return pruneInvalidSectionConnections(nextEdges, createGraphCache(nextNodes, nextEdges));
}

function getMovedNodeDimensions(node: SyncNode, dimensions?: { width: number; height: number }) {
  if (dimensions) {
    return dimensions;
  }

  return getNodeSize(node, node.type === "section" ? 720 : 240, node.type === "section" ? 620 : 190);
}

function resolveMovedNodeParent(
  movedNode: MovedNodeMembershipChange,
  nextNodes: SyncNode[],
  nextEdges: SyncEdge[],
  previousGraph?: GraphCache
) {
  let graph = createGraphCache(nextNodes, nextEdges);
  const sourceNode =
    movedNode.existingNode ??
    previousGraph?.nodeById.get(movedNode.nodeId) ??
    graph.nodeById.get(movedNode.nodeId);

  if (!sourceNode) {
    return false;
  }

  const oldSectionId = sourceNode.parentNode;
  const draggedNode = graph.nodeById.get(movedNode.nodeId);

  if (!draggedNode) {
    return false;
  }

  const absolutePosition = movedNode.absolutePosition ?? getAbsolutePosition(draggedNode, graph);
  const dimensions = getMovedNodeDimensions(draggedNode, movedNode.dimensions);
  const draggedBounds = {
    ...absolutePosition,
    width: dimensions.width,
    height: dimensions.height
  };
  const containingSection = findContainingSectionForBounds(movedNode.nodeId, draggedBounds, graph);
  const nextSectionId = containingSection?.id;

  if (containingSection) {
    const sectionPosition = getAbsolutePosition(containingSection, graph);
    draggedNode.parentNode = containingSection.id;
    draggedNode.expandParent = false;
    delete draggedNode.extent;
    draggedNode.position = {
      x: absolutePosition.x - sectionPosition.x,
      y: absolutePosition.y - sectionPosition.y
    };
  } else {
    delete draggedNode.parentNode;
    delete draggedNode.expandParent;
    delete draggedNode.extent;
    draggedNode.position = absolutePosition;
  }

  if (oldSectionId && nextSectionId !== oldSectionId) {
    graph = createGraphCache(nextNodes, nextEdges);
    const prunedEdges = pruneEdgesAfterSectionExit(nextEdges, draggedNode.id, oldSectionId, graph);
    nextEdges.splice(0, nextEdges.length, ...prunedEdges);
  }

  return true;
}

export function applySectionMembershipForMovedNodes(
  movedNodes: MovedNodeMembershipChange[],
  nextNodes: SyncNode[],
  nextEdges: SyncEdge[],
  previousNodes: SyncNode[] = []
) {
  if (movedNodes.length === 0) {
    return;
  }

  const previousGraph = previousNodes.length > 0 ? createGraphCache(previousNodes) : undefined;

  for (const movedNode of movedNodes) {
    resolveMovedNodeParent(movedNode, nextNodes, nextEdges, previousGraph);
  }

  for (const movedNode of movedNodes) {
    const graph = createGraphCache(nextNodes, nextEdges);
    const section = graph.nodeById.get(movedNode.nodeId);

    if (!section || section.type !== "section") {
      continue;
    }

    adoptContainedNodesIntoSection(section, graph);
  }

  const validEdges = pruneInvalidSectionConnections(
    nextEdges,
    createGraphCache(nextNodes, nextEdges)
  );
  nextEdges.splice(0, nextEdges.length, ...validEdges);
  orderNodesByHierarchy(nextNodes);
}

export function applySectionMembershipForMovedNode(
  nodeId: string,
  absolutePosition: { x: number; y: number },
  dimensions: { width: number; height: number },
  nextNodes: SyncNode[],
  nextEdges: SyncEdge[],
  existingNode?: SyncNode,
  _graph?: GraphCache
) {
  applySectionMembershipForMovedNodes(
    [
      {
        nodeId,
        absolutePosition,
        dimensions,
        existingNode
      }
    ],
    nextNodes,
    nextEdges
  );
}

export function isValidSectionConnection(
  connection: {
    source?: string | null;
    target?: string | null;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  },
  graph: GraphCache
) {
  const source = graph.nodeById.get(connection.source ?? "");
  const target = graph.nodeById.get(connection.target ?? "");

  if (!source || !target || source.id === target.id) {
    return false;
  }

  if (
    source.type !== "section" &&
    connection.sourceHandle !== "main" &&
    !connection.sourceHandle?.startsWith("port-")
  ) {
    return false;
  }

  if (target.type !== "section" && connection.targetHandle !== "main") {
    return false;
  }

  if (
    source.type === "section" &&
    connection.sourceHandle !== "section-left" &&
    connection.sourceHandle !== "section-right"
  ) {
    return false;
  }

  if (
    target.type === "section" &&
    connection.targetHandle !== "section-left" &&
    connection.targetHandle !== "section-right"
  ) {
    return false;
  }

  const sourceIsSection = source.type === "section";
  const targetIsSection = target.type === "section";

  if (sourceIsSection && targetIsSection) {
    if (source.parentNode === target.id || target.parentNode === source.id) {
      return true;
    }
  }

  if (sourceIsSection) {
    const targetIsDirectChild = isDirectChildOfSection(target.id, source.id, graph);
    const targetIsOutsideSource = !isNodeInsideSection(target.id, source.id, graph);

    if (targetIsDirectChild) {
      return connection.sourceHandle === "section-left";
    }

    return targetIsOutsideSource && !source.parentNode && connection.sourceHandle === "section-right";
  }

  if (targetIsSection) {
    const sourceIsDirectChild = isDirectChildOfSection(source.id, target.id, graph);
    const sourceIsOutsideTarget = !isNodeInsideSection(source.id, target.id, graph);

    if (sourceIsDirectChild) {
      return connection.targetHandle === "section-right";
    }

    return sourceIsOutsideTarget && !target.parentNode && connection.targetHandle === "section-left";
  }

  if (source.parentNode || target.parentNode) {
    return source.parentNode === target.parentNode;
  }

  return true;
}
