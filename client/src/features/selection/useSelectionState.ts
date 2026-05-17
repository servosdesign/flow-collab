import { nextTick } from 'vue'
import type { FlowEditorServices } from '../../app/flowEditorServices'
import type { FlowEdge, FlowNode } from '../../domain/graph'
import type { FlowRuntime } from '../../flowRuntime'

export const areSelectionIdsEqual = (currentIds: Set<string>, nextIds: string[]) => {
  if (currentIds.size !== nextIds.length) {
    return false
  }

  return nextIds.every((nodeId) => currentIds.has(nodeId))
}

export const useSelectionState = (runtime: FlowRuntime, services: FlowEditorServices) => {
  const getSelectedNodeIds = () => {
    return Array.from(runtime.selectedNodeIds.value)
  }

  const clearEdgeSelection = () => {
    if (!runtime.edges.value.some((edge) => (edge as FlowEdge & { selected?: boolean }).selected)) {
      return
    }

    const nextEdges = runtime.edges.value.map((edge) => {
      if ((edge as FlowEdge & { selected?: boolean }).selected) {
        return { ...edge, selected: false } as unknown as FlowEdge
      }

      return edge
    })

    runtime.edges.value = nextEdges
  }

  const refreshSelectedNodeClasses = () => {
    runtime.nodes.value = services.withSelectionState(runtime.nodes.value as FlowNode[])
  }

  const clearNodeSelection = () => {
    if (runtime.selectedNodeIds.value.size === 0) {
      return
    }

    runtime.selectedNodeIds.value = new Set()
    refreshSelectedNodeClasses()
    nextTick(() => {
      services.scheduleSelectionBoundsRefresh()
      services.updatePresenceSelection()
    })
  }

  const isNodeSelected = (nodeId: string) => {
    return runtime.selectedNodeIds.value.has(nodeId)
  }

  const setSelectedNodes = (nodeIds: string[]) => {
    clearEdgeSelection()

    if (areSelectionIdsEqual(runtime.selectedNodeIds.value, nodeIds)) {
      return
    }

    runtime.selectedNodeIds.value = new Set(nodeIds)
    refreshSelectedNodeClasses()
    nextTick(() => {
      services.scheduleSelectionBoundsRefresh()
      services.updatePresenceSelection()
    })
  }

  const selectOnlyNode = (nodeId: string) => {
    if (!runtime.isLoggedIn.value) {
      return
    }

    setSelectedNodes([nodeId])
  }

  return {
    clearNodeSelection,
    getSelectedNodeIds,
    isNodeSelected,
    selectOnlyNode,
    setSelectedNodes
  }
}
