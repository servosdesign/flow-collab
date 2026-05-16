import { nextTick } from "vue";
import type { SyncEdge, SyncFlowDocument, SyncNode } from "@vue-flow-sync/shared";
import type { JsonOp } from "sharedb/lib/client";
import {
  cloneJson,
  createGraphCache,
  normalizeEdge,
  normalizeNode,
  sameJson,
  stripParentExtent,
  withContentSizedNode,
  withDefaultEdges,
  type FlowEdge,
  type FlowNode
} from "../../domain/graph";
import type { FlowEditorServices } from "../../app/flowEditorServices";
import type { FlowRuntime } from "../../flowRuntime";

export function useRealtimeSync(runtime: FlowRuntime, services: FlowEditorServices) {
  const granularNodeFields = new Set(["data", "style", "width", "height"]);

  function finishRemoteApply() {
    nextTick(() => {
      runtime.isApplyingRemote.value = false;
      runtime.isFlowLoading.value = false;
    });
  }

  function applyFlowDocument(document: SyncFlowDocument, fit = false) {
    runtime.isApplyingRemote.value = true;

    const nextFlow = cloneJson(document);
    const nextNodes = nextFlow.nodes.map(withContentSizedNode).map(stripParentExtent);

    runtime.nodes.value = services.withSelectionState(nextNodes as FlowNode[]);
    runtime.edges.value = withDefaultEdges(
      nextFlow.edges,
      createGraphCache(nextNodes, nextFlow.edges)
    );
    runtime.currentViewport.value = nextFlow.viewport;
    runtime.setViewport(nextFlow.viewport);

    if (fit) {
      window.requestAnimationFrame(() => runtime.fitView({ padding: 0.18 }));
    }

    finishRemoteApply();
  }

  function applyRemoteOperation(operation: JsonOp[], document: SyncFlowDocument) {
    if (!Array.isArray(operation) || operation.length === 0) {
      return false;
    }

    let nodeIndex: number | undefined;
    let shouldRefreshNodeInternals = false;

    for (const component of operation) {
      const path = component.p;

      if (
        !Array.isArray(path) ||
        path[0] !== "nodes" ||
        typeof path[1] !== "number" ||
        path.length < 3 ||
        typeof path[2] !== "string" ||
        !granularNodeFields.has(path[2])
      ) {
        return false;
      }

      if (typeof nodeIndex === "undefined") {
        nodeIndex = path[1];
      } else if (nodeIndex !== path[1]) {
        return false;
      }

      if (path[2] === "data" && path[3] === "ports") {
        shouldRefreshNodeInternals = true;
      }
    }

    if (typeof nodeIndex === "undefined") {
      return false;
    }

    const documentNode = document.nodes[nodeIndex];

    if (!documentNode) {
      return false;
    }

    const localNodeIndex = runtime.nodes.value.findIndex((node) => node.id === documentNode.id);

    if (localNodeIndex < 0) {
      return false;
    }

    const nextNode = services.withSelectionState([
      stripParentExtent(withContentSizedNode(cloneJson(documentNode))) as FlowNode
    ])[0];
    const { data, ...nodePatch } = nextNode;

    if (!data) {
      return false;
    }

    runtime.isApplyingRemote.value = true;
    runtime.nodes.value[localNodeIndex] = nextNode;
    runtime.updateNodeData?.(documentNode.id, data, { replace: true });
    runtime.updateNode?.(documentNode.id, nodePatch);

    if (shouldRefreshNodeInternals) {
      nextTick(() => runtime.updateNodeInternals?.([documentNode.id]));
    }

    finishRemoteApply();
    return true;
  }

  function submitOperation(operation: JsonOp[]) {
    const document = runtime.flowDocument.value;

    if (!document || operation.length === 0) {
      return;
    }

    runtime.status.value = "Syncing";
    document.submitOp(operation, { source: runtime.localSource }, (error?: Error) => {
      if (error) {
        runtime.errorMessage.value = error.message;
        runtime.status.value = "Error";
        return;
      }

      runtime.errorMessage.value = "";
      runtime.status.value = "Live";
    });
  }

  function submitGraphReplacement(nextNodes: SyncNode[], nextEdges: SyncEdge[]) {
    const document = runtime.flowDocument.value;

    if (!document) {
      return;
    }

    const oldNodes = document.data.nodes;
    const oldEdges = document.data.edges;
    runtime.nodes.value = services.withSelectionState(nextNodes.map(stripParentExtent) as FlowNode[]);
    runtime.edges.value = withDefaultEdges(nextEdges, createGraphCache(nextNodes, nextEdges));
    nextTick(() => {
      runtime.updateNodeInternals?.(nextNodes.map((node) => node.id));
    });
    submitOperation([
      {
        p: ["nodes"],
        od: oldNodes,
        oi: nextNodes
      },
      {
        p: ["edges"],
        od: oldEdges,
        oi: nextEdges
      }
    ]);
  }

  function submitGraphSnapshot() {
    const document = runtime.flowDocument.value;

    if (!document || runtime.isApplyingRemote.value) {
      return;
    }

    const snapshot = runtime.toObject();
    const nextNodes = (snapshot.nodes as FlowNode[]).map(normalizeNode);
    const graph = createGraphCache(nextNodes);
    const nextEdges = (snapshot.edges as FlowEdge[]).map((edge) => normalizeEdge(edge, graph));
    const nextViewport = snapshot.viewport;
    const operation: JsonOp[] = [];

    if (!sameJson(document.data.nodes, nextNodes)) {
      operation.push({
        p: ["nodes"],
        od: document.data.nodes,
        oi: nextNodes
      });
    }

    if (!sameJson(document.data.edges, nextEdges)) {
      operation.push({
        p: ["edges"],
        od: document.data.edges,
        oi: nextEdges
      });
    }

    if (!sameJson(document.data.viewport, nextViewport)) {
      runtime.currentViewport.value = nextViewport;
      operation.push({
        p: ["viewport"],
        od: document.data.viewport,
        oi: nextViewport
      });
    }

    submitOperation(operation);
  }

  function documentMatchesLocal(document: SyncFlowDocument) {
    const localNodes = services.getCurrentSyncNodes();
    const localEdges = services.getCurrentSyncEdges(localNodes);

    return sameJson(document.nodes, localNodes) && sameJson(document.edges, localEdges);
  }

  function scheduleGraphSnapshot(delay = 250) {
    window.clearTimeout(runtime.timers.graphCommitTimer);
    runtime.timers.graphCommitTimer = window.setTimeout(submitGraphSnapshot, delay);
  }

  function cleanupRealtimeSync() {
    window.clearTimeout(runtime.timers.graphCommitTimer);
  }

  return {
    applyFlowDocument,
    applyRemoteOperation,
    cleanupRealtimeSync,
    documentMatchesLocal,
    scheduleGraphSnapshot,
    submitGraphReplacement,
    submitGraphSnapshot,
    submitOperation
  };
}
