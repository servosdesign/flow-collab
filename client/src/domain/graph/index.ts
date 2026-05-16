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

export function estimateBodyHeight(body: string, charactersPerLine = 34) {
  if (!body) {
    return 72;
  }

  const rows = body
    .split("\n")
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);

  return Math.max(72, rows * 17 + 18);
}

export function getMinimumNodeHeight(node: SyncNode) {
  if (node.type === "section") {
    return getNodeSize(node, 520, 360).height;
  }

  const body = node.data.body ?? node.data.text ?? "";
  const ports = node.data.ports?.length ?? 1;
  const portHeight = Math.max(0, ports - 6) * 22;
  const imageHeight = node.data.imageUrl ? 144 : 0;
  const widgetHeight = 72;

  return 176 + estimateBodyHeight(body) + imageHeight + widgetHeight + portHeight;
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
  const nodeArea = Math.max(1, nodeBounds.width * nodeBounds.height);

  return (overlapWidth * overlapHeight) / nodeArea;
}

function getBoundsArea(bounds: { width: number; height: number }) {
  return Math.max(1, bounds.width * bounds.height);
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
  return getOverlapRatio(getRenderedNodeBounds(node, graph), getNodeBounds(section, graph)) >= 0.5;
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
    return;
  }

  for (const node of graph.nodes) {
    if (
      node.id === section.id ||
      node.parentNode === section.id ||
      isAncestorSection(node.id, section.id, graph)
    ) {
      continue;
    }

    if (isNodeInsideSectionEnough(node, section, graph)) {
      setNodeParentForSection(node, section, graph);
    }
  }
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

export function recalculateSectionMembershipInGraph(
  sectionId: string,
  nextNodes: SyncNode[],
  edgesToRecalculate: SyncEdge[],
  previousNodes: SyncNode[]
) {
  const graph = createGraphCache(nextNodes, edgesToRecalculate);
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
      continue;
    }

    if (!inside && oldParent === sectionId) {
      removeNodeFromSection(node, graph);
      nextEdges = pruneEdgesAfterSectionExit(nextEdges, node.id, sectionId, graph);
    }
  }

  return nextEdges;
}

export function applySectionMembershipForMovedNode(
  nodeId: string,
  absolutePosition: { x: number; y: number },
  dimensions: { width: number; height: number },
  nextNodes: SyncNode[],
  nextEdges: SyncEdge[],
  existingNode?: SyncNode,
  graph = createGraphCache(nextNodes, nextEdges)
) {
  const sourceNode = existingNode ?? graph.nodeById.get(nodeId);

  if (!sourceNode) {
    return;
  }

  const oldSectionId = sourceNode.parentNode;
  const draggedNode = graph.nodeById.get(nodeId);

  if (!draggedNode) {
    return;
  }

  const containingSection = findContainingSectionForBounds(
    nodeId,
    {
      ...absolutePosition,
      width: dimensions.width,
      height: dimensions.height
    },
    graph
  );
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

  adoptContainedNodesIntoSection(draggedNode, graph);

  if (oldSectionId && nextSectionId !== oldSectionId) {
    const prunedEdges = pruneEdgesAfterSectionExit(nextEdges, draggedNode.id, oldSectionId, graph);
    nextEdges.splice(0, nextEdges.length, ...prunedEdges);
  }
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
      return true;
    }

    return targetIsOutsideSource && !source.parentNode && connection.sourceHandle === "section-right";
  }

  if (targetIsSection) {
    const sourceIsDirectChild = isDirectChildOfSection(source.id, target.id, graph);
    const sourceIsOutsideTarget = !isNodeInsideSection(source.id, target.id, graph);

    if (sourceIsDirectChild) {
      return true;
    }

    return sourceIsOutsideTarget && !target.parentNode && connection.targetHandle === "section-left";
  }

  if (source.parentNode || target.parentNode) {
    return source.parentNode === target.parentNode;
  }

  return true;
}
