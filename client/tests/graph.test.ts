import assert from "node:assert/strict";
import {
  applySectionMembershipForMovedNode,
  applySectionMembershipForMovedNodes,
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

function assertParentBeforeChild(nodes: SyncNode[], parentId: string, childId: string) {
  const parentIndex = nodes.findIndex((node) => node.id === parentId);
  const childIndex = nodes.findIndex((node) => node.id === childId);

  assert.notEqual(parentIndex, -1);
  assert.notEqual(childIndex, -1);
  assert.equal(parentIndex < childIndex, true);
}

function cloneNodes(nodes: SyncNode[]) {
  return nodes.map((node) => JSON.parse(JSON.stringify(node)) as SyncNode);
}

const collectingSection: SyncNode = {
  ...section,
  id: "section-collector",
  position: { x: 900, y: 900 },
  width: 700,
  height: 600,
  style: toNodeSizeStyle(700, 600),
  data: { ...section.data, title: "Collector" }
};
const earlierItem = {
  ...item,
  id: "item-earlier",
  position: { x: 100, y: 100 },
  data: { ...item.data, title: "Earlier item" }
};
const sectionCollectsEarlierItemNodes = [earlierItem, collectingSection];
applySectionMembershipForMovedNode(
  collectingSection.id,
  { x: 0, y: 0 },
  { width: 700, height: 600 },
  sectionCollectsEarlierItemNodes,
  [],
  collectingSection
);
assert.equal(
  sectionCollectsEarlierItemNodes.find((node) => node.id === earlierItem.id)?.parentNode,
  collectingSection.id
);
assertParentBeforeChild(sectionCollectsEarlierItemNodes, collectingSection.id, earlierItem.id);

const smallerSection: SyncNode = {
  ...section,
  id: "section-smaller",
  position: { x: 100, y: 100 },
  width: 200,
  height: 160,
  style: toNodeSizeStyle(200, 160),
  data: { ...section.data, title: "Smaller section" }
};
const largerSection: SyncNode = {
  ...section,
  id: "section-larger",
  position: { x: 1000, y: 1000 },
  width: 700,
  height: 600,
  style: toNodeSizeStyle(700, 600),
  data: { ...section.data, title: "Larger section" }
};
const sectionCollectsEarlierSectionNodes = [smallerSection, largerSection];
applySectionMembershipForMovedNode(
  largerSection.id,
  { x: 50, y: 50 },
  { width: 700, height: 600 },
  sectionCollectsEarlierSectionNodes,
  [],
  largerSection
);
assert.equal(
  sectionCollectsEarlierSectionNodes.find((node) => node.id === smallerSection.id)?.parentNode,
  largerSection.id
);
assert.equal(
  sectionCollectsEarlierSectionNodes.find((node) => node.id === largerSection.id)?.parentNode,
  undefined
);
assertParentBeforeChild(sectionCollectsEarlierSectionNodes, largerSection.id, smallerSection.id);

const halfCoveredSection: SyncNode = {
  ...section,
  id: "section-half-covered",
  position: { x: 250, y: 0 },
  width: 100,
  height: 100,
  style: toNodeSizeStyle(100, 100),
  data: { ...section.data, title: "Half covered" }
};
const halfCoveringSection: SyncNode = {
  ...section,
  id: "section-half-covering",
  position: { x: 1000, y: 1000 },
  width: 300,
  height: 300,
  style: toNodeSizeStyle(300, 300),
  data: { ...section.data, title: "Half covering" }
};
const halfCoveredNodes = [halfCoveredSection, halfCoveringSection];
applySectionMembershipForMovedNode(
  halfCoveringSection.id,
  { x: 0, y: 0 },
  { width: 300, height: 300 },
  halfCoveredNodes,
  [],
  halfCoveringSection
);
assert.equal(
  halfCoveredNodes.find((node) => node.id === halfCoveredSection.id)?.parentNode,
  halfCoveringSection.id
);
assertParentBeforeChild(halfCoveredNodes, halfCoveringSection.id, halfCoveredSection.id);

const lessCoveredSection: SyncNode = {
  ...section,
  id: "section-less-covered",
  position: { x: 251, y: 0 },
  width: 100,
  height: 100,
  style: toNodeSizeStyle(100, 100),
  data: { ...section.data, title: "Less covered" }
};
const lessCoveringSection: SyncNode = {
  ...halfCoveringSection,
  id: "section-less-covering",
  data: { ...section.data, title: "Less covering" }
};
const lessCoveredNodes = [lessCoveredSection, lessCoveringSection];
applySectionMembershipForMovedNode(
  lessCoveringSection.id,
  { x: 0, y: 0 },
  { width: 300, height: 300 },
  lessCoveredNodes,
  [],
  lessCoveringSection
);
assert.equal(
  lessCoveredNodes.find((node) => node.id === lessCoveredSection.id)?.parentNode,
  undefined
);

const recalculateUnorderedSection = {
  ...section,
  id: "section-recalculate",
  data: { ...section.data, title: "Recalculate" }
};
const recalculateUnorderedItem = {
  ...item,
  id: "item-recalculate",
  position: { x: 60, y: 60 },
  data: { ...item.data, title: "Recalculate item" }
};
const recalculateUnorderedNodes = [recalculateUnorderedItem, recalculateUnorderedSection];
recalculateSectionMembershipInGraph(
  recalculateUnorderedSection.id,
  recalculateUnorderedNodes,
  [],
  [{ ...recalculateUnorderedItem }, { ...recalculateUnorderedSection }]
);
assert.equal(
  recalculateUnorderedNodes.find((node) => node.id === recalculateUnorderedItem.id)?.parentNode,
  recalculateUnorderedSection.id
);
assertParentBeforeChild(
  recalculateUnorderedNodes,
  recalculateUnorderedSection.id,
  recalculateUnorderedItem.id
);

const immediateAdoptSectionStart: SyncNode = {
  ...section,
  id: "section-immediate-adopt",
  position: { x: 1000, y: 1000 },
  width: 360,
  height: 320,
  style: toNodeSizeStyle(360, 320),
  data: { ...section.data, title: "Immediate adopt" }
};
const immediateAdoptItem: SyncNode = {
  ...item,
  id: "item-immediate-adopt",
  position: { x: 40, y: 40 },
  width: 120,
  height: 120,
  style: toNodeSizeStyle(120, 120),
  data: { ...item.data, title: "Immediate adopted item" }
};
const immediateAdoptPreviousNodes = cloneNodes([immediateAdoptItem, immediateAdoptSectionStart]);
const immediateAdoptNodes = cloneNodes([
  immediateAdoptItem,
  { ...immediateAdoptSectionStart, position: { x: 0, y: 0 } }
]);
applySectionMembershipForMovedNodes(
  [{ nodeId: immediateAdoptSectionStart.id }],
  immediateAdoptNodes,
  [],
  immediateAdoptPreviousNodes
);
assert.equal(
  immediateAdoptNodes.find((node) => node.id === immediateAdoptItem.id)?.parentNode,
  immediateAdoptSectionStart.id
);
assertParentBeforeChild(immediateAdoptNodes, immediateAdoptSectionStart.id, immediateAdoptItem.id);

const delayedTeleportSectionStart: SyncNode = {
  ...section,
  id: "section-delayed-teleport",
  position: { x: 1000, y: 1000 },
  width: 300,
  height: 300,
  style: toNodeSizeStyle(300, 300),
  data: { ...section.data, title: "Delayed teleport guard" }
};
const delayedTeleportFirstItem: SyncNode = {
  ...item,
  id: "item-not-covered-first",
  position: { x: 260, y: 20 },
  width: 100,
  height: 100,
  style: toNodeSizeStyle(100, 100),
  data: { ...item.data, title: "Not covered enough" }
};
const delayedTeleportSecondItem: SyncNode = {
  ...item,
  id: "item-covered-second",
  position: { x: 630, y: 20 },
  width: 100,
  height: 100,
  style: toNodeSizeStyle(100, 100),
  data: { ...item.data, title: "Covered second" }
};
const delayedTeleportFirstPreviousNodes = cloneNodes([
  delayedTeleportFirstItem,
  delayedTeleportSecondItem,
  delayedTeleportSectionStart
]);
const delayedTeleportFirstNodes = cloneNodes([
  delayedTeleportFirstItem,
  delayedTeleportSecondItem,
  { ...delayedTeleportSectionStart, position: { x: 0, y: 0 } }
]);
applySectionMembershipForMovedNodes(
  [{ nodeId: delayedTeleportSectionStart.id }],
  delayedTeleportFirstNodes,
  [],
  delayedTeleportFirstPreviousNodes
);
assert.equal(
  delayedTeleportFirstNodes.find((node) => node.id === delayedTeleportFirstItem.id)?.parentNode,
  undefined
);

const delayedTeleportSecondPreviousNodes = cloneNodes(delayedTeleportFirstNodes);
const delayedTeleportSecondNodes = delayedTeleportFirstNodes.map((node) =>
  node.id === delayedTeleportSectionStart.id
    ? { ...node, position: { x: 600, y: 0 } }
    : JSON.parse(JSON.stringify(node))
) as SyncNode[];
applySectionMembershipForMovedNodes(
  [{ nodeId: delayedTeleportSectionStart.id }],
  delayedTeleportSecondNodes,
  [],
  delayedTeleportSecondPreviousNodes
);
assert.equal(
  delayedTeleportSecondNodes.find((node) => node.id === delayedTeleportSecondItem.id)?.parentNode,
  delayedTeleportSectionStart.id
);
assert.equal(
  delayedTeleportSecondNodes.find((node) => node.id === delayedTeleportFirstItem.id)?.parentNode,
  undefined
);

const immediateSmallSection: SyncNode = {
  ...section,
  id: "section-immediate-small",
  position: { x: 100, y: 100 },
  width: 180,
  height: 160,
  style: toNodeSizeStyle(180, 160),
  data: { ...section.data, title: "Immediate small" }
};
const immediateSmallSectionChild: SyncNode = {
  ...item,
  id: "item-inside-immediate-small",
  parentNode: immediateSmallSection.id,
  position: { x: 20, y: 20 },
  width: 80,
  height: 80,
  style: toNodeSizeStyle(80, 80),
  data: { ...item.data, title: "Nested child stays nested" }
};
const immediateLargeSectionStart: SyncNode = {
  ...section,
  id: "section-immediate-large",
  position: { x: 1000, y: 1000 },
  width: 500,
  height: 420,
  style: toNodeSizeStyle(500, 420),
  data: { ...section.data, title: "Immediate large" }
};
const immediateSectionPreviousNodes = cloneNodes([
  immediateSmallSection,
  immediateSmallSectionChild,
  immediateLargeSectionStart
]);
const immediateSectionNodes = cloneNodes([
  immediateSmallSection,
  immediateSmallSectionChild,
  { ...immediateLargeSectionStart, position: { x: 40, y: 40 } }
]);
applySectionMembershipForMovedNodes(
  [{ nodeId: immediateLargeSectionStart.id }],
  immediateSectionNodes,
  [],
  immediateSectionPreviousNodes
);
assert.equal(
  immediateSectionNodes.find((node) => node.id === immediateSmallSection.id)?.parentNode,
  immediateLargeSectionStart.id
);
assert.equal(
  immediateSectionNodes.find((node) => node.id === immediateSmallSectionChild.id)?.parentNode,
  immediateSmallSection.id
);
assertParentBeforeChild(immediateSectionNodes, immediateLargeSectionStart.id, immediateSmallSection.id);
assertParentBeforeChild(immediateSectionNodes, immediateSmallSection.id, immediateSmallSectionChild.id);

const multiMoveSectionStart: SyncNode = {
  ...section,
  id: "section-multi-move",
  position: { x: 1000, y: 1000 },
  width: 420,
  height: 360,
  style: toNodeSizeStyle(420, 360),
  data: { ...section.data, title: "Multi move" }
};
const multiMoveItem: SyncNode = {
  ...item,
  id: "item-multi-move",
  position: { x: 80, y: 80 },
  width: 120,
  height: 120,
  style: toNodeSizeStyle(120, 120),
  data: { ...item.data, title: "Multi move item" }
};
const multiMovePreviousNodes = cloneNodes([multiMoveItem, multiMoveSectionStart]);
const multiMoveNodes = cloneNodes([
  { ...multiMoveItem, position: { x: 100, y: 100 } },
  { ...multiMoveSectionStart, position: { x: 0, y: 0 } }
]);
applySectionMembershipForMovedNodes(
  [{ nodeId: multiMoveSectionStart.id }, { nodeId: multiMoveItem.id }],
  multiMoveNodes,
  [],
  multiMovePreviousNodes
);
assert.equal(
  multiMoveNodes.find((node) => node.id === multiMoveItem.id)?.parentNode,
  multiMoveSectionStart.id
);
assertParentBeforeChild(multiMoveNodes, multiMoveSectionStart.id, multiMoveItem.id);

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
