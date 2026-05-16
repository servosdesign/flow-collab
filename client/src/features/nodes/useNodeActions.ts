import type { NodeDragEvent } from "@vue-flow/core";
import { nextTick } from "vue";
import type { FlowNodeKind, SyncEdge, SyncNode } from "@vue-flow-sync/shared";
import type { JsonOp } from "sharedb/lib/client";
import { uploadNodeImage } from "../../api";
import {
  applySectionMembershipForMovedNode,
  createGraphCache,
  defaultPorts,
  findContainingSectionForBounds,
  getAbsolutePosition,
  getMinimumNodeHeight,
  getNodeSize,
  normalizeNode,
  recalculateSectionMembershipInGraph,
  sameJson,
  stripParentExtent,
  toNodeSizeStyle,
  withContentSizedNode,
  withDefaultEdges,
  type FlowNode
} from "../../domain/graph";
import type { FlowEditorServices } from "../../app/flowEditorServices";
import type { FlowRuntime } from "../../flowRuntime";
import { useNodeClipboard } from "./useNodeClipboard";

const portColors = [
  "#0f766e",
  "#2563eb",
  "#dc2626",
  "#9333ea",
  "#d97706",
  "#0891b2",
  "#65a30d",
  "#be123c"
];

function randomPortColor() {
  return portColors[Math.floor(Math.random() * portColors.length)];
}

export function useNodeActions(runtime: FlowRuntime, services: FlowEditorServices) {
  const clipboard = useNodeClipboard(runtime, services);

  function submitOperation(operation: JsonOp[]) {
    services.submitOperation(operation);
  }

  function submitGraphReplacement(nextNodes: SyncNode[], nextEdges: SyncEdge[]) {
    services.submitGraphReplacement(nextNodes, nextEdges);
  }

  function getCurrentSyncNodes() {
    return services.getCurrentSyncNodes();
  }

  function getCurrentSyncEdges(nextNodes?: SyncNode[]) {
    return services.getCurrentSyncEdges(nextNodes);
  }

  function withSelectionState(nodes: FlowNode[]) {
    return services.withSelectionState(nodes);
  }

  function closeContextMenu() {
    services.closeContextMenu();
  }

  function scheduleSelectionBoundsRefresh() {
    services.scheduleSelectionBoundsRefresh();
  }

  function updatePresenceSelection() {
    services.updatePresenceSelection();
  }

  function submitGraphSnapshot() {
    services.submitGraphSnapshot();
  }

  function refreshNodeInternalsSoon(nodeIds: string[]) {
    nextTick(() => {
      runtime.updateNodeInternals?.(nodeIds);
      window.requestAnimationFrame(() => {
        runtime.updateNodeInternals?.(nodeIds);
      });
    });
  }

  function setCreateMode(kind: FlowNodeKind) {
    if (!runtime.isLoggedIn.value) {
      return;
    }

    runtime.pendingCreate.value = runtime.pendingCreate.value === kind ? null : kind;
  }

  function createNodeAt(kind: FlowNodeKind, clientX: number, clientY: number) {
    const document = runtime.flowDocument.value;

    if (!runtime.isLoggedIn.value || !document) {
      return;
    }

    const flowPosition = runtime.screenToFlowCoordinate({ x: clientX, y: clientY });
    const nextNodes = (runtime.nodes.value as FlowNode[]).map(normalizeNode);
    const graph = createGraphCache(nextNodes);
    const id = `${kind}-${Date.now()}`;
    const containingSection = findContainingSectionForBounds(
      id,
      {
        x: flowPosition.x,
        y: flowPosition.y,
        width: 1,
        height: 1
      },
      graph
    );
    let newNode: SyncNode = {
      id,
      type: kind,
      position: {
        x: Math.round(flowPosition.x),
        y: Math.round(flowPosition.y)
      },
      selectable: true,
      data: {
        nodeType: kind,
        title: kind === "section" ? "New section" : "New node",
        body: "",
        ports: defaultPorts()
      },
      style: kind === "section" ? toNodeSizeStyle(520, 360) : toNodeSizeStyle(320, 320)
    };

    newNode = withContentSizedNode(newNode);

    if (containingSection) {
      const sectionPosition = getAbsolutePosition(containingSection, graph);
      newNode.parentNode = containingSection.id;
      newNode.expandParent = false;
      newNode.position = {
        x: Math.round(flowPosition.x - sectionPosition.x),
        y: Math.round(flowPosition.y - sectionPosition.y)
      };
    }

    runtime.pendingCreate.value = null;
    submitGraphReplacement([...document.data.nodes, newNode], document.data.edges);
    refreshNodeInternalsSoon([...nextNodes.map((node) => node.id), newNode.id]);
  }

  function handlePaneClick(event: MouseEvent) {
    closeContextMenu();

    if (runtime.pendingCreate.value) {
      createNodeAt(runtime.pendingCreate.value, event.clientX, event.clientY);
    }
  }

  function handleCreateDragStart(kind: FlowNodeKind, event: DragEvent) {
    if (!runtime.isLoggedIn.value) {
      return;
    }

    runtime.pendingCreate.value = kind;
    event.dataTransfer?.setData("application/vue-flow-sync-node", kind);
    event.dataTransfer?.setData("text/plain", kind);
  }

  function handleCreateDrop(event: DragEvent) {
    event.preventDefault();
    const kind =
      (event.dataTransfer?.getData("application/vue-flow-sync-node") as FlowNodeKind) ||
      runtime.pendingCreate.value;

    if (kind === "section" || kind === "item") {
      createNodeAt(kind, event.clientX, event.clientY);
    }
  }

  function updateLocalNode(nodeId: string, updater: (node: FlowNode) => void) {
    const nextNodes: FlowNode[] = [];

    runtime.nodes.value.forEach((node) => {
      const nextNode = { ...node, data: { ...node.data } } as FlowNode;

      if (nextNode.id === nodeId) {
        updater(nextNode);
      }

      nextNodes.push(nextNode);
    });

    runtime.nodes.value = nextNodes;
    nextTick(() => {
      scheduleSelectionBoundsRefresh();
      updatePresenceSelection();
    });
  }

  function addNodePort(nodeId: string) {
    const document = runtime.flowDocument.value;

    if (!document) {
      return;
    }

    const nodeIndex = document.data.nodes.findIndex((node) => node.id === nodeId);

    if (nodeIndex < 0 || document.data.nodes[nodeIndex].type === "section") {
      return;
    }

    const currentPorts = document.data.nodes[nodeIndex].data.ports?.length
      ? document.data.nodes[nodeIndex].data.ports
      : defaultPorts();
    const nextPort = {
      id: `port-${Date.now()}`,
      color: randomPortColor()
    };
    const nextPorts = [...currentPorts, nextPort];
    const currentStyle = document.data.nodes[nodeIndex].style ?? {};
    const currentSize = getNodeSize(document.data.nodes[nodeIndex], 240, 190);
    const extraPorts = Math.max(0, nextPorts.length - 4);
    const nextDocumentNode = {
      ...document.data.nodes[nodeIndex],
      data: {
        ...document.data.nodes[nodeIndex].data,
        ports: nextPorts
      }
    };
    const nextWidth = Math.max(currentSize.width, 260 + Math.max(0, nextPorts.length - 8) * 14);
    const nextHeight = Math.max(
      currentSize.height,
      getMinimumNodeHeight(nextDocumentNode) + extraPorts * 22
    );
    const nextStyle = {
      ...currentStyle,
      ...toNodeSizeStyle(nextWidth, nextHeight)
    };

    updateLocalNode(nodeId, (node) => {
      node.data = {
        nodeType: node.data?.nodeType ?? (node.type === "section" ? "section" : "item"),
        title: node.data?.title ?? node.data?.text ?? node.id,
        body: node.data?.body ?? "",
        ...node.data,
        ports: nextPorts
      };
      node.style = nextStyle;
      node.width = Math.round(nextWidth);
      node.height = Math.round(nextHeight);
    });

    submitOperation([
      {
        p: ["nodes", nodeIndex, "data", "ports"],
        od: document.data.nodes[nodeIndex].data.ports,
        oi: nextPorts
      },
      {
        p: ["nodes", nodeIndex, "style"],
        od: document.data.nodes[nodeIndex].style,
        oi: nextStyle
      },
      {
        p: ["nodes", nodeIndex, "width"],
        od: document.data.nodes[nodeIndex].width,
        oi: Math.round(nextWidth)
      },
      {
        p: ["nodes", nodeIndex, "height"],
        od: document.data.nodes[nodeIndex].height,
        oi: Math.round(nextHeight)
      }
    ]);
  }

  function recalculateSectionMembership(sectionId: string) {
    const document = runtime.flowDocument.value;

    if (!document || runtime.isApplyingRemote.value) {
      return;
    }

    const nextNodes = getCurrentSyncNodes();
    let nextEdges = getCurrentSyncEdges(nextNodes);
    nextEdges = recalculateSectionMembershipInGraph(
      sectionId,
      nextNodes,
      nextEdges,
      document.data.nodes
    );

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

  function sanitizeSectionMembership() {
    const document = runtime.flowDocument.value;

    if (!document || runtime.isApplyingRemote.value) {
      return;
    }

    const nextNodes = getCurrentSyncNodes();
    let nextEdges = getCurrentSyncEdges(nextNodes);

    nextNodes
      .filter((node) => node.type === "section")
      .forEach((section) => {
        nextEdges = recalculateSectionMembershipInGraph(
          section.id,
          nextNodes,
          nextEdges,
          document.data.nodes
        );
      });

    if (!sameJson(document.data.nodes, nextNodes) || !sameJson(document.data.edges, nextEdges)) {
      submitGraphReplacement(nextNodes, nextEdges);
    }
  }

  function applySectionMembershipForDraggedNode(
    draggedGraphNode: NodeDragEvent["node"],
    nextNodes: SyncNode[],
    nextEdges: SyncEdge[]
  ) {
    const existingNode = runtime.flowDocument.value?.data.nodes.find(
      (node) => node.id === draggedGraphNode.id
    );

    applySectionMembershipForMovedNode(
      draggedGraphNode.id,
      {
        x: Math.round(draggedGraphNode.computedPosition.x),
        y: Math.round(draggedGraphNode.computedPosition.y)
      },
      {
        width: draggedGraphNode.dimensions.width || 240,
        height: draggedGraphNode.dimensions.height || 190
      },
      nextNodes,
      nextEdges,
      existingNode
    );
  }

  function handleNodeDragStop(payload: NodeDragEvent) {
    const document = runtime.flowDocument.value;

    if (!runtime.isLoggedIn.value) {
      return;
    }

    if (!document || runtime.isApplyingRemote.value) {
      submitGraphSnapshot();
      return;
    }

    const nextNodes = getCurrentSyncNodes();
    const nextEdges = getCurrentSyncEdges(nextNodes);

    applySectionMembershipForDraggedNode(payload.node, nextNodes, nextEdges);

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

  function handleNodeDrag() {
    scheduleSelectionBoundsRefresh();
  }

  function handleSelectionDragStop(payload: NodeDragEvent) {
    const document = runtime.flowDocument.value;

    if (!runtime.isLoggedIn.value) {
      return;
    }

    if (!document || runtime.isApplyingRemote.value) {
      submitGraphSnapshot();
      return;
    }

    const nextNodes = getCurrentSyncNodes();
    const nextEdges = getCurrentSyncEdges(nextNodes);

    payload.nodes.forEach((node) => {
      applySectionMembershipForDraggedNode(node, nextNodes, nextEdges);
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

  function handleSelectionDrag() {
    scheduleSelectionBoundsRefresh();
  }

  function submitNodeData(nodeId: string, key: "title" | "body" | "imageUrl", value: string) {
    const document = runtime.flowDocument.value;
    const index = document?.data.nodes.findIndex((node) => node.id === nodeId) ?? -1;

    if (!runtime.isLoggedIn.value || !document || index < 0) {
      return;
    }

    const oldValue = document.data.nodes[index].data[key];

    if (oldValue === value) {
      return;
    }

    const nextDocumentNode: SyncNode = {
      ...document.data.nodes[index],
      data: {
        ...document.data.nodes[index].data,
        [key]: value
      }
    };
    const nextSizedNode = withContentSizedNode(nextDocumentNode);
    const operation: JsonOp[] = [
      {
        p: ["nodes", index, "data", key],
        od: oldValue,
        oi: value
      }
    ];

    if (!sameJson(document.data.nodes[index].style, nextSizedNode.style)) {
      operation.push({
        p: ["nodes", index, "style"],
        od: document.data.nodes[index].style,
        oi: nextSizedNode.style
      });
    }

    updateLocalNode(nodeId, (node) => {
      const currentData = node.data ?? {
        nodeType: node.type === "section" ? "section" : "item",
        title: node.id,
        body: ""
      };

      node.data =
        key === "title"
          ? {
              ...currentData,
              title: value
            }
          : key === "body"
            ? {
                ...currentData,
                body: value
              }
            : {
                ...currentData,
                imageUrl: value
              };

      if (nextSizedNode.style) {
        node.style = nextSizedNode.style;
      }
    });

    submitOperation(operation);
  }

  async function uploadImage(nodeId: string, file: File) {
    if (!runtime.isLoggedIn.value) {
      return;
    }

    try {
      runtime.status.value = "Uploading";
      const uploaded = await uploadNodeImage(file);
      submitNodeData(nodeId, "imageUrl", uploaded.url);
    } catch (error) {
      runtime.errorMessage.value =
        error instanceof Error ? error.message : "Could not upload image.";
      runtime.status.value = "Error";
    }
  }

  return {
    addNodePort,
    deleteNodesById: clipboard.deleteNodesById,
    duplicateNodesById: clipboard.duplicateNodesById,
    handleCreateDragStart,
    handleCreateDrop,
    handleNodeDrag,
    handleNodeDragStop,
    handlePaneClick,
    handleSelectionDrag,
    handleSelectionDragStop,
    recalculateSectionMembership,
    sanitizeSectionMembership,
    setCreateMode,
    submitNodeData,
    updateLocalNode,
    uploadImage
  };
}
