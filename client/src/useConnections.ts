import { MarkerType, type Connection as FlowConnection, type EdgeUpdateEvent } from "@vue-flow/core";
import { nextTick } from "vue";
import type { SyncNode } from "@vue-flow-sync/shared";
import {
  createGraphCache,
  getEdgeRenderType,
  type FlowEdge
} from "./graph";
import type { FlowRuntime } from "./flowRuntime";

function getAction<T>(runtime: FlowRuntime, name: string) {
  return runtime.actions[name] as T;
}

export function useConnections(runtime: FlowRuntime) {
  function handleConnect(connection: FlowConnection) {
    if (!runtime.isLoggedIn.value) {
      return;
    }

    const isValidSectionConnection = getAction<(connection: FlowConnection) => boolean>(
      runtime,
      "isValidSectionConnection"
    );

    if (!isValidSectionConnection(connection)) {
      runtime.errorMessage.value =
        "Section boundaries only connect direct children or top-level outside nodes.";
      runtime.status.value = "Error";
      window.setTimeout(() => {
        if (runtime.errorMessage.value.includes("section port")) {
          runtime.errorMessage.value = "";
          runtime.status.value = "Live";
        }
      }, 2400);
      return;
    }

    const getCurrentSyncNodes = getAction<() => SyncNode[]>(runtime, "getCurrentSyncNodes");
    const graph = createGraphCache(getCurrentSyncNodes());
    const nextEdge = {
      ...connection,
      id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
      sourceHandle: connection.sourceHandle ?? null,
      targetHandle: connection.targetHandle ?? null,
      type: getEdgeRenderType(connection, graph),
      markerEnd: MarkerType.ArrowClosed
    };

    runtime.addEdges([nextEdge]);
    nextTick(() => {
      runtime.updateNodeInternals?.([connection.source, connection.target].filter(Boolean) as string[]);
      getAction<() => void>(runtime, "submitGraphSnapshot")();
    });
  }

  function handleEdgeUpdate(payload: EdgeUpdateEvent) {
    if (!runtime.isLoggedIn.value) {
      return;
    }

    const nextEdges: FlowEdge[] = [];

    runtime.edges.value.forEach((edge) => {
      nextEdges.push({ ...edge } as FlowEdge);
    });

    const edge = nextEdges.find((candidate) => candidate.id === payload.edge.id);

    if (edge) {
      edge.source = payload.connection.source ?? edge.source;
      edge.target = payload.connection.target ?? edge.target;
      edge.sourceHandle = payload.connection.sourceHandle ?? edge.sourceHandle ?? null;
      edge.targetHandle = payload.connection.targetHandle ?? edge.targetHandle ?? null;
      edge.type = getEdgeRenderType(
        edge,
        createGraphCache(getAction<() => SyncNode[]>(runtime, "getCurrentSyncNodes")())
      );
      edge.markerEnd = MarkerType.ArrowClosed;
      runtime.edges.value = nextEdges;
    }

    nextTick(() => getAction<() => void>(runtime, "submitGraphSnapshot")());
  }

  return {
    handleConnect,
    handleEdgeUpdate
  };
}
