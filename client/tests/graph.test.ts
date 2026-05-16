import assert from "node:assert/strict";
import {
  applySectionMembershipForMovedNode,
  createGraphCache,
  getEdgeRenderType,
  getNodeSize,
  isValidSectionConnection,
  normalizeNode,
  recalculateSectionMembershipInGraph,
  toNodeSizeStyle
} from "../src/graph";
import type { SyncEdge, SyncNode } from "@vue-flow-sync/shared";

const section: SyncNode = {
  id: "section-1",
  type: "section",
  position: { x: 0, y: 0 },
  width: 500,
  height: 400,
  style: toNodeSizeStyle(500, 400),
  data: { nodeType: "section", title: "Section", body: "", ports: [{ id: "main", color: "#0f766e" }] }
};

const item: SyncNode = {
  id: "item-1",
  type: "item",
  position: { x: 40, y: 50 },
  width: 320,
  height: 260,
  style: toNodeSizeStyle(320, 260),
  data: { nodeType: "item", title: "Item", body: "", ports: [{ id: "main", color: "#0f766e" }] }
};

assert.deepEqual(toNodeSizeStyle(320.4, 260.5), {
  width: "320px",
  height: "261px"
});

assert.deepEqual(getNodeSize({ style: { width: "320px", height: "260px" } }, 1, 1), {
  width: 320,
  height: 260
});

const normalized = normalizeNode({
  ...item,
  position: { x: 40.4, y: 50.5 },
  dimensions: { width: 333, height: 277 }
} as Parameters<typeof normalizeNode>[0]);

assert.equal(normalized.position.x, 40);
assert.equal(normalized.position.y, 51);
assert.equal(normalized.style?.width, "320px");

const graph = createGraphCache([section, { ...item, parentNode: section.id }], []);
assert.equal(graph.nodeById.get(item.id)?.id, item.id);
assert.equal(graph.childrenByParentId.get(section.id)?.[0]?.id, item.id);

const throughEdge: SyncEdge = {
  id: "edge-1",
  source: section.id,
  target: item.id,
  sourceHandle: "section-left",
  targetHandle: "main"
};

assert.equal(getEdgeRenderType(throughEdge, graph), "section-through");

const outsideItem: SyncNode = {
  ...item,
  id: "item-outside",
  position: { x: 700, y: 50 }
};
const nestedSection: SyncNode = {
  ...section,
  id: "section-nested",
  parentNode: section.id,
  position: { x: 80, y: 90 }
};
const nestedItem: SyncNode = {
  ...item,
  id: "item-nested",
  parentNode: nestedSection.id,
  position: { x: 30, y: 30 }
};
const boundaryGraph = createGraphCache(
  [section, { ...item, parentNode: section.id }, outsideItem, nestedSection, nestedItem],
  []
);

assert.equal(
  isValidSectionConnection(
    {
      source: item.id,
      target: section.id,
      sourceHandle: "main",
      targetHandle: "section-right"
    },
    boundaryGraph
  ),
  true
);
assert.equal(
  isValidSectionConnection(
    {
      source: item.id,
      target: outsideItem.id,
      sourceHandle: "main",
      targetHandle: "main"
    },
    boundaryGraph
  ),
  false
);
assert.equal(
  isValidSectionConnection(
    {
      source: nestedSection.id,
      target: section.id,
      sourceHandle: "section-right",
      targetHandle: "section-right"
    },
    boundaryGraph
  ),
  true
);
assert.equal(
  isValidSectionConnection(
    {
      source: nestedSection.id,
      target: outsideItem.id,
      sourceHandle: "section-right",
      targetHandle: "main"
    },
    boundaryGraph
  ),
  false
);
assert.equal(
  isValidSectionConnection(
    {
      source: section.id,
      target: outsideItem.id,
      sourceHandle: "section-right",
      targetHandle: "main"
    },
    boundaryGraph
  ),
  true
);
assert.equal(
  isValidSectionConnection(
    {
      source: section.id,
      target: item.id,
      sourceHandle: "section-right",
      targetHandle: "main"
    },
    boundaryGraph
  ),
  false
);
assert.equal(
  isValidSectionConnection(
    {
      source: section.id,
      target: item.id,
      sourceHandle: "section-left",
      targetHandle: "main"
    },
    boundaryGraph
  ),
  true
);

const movedNodes = [{ ...section }, { ...item, position: { x: 60, y: 60 } }];
const movedEdges: SyncEdge[] = [];
applySectionMembershipForMovedNode(
  item.id,
  { x: 60, y: 60 },
  { width: 320, height: 260 },
  movedNodes,
  movedEdges,
  item
);
assert.equal(movedNodes.find((node) => node.id === item.id)?.parentNode, section.id);

const movedOutsideInsideNodes = [{ ...section }, { ...outsideItem }];
const movedOutsideInsideEdges: SyncEdge[] = [
  {
    id: "edge-section-output",
    source: section.id,
    target: outsideItem.id,
    sourceHandle: "section-right",
    targetHandle: "main"
  }
];
applySectionMembershipForMovedNode(
  outsideItem.id,
  { x: 80, y: 80 },
  { width: 320, height: 260 },
  movedOutsideInsideNodes,
  movedOutsideInsideEdges,
  outsideItem
);
assert.equal(
  movedOutsideInsideNodes.find((node) => node.id === outsideItem.id)?.parentNode,
  section.id
);
assert.deepEqual(movedOutsideInsideEdges, []);

const shrunkSection = {
  ...section,
  width: 80,
  height: 80,
  style: toNodeSizeStyle(80, 80)
};
const child = { ...item, parentNode: section.id, position: { x: 300, y: 300 } };
const recalculatedNodes = [shrunkSection, child];
const recalculatedEdges = recalculateSectionMembershipInGraph(
  shrunkSection.id,
  recalculatedNodes,
  [],
  [section, { ...item, parentNode: section.id }]
);

assert.equal(recalculatedNodes.find((node) => node.id === item.id)?.parentNode, undefined);
assert.deepEqual(recalculatedEdges, []);

console.log("graph helper tests passed");
