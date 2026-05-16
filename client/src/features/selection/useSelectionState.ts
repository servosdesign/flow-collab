import { nextTick } from "vue";
import type { FlowEditorServices } from "../../app/flowEditorServices";
import type { FlowEdge, FlowNode } from "../../domain/graph";
import type { FlowRuntime } from "../../flowRuntime";

export function areSelectionIdsEqual(currentIds: Set<string>, nextIds: string[]) {
  if (currentIds.size !== nextIds.length) {
    return false;
  }

  return nextIds.every((nodeId) => currentIds.has(nodeId));
}

export function useSelectionState(runtime: FlowRuntime, services: FlowEditorServices) {
  function getSelectedNodeIds() {
    return Array.from(runtime.selectedNodeIds.value);
  }

  function clearEdgeSelection() {
    let changed = false;
    const nextEdges = runtime.edges.value.map((edge) => {
      if ((edge as FlowEdge & { selected?: boolean }).selected) {
        changed = true;
        return { ...edge, selected: false } as unknown as FlowEdge;
      }

      return edge;
    });

    if (changed) {
      runtime.edges.value = nextEdges;
    }
  }

  function refreshSelectedNodeClasses() {
    runtime.nodes.value = services.withSelectionState(runtime.nodes.value as FlowNode[]);
  }

  function clearNodeSelection() {
    if (runtime.selectedNodeIds.value.size === 0) {
      return;
    }

    runtime.selectedNodeIds.value = new Set();
    refreshSelectedNodeClasses();
    nextTick(() => {
      services.scheduleSelectionBoundsRefresh();
      services.updatePresenceSelection();
    });
  }

  function isNodeSelected(nodeId: string) {
    return runtime.selectedNodeIds.value.has(nodeId);
  }

  function setSelectedNodes(nodeIds: string[]) {
    if (nodeIds.length > 0) {
      clearEdgeSelection();
    }

    if (areSelectionIdsEqual(runtime.selectedNodeIds.value, nodeIds)) {
      return;
    }

    runtime.selectedNodeIds.value = new Set(nodeIds);
    refreshSelectedNodeClasses();
    nextTick(() => {
      services.scheduleSelectionBoundsRefresh();
      services.updatePresenceSelection();
    });
  }

  function selectOnlyNode(nodeId: string) {
    if (!runtime.isLoggedIn.value) {
      return;
    }

    setSelectedNodes([nodeId]);
  }

  return {
    clearNodeSelection,
    getSelectedNodeIds,
    isNodeSelected,
    selectOnlyNode,
    setSelectedNodes
  };
}
