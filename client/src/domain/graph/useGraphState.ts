import type { Connection as FlowConnection } from '@vue-flow/core'
import type { SyncEdge } from '@vue-flow-sync/shared'
import {
  createGraphCache,
  isValidSectionConnection as isValidSectionConnectionForGraph,
  normalizeEdge,
  normalizeNode,
  type FlowEdge,
  type FlowNode
} from '.'
import type { FlowRuntime } from '../../flowRuntime'

export const useGraphState = (runtime: FlowRuntime) => {
  const withSelectionState = (flowNodes: FlowNode[]) => {
    return flowNodes.map((node) => {
      const classNames = (typeof node.class === 'string' ? node.class.split(/\s+/) : [])
        .filter(Boolean)
        .filter(
          (className) =>
            className !== 'nested-flow-node' &&
            className !== 'selection-selected-node' &&
            className !== 'section-dragging' &&
            className !== 'section-drag-over-larger-section'
        )

      if (node.parentNode) {
        classNames.push('nested-flow-node')
      }

      if (runtime.selectedNodeIds.value.has(node.id)) {
        classNames.push('selection-selected-node')
      }

      return {
        ...node,
        class: classNames.join(' '),
        selected: false,
        selectable: false
      } as FlowNode
    })
  }

  const getCurrentSyncNodes = () => {
    return (runtime.nodes.value as FlowNode[]).map(normalizeNode)
  }

  const getCurrentGraph = (syncNodes = getCurrentSyncNodes(), syncEdges: SyncEdge[] = []) => {
    return createGraphCache(syncNodes, syncEdges)
  }

  const getCurrentSyncEdges = (syncNodes = getCurrentSyncNodes()) => {
    const graph = createGraphCache(syncNodes)

    return (runtime.edges.value as FlowEdge[]).map((edge) => normalizeEdge(edge, graph))
  }

  const getSyncNodeById = (nodeId?: string | null) => {
    if (!nodeId) {
      return undefined
    }

    return getCurrentGraph().nodeById.get(nodeId)
  }

  const isChildOfSection = (nodeId: string | null | undefined, sectionId: string) => {
    const node = getSyncNodeById(nodeId)

    return node?.parentNode === sectionId
  }

  const isValidSectionConnection = (connection: FlowConnection) => {
    const syncNodes = getCurrentSyncNodes()
    const syncEdges = getCurrentSyncEdges(syncNodes)

    return isValidSectionConnectionForGraph(connection, createGraphCache(syncNodes, syncEdges))
  }

  return {
    getCurrentGraph,
    getCurrentSyncEdges,
    getCurrentSyncNodes,
    getSyncNodeById,
    isChildOfSection,
    isValidSectionConnection,
    withSelectionState
  }
}
