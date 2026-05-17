import type { ValidConnectionFunc } from '@vue-flow/core'
import type { SyncEdge } from '@vue-flow-sync/shared'
import {
  createGraphCache,
  isValidSectionConnection as isValidSectionConnectionForGraph,
  normalizeEdge,
  normalizeNode,
  type GraphCache,
  type FlowEdge,
  type FlowNode
} from '.'
import type { FlowRuntime } from '../../flowRuntime'

type ValidConnection = Parameters<ValidConnectionFunc>[0]
type ValidConnectionElements = Parameters<ValidConnectionFunc>[1]
type SectionConnectionValidator = (
  connection: ValidConnection,
  elements?: ValidConnectionElements
) => boolean

export const useGraphState = (runtime: FlowRuntime) => {
  let validationGraphCache: { nodes: readonly unknown[], graph: GraphCache } | null = null
  let clearValidationGraphCacheQueued = false

  const scheduleValidationGraphCacheClear = () => {
    if (clearValidationGraphCacheQueued) {
      return
    }

    clearValidationGraphCacheQueued = true
    queueMicrotask(() => {
      validationGraphCache = null
      clearValidationGraphCacheQueued = false
    })
  }

  const getValidationGraph = (nodes: readonly unknown[]) => {
    if (validationGraphCache?.nodes === nodes) {
      return validationGraphCache.graph
    }

    const syncNodes = (nodes as FlowNode[]).map(normalizeNode)
    const graph = createGraphCache(syncNodes)
    validationGraphCache = { nodes, graph }
    scheduleValidationGraphCacheClear()

    return graph
  }

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

      const className = classNames.join(' ')

      if (
        node.class === className &&
        node.selected === false &&
        node.selectable === false
      ) {
        return node
      }

      return {
        ...node,
        class: className,
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

  const isValidSectionConnection: SectionConnectionValidator = (connection, elements) => {
    const graph = getValidationGraph(elements?.nodes ?? runtime.nodes.value)

    return isValidSectionConnectionForGraph(connection, graph)
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
