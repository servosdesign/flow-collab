export type XYPosition = {
  x: number;
  y: number;
};

export type FlowViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type FlowNodeKind = "section" | "item";

export type SyncPort = {
  id: string;
  color: string;
};

export type SyncNodeData = {
  nodeType: FlowNodeKind;
  title?: string;
  body?: string;
  text?: string;
  imageUrl?: string;
  ports?: SyncPort[];
};

export type SyncNode = {
  id: string;
  type: FlowNodeKind;
  position: XYPosition;
  data: SyncNodeData;
  parentNode?: string;
  extent?: "parent";
  expandParent?: boolean;
  dragHandle?: string;
  selectable?: boolean;
  width?: number | string;
  height?: number | string;
  style?: Record<string, string | number>;
};

export type SyncEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  animated?: boolean;
  markerEnd?: unknown;
};

export type SyncFlowDocument = {
  name: string;
  nodes: SyncNode[];
  edges: SyncEdge[];
  viewport: FlowViewport;
};

export type SyncPresenceCursor = XYPosition;

export type SyncPresenceUser = {
  id: string;
  name: string;
  color: string;
  cursor?: SyncPresenceCursor;
  selectedNodeIds?: string[];
  updatedAt: number;
};

export type SyncPresenceDocument = {
  users: Record<string, SyncPresenceUser>;
};

export type FlowPayload = SyncFlowDocument;

export type FlowRecord = SyncFlowDocument & {
  slug: string;
  createdAt: string;
  updatedAt: string;
};

export function createSeedFlow(imageUrls: string[] = []): SyncFlowDocument {
  const sections = 10;
  const totalItems = 490;
  const itemsPerSection = totalItems / sections;
  const sectionWidth = 1660;
  const sectionHeight = 4100;
  const sectionGapX = 180;
  const sectionGapY = 160;
  const itemWidth = 260;
  const itemHeight = 330;
  const blankItems = 100;
  const edgeTargetCount = 430;
  const nodes: SyncNode[] = [];
  const edges: SyncEdge[] = [];
  const itemIds: string[] = [];
  const notes = [
    "Coordinate edits, image reviews, and edge updates here.\n\nUse this node to capture the decision, the owner, and the next visible step. The body is intentionally a little longer so syncing, rendering, and selection all get exercised together.\n\nWhen this node changes, everyone should see the updated note without losing their place in the flow.",
    "Live note field for planning and review details.\n\nThis paragraph gives collaborators enough body text to edit at the same time. It should make remote cursor updates and text syncing easier to notice while the graph is busy.\n\nKeep any unresolved questions here so the node carries useful context as it moves between sections.",
    "Shared draft content that updates for every connected user.\n\nAdd acceptance notes, unresolved questions, and image-specific comments here. These longer notes help the node feel like a real working object instead of just a label.\n\nThe extra text also makes tall-node selection and minimap rendering easier to verify.",
    "Node context, image slot, and ports are all collaborative.\n\nThe section around this node may change as the section is resized or as the node is moved. Edges, ports, title text, body text, and images should all keep their live state.\n\nUse the port layout to test inside-section and outside-section connection paths.",
    "Workspace detail node for flowchart testing at scale.\n\nThis body text is meant to be edited, duplicated, and connected. It gives the minimap and the main canvas more visual texture while still keeping the layout scannable.\n\nA final paragraph gives the textarea more depth for multi-user editing and resize testing."
  ];

  for (let sectionIndex = 0; sectionIndex < sections; sectionIndex += 1) {
    const sectionId = `section-${sectionIndex + 1}`;
    const sectionColumn = sectionIndex % 2;
    const sectionRow = Math.floor(sectionIndex / 2);

    nodes.push({
      id: sectionId,
      type: "section",
      position: {
        x: sectionColumn * (sectionWidth + sectionGapX),
        y: sectionRow * (sectionHeight + sectionGapY)
      },
      selectable: true,
      style: {
        width: sectionWidth,
        height: sectionHeight
      },
      data: {
        nodeType: "section",
        title: `Section ${sectionIndex + 1}`,
        body: `Large collaborative section ${sectionIndex + 1}`,
        ports: [{ id: "main", color: "#0f766e" }]
      }
    });

    for (let itemIndex = 0; itemIndex < itemsPerSection; itemIndex += 1) {
      const itemId = `${sectionId}-node-${itemIndex + 1}`;
      const itemColumn = itemIndex % 5;
      const itemRow = Math.floor(itemIndex / 5);
      const globalItemIndex = sectionIndex * itemsPerSection + itemIndex;
      const imageUrl = imageUrls.length > 0 ? imageUrls[globalItemIndex % imageUrls.length] : undefined;
      const hasBlankBody = globalItemIndex < blankItems;
      const portCount = globalItemIndex % 13 === 0 ? 6 : globalItemIndex % 7 === 0 ? 4 : 1;

      nodes.push({
        id: itemId,
        type: "item",
        parentNode: sectionId,
        expandParent: false,
        selectable: true,
        position: {
          x: 42 + itemColumn * 315,
          y: 96 + itemRow * 340
        },
        style: {
          width: itemWidth + Math.max(0, portCount - 3) * 20,
          height: imageUrl ? itemHeight + 110 : itemHeight
        },
        data: {
          nodeType: "item",
          title: `Node ${sectionIndex + 1}.${itemIndex + 1}`,
          body: hasBlankBody ? "" : notes[globalItemIndex % notes.length],
          imageUrl,
          ports: Array.from({ length: portCount }, (_, portIndex) => ({
            id: portIndex === 0 ? "main" : `port-${portIndex + 1}`,
            color: [
              "#0f766e",
              "#2563eb",
              "#dc2626",
              "#9333ea",
              "#d97706",
              "#0891b2"
            ][portIndex % 6]
          }))
        }
      });

      itemIds.push(itemId);
    }

    if (sectionIndex > 0) {
      edges.push({
        id: `section-link-${sectionIndex}`,
        source: `section-${sectionIndex}`,
        target: sectionId,
        type: "step",
        animated: true,
        markerEnd: "arrowclosed"
      });
    }
  }

  itemIds.slice(1, edgeTargetCount + 1).forEach((targetId, index) => {
    const sourceId = itemIds[Math.max(0, index - (index % 11 === 0 ? 6 : 0))];

    edges.push({
      id: `item-edge-${index + 1}`,
      source: sourceId,
      target: targetId,
      sourceHandle: "main",
      targetHandle: "main",
      type: "step",
      markerEnd: "arrowclosed"
    });
  });

  return {
    name: "Shared Flow",
    nodes,
    edges,
    viewport: {
      x: 80,
      y: 60,
      zoom: 0.45
    }
  };
}

export function createEmptyPresence(): SyncPresenceDocument {
  return {
    users: {}
  };
}
