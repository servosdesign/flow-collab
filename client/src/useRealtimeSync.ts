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
} from "./graph";
import type { FlowRuntime } from "./flowRuntime";

function getAction<T>(runtime: FlowRuntime, name: string) {
  return runtime.actions[name] as T;
}

export function useRealtimeSync(runtime: FlowRuntime) {
  function applyFlowDocument(document: SyncFlowDocument, fit = false) {
    runtime.isApplyingRemote.value = true;

    const nextFlow = cloneJson(document);
    const nextNodes = nextFlow.nodes.map(withContentSizedNode).map(stripParentExtent);
    const withSelectionState = getAction<(nodes: FlowNode[]) => FlowNode[]>(
      runtime,
      "withSelectionState"
    );

    runtime.nodes.value = withSelectionState(nextNodes as FlowNode[]);
    runtime.edges.value = withDefaultEdges(
      nextFlow.edges,
      createGraphCache(nextNodes, nextFlow.edges)
    );
    runtime.currentViewport.value = nextFlow.viewport;
    runtime.setViewport(nextFlow.viewport);

    if (fit) {
      window.requestAnimationFrame(() => runtime.fitView({ padding: 0.18 }));
    }

    nextTick(() => {
      runtime.isApplyingRemote.value = false;
      runtime.isFlowLoading.value = false;
    });
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
    const withSelectionState = getAction<(nodes: FlowNode[]) => FlowNode[]>(
      runtime,
      "withSelectionState"
    );
    runtime.nodes.value = withSelectionState(nextNodes.map(stripParentExtent) as FlowNode[]);
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
    const getCurrentSyncNodes = getAction<() => SyncNode[]>(runtime, "getCurrentSyncNodes");
    const getCurrentSyncEdges = getAction<(nodes?: SyncNode[]) => SyncEdge[]>(
      runtime,
      "getCurrentSyncEdges"
    );
    const localNodes = getCurrentSyncNodes();
    const localEdges = getCurrentSyncEdges(localNodes);

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
    cleanupRealtimeSync,
    documentMatchesLocal,
    scheduleGraphSnapshot,
    submitGraphReplacement,
    submitGraphSnapshot,
    submitOperation
  };
}
