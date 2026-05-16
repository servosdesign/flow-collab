import type { Connection as FlowConnection } from "@vue-flow/core";
import type { SyncEdge } from "@vue-flow-sync/shared";
import {
  createGraphCache,
  isValidSectionConnection as isValidSectionConnectionForGraph,
  normalizeEdge,
  normalizeNode,
  type FlowEdge,
  type FlowNode
} from ".";
import type { FlowRuntime } from "../../flowRuntime";

export function useGraphState(runtime: FlowRuntime) {
  function withSelectionState(flowNodes: FlowNode[]) {
    return flowNodes.map((node) => {
      const classNames = (typeof node.class === "string" ? node.class.split(/\s+/) : [])
        .filter(Boolean)
        .filter((className) => className !== "nested-flow-node");

      if (node.parentNode) {
        classNames.push("nested-flow-node");
      }

      return {
        ...node,
        class: classNames.join(" "),
        selected: false,
        selectable: false
      } as FlowNode;
    });
  }

  function getCurrentSyncNodes() {
    return (runtime.nodes.value as FlowNode[]).map(normalizeNode);
  }

  function getCurrentGraph(syncNodes = getCurrentSyncNodes(), syncEdges: SyncEdge[] = []) {
    return createGraphCache(syncNodes, syncEdges);
  }

  function getCurrentSyncEdges(syncNodes = getCurrentSyncNodes()) {
    const graph = createGraphCache(syncNodes);

    return (runtime.edges.value as FlowEdge[]).map((edge) => normalizeEdge(edge, graph));
  }

  function getSyncNodeById(nodeId?: string | null) {
    if (!nodeId) {
      return undefined;
    }

    return getCurrentGraph().nodeById.get(nodeId);
  }

  function isChildOfSection(nodeId: string | null | undefined, sectionId: string) {
    const node = getSyncNodeById(nodeId);

    return node?.parentNode === sectionId;
  }

  function isValidSectionConnection(connection: FlowConnection) {
    const syncNodes = getCurrentSyncNodes();
    const syncEdges = getCurrentSyncEdges(syncNodes);

    return isValidSectionConnectionForGraph(connection, createGraphCache(syncNodes, syncEdges));
  }

  return {
    getCurrentGraph,
    getCurrentSyncEdges,
    getCurrentSyncNodes,
    getSyncNodeById,
    isChildOfSection,
    isValidSectionConnection,
    withSelectionState
  };
}
