import { nextTick } from 'vue'
import type { SyncEdge, SyncFlowDocument, SyncNode } from '@vue-flow-sync/shared'
import type { JsonOp } from 'sharedb/lib/client'
import {
  cloneJson,
  createGraphCache,
  normalizeEdge,
  normalizeNode,
  orderNodesByHierarchy,
  sameJson,
  stripParentExtent,
  withContentSizedNode,
  withDefaultEdges,
  type FlowEdge,
  type FlowNode
} from '../../domain/graph'
import type { FlowEditorServices } from '../../app/flowEditorServices'
import type { FlowRuntime } from '../../flowRuntime'

export const useRealtimeSync = (runtime: FlowRuntime, services: FlowEditorServices) => {
  const granularNodeFields = new Set(['data', 'style', 'width', 'height', 'position'])

  const toRuntimeNode = (documentNode: SyncNode) => {
    return services.withSelectionState([
      stripParentExtent(withContentSizedNode(cloneJson(documentNode))) as FlowNode
    ])[0]
  }

  const finishRemoteApply = () => {
    nextTick(() => {
      runtime.isApplyingRemote.value = false
      runtime.isFlowLoading.value = false
    })
  }

  const applyFlowDocument = (document: SyncFlowDocument, fit = false) => {
    runtime.isApplyingRemote.value = true

    const nextFlow = cloneJson(document)
    const nextNodes = orderNodesByHierarchy(
      nextFlow.nodes.map(withContentSizedNode).map(stripParentExtent)
    )

    runtime.nodes.value = services.withSelectionState(nextNodes as FlowNode[])
    runtime.edges.value = withDefaultEdges(
      nextFlow.edges,
      createGraphCache(nextNodes, nextFlow.edges)
    )
    runtime.currentViewport.value = nextFlow.viewport
    runtime.setViewport(nextFlow.viewport)

    if (fit) {
      window.requestAnimationFrame(() => runtime.fitView({ padding: 0.18 }))
    }

    finishRemoteApply()
  }

  const applyRemoteGranularNodeOperation = (operation: JsonOp[], document: SyncFlowDocument) => {
    if (!Array.isArray(operation) || operation.length === 0) {
      return false
    }

    let nodeIndex: number | undefined
    let shouldRefreshNodeInternals = false

    for (const component of operation) {
      const path = component.p

      if (
        !Array.isArray(path) ||
        path[0] !== 'nodes' ||
        typeof path[1] !== 'number' ||
        path.length < 3 ||
        typeof path[2] !== 'string' ||
        !granularNodeFields.has(path[2])
      ) {
        return false
      }

      if (typeof nodeIndex === 'undefined') {
        nodeIndex = path[1]
      } else if (nodeIndex !== path[1]) {
        return false
      }

      if (path[2] === 'data' && path[3] === 'ports') {
        shouldRefreshNodeInternals = true
      }
    }

    if (typeof nodeIndex === 'undefined') {
      return false
    }

    const documentNode = document.nodes[nodeIndex]

    if (!documentNode) {
      return false
    }

    const localNodeIndex = runtime.nodes.value.findIndex((node) => node.id === documentNode.id)

    if (localNodeIndex < 0) {
      return false
    }

    const nextNode = toRuntimeNode(documentNode)
    const { data, ...nodePatch } = nextNode

    if (!data) {
      return false
    }

    runtime.isApplyingRemote.value = true
    runtime.nodes.value[localNodeIndex] = nextNode
    runtime.updateNodeData?.(documentNode.id, data, { replace: true })
    runtime.updateNode?.(documentNode.id, nodePatch)

    if (shouldRefreshNodeInternals) {
      nextTick(() => runtime.updateNodeInternals?.([documentNode.id]))
    }

    finishRemoteApply()
    return true
  }

  const isNodeListOperation = (component: JsonOp) => {
    return (
      Array.isArray(component.p) &&
      component.p[0] === 'nodes' &&
      typeof component.p[1] === 'number' &&
      component.p.length === 2 &&
      ('li' in component || 'ld' in component)
    )
  }

  const findNodeIndexById = (nodes: FlowNode[], nodeId: unknown) => {
    return typeof nodeId === 'string' ? nodes.findIndex((node) => node.id === nodeId) : -1
  }

  const applyRemoteNodeListOperation = (operation: JsonOp[], document: SyncFlowDocument) => {
    if (!operation.every(isNodeListOperation)) {
      return false
    }

    const nextNodes = [...runtime.nodes.value] as FlowNode[]
    const changedNodeIds = new Set<string>()
    const removedNodeIds = new Set<string>()

    for (const component of operation) {
      const targetIndex = component.p[1] as number
      const hasInsert = 'li' in component
      const hasDelete = 'ld' in component
      const insertedNode = component.li as SyncNode | undefined
      const deletedNode = component.ld as SyncNode | undefined

      if (hasInsert && insertedNode?.id) {
        const documentNode =
          document.nodes.find((node) => node.id === insertedNode.id) ?? insertedNode
        const nextNode = toRuntimeNode(documentNode)
        const existingIndex = findNodeIndexById(nextNodes, nextNode.id)

        if (hasDelete) {
          const replaceIndex = existingIndex >= 0 ? existingIndex : targetIndex

          if (replaceIndex < 0 || replaceIndex >= nextNodes.length) {
            return false
          }

          nextNodes[replaceIndex] = nextNode
        } else if (existingIndex >= 0) {
          nextNodes[existingIndex] = nextNode
        } else {
          nextNodes.splice(Math.max(0, Math.min(targetIndex, nextNodes.length)), 0, nextNode)
        }

        changedNodeIds.add(nextNode.id)
        continue
      }

      if (hasDelete) {
        const deleteIndex = findNodeIndexById(nextNodes, deletedNode?.id)
        const removeIndex = deleteIndex >= 0 ? deleteIndex : targetIndex
        const removedNode = nextNodes[removeIndex]

        if (!removedNode) {
          return false
        }

        nextNodes.splice(removeIndex, 1)
        removedNodeIds.add(removedNode.id)
        continue
      }

      return false
    }

    runtime.isApplyingRemote.value = true
    if (removedNodeIds.size > 0) {
      runtime.selectedNodeIds.value = new Set(
        Array.from(runtime.selectedNodeIds.value).filter((nodeId) => !removedNodeIds.has(nodeId))
      )
    }
    runtime.nodes.value = nextNodes

    if (changedNodeIds.size > 0) {
      nextTick(() => runtime.updateNodeInternals?.(Array.from(changedNodeIds)))
    }

    finishRemoteApply()
    return true
  }

  const applyRemoteGraphReplacement = (operation: JsonOp[], document: SyncFlowDocument) => {
    if (
      !operation.every(
        (component) =>
          Array.isArray(component.p) &&
          component.p.length === 1 &&
          (component.p[0] === 'nodes' ||
            component.p[0] === 'edges' ||
            component.p[0] === 'viewport')
      )
    ) {
      return false
    }

    const nodeComponent = operation.find((component) => component.p[0] === 'nodes')
    const edgeComponent = operation.find((component) => component.p[0] === 'edges')
    const movingIds = runtime.interaction.selectionMoveDrag?.movingIds ?? new Set<string>()
    const changedNodeIds = new Set<string>()

    runtime.isApplyingRemote.value = true

    if (nodeComponent && !sameJson(nodeComponent.od, nodeComponent.oi)) {
      const existingNodesById = new Map(runtime.nodes.value.map((node) => [node.id, node]))
      const orderedDocumentNodes = orderNodesByHierarchy(document.nodes.map(cloneJson))
      const nextNodes = orderedDocumentNodes.map((documentNode) => {
        const existingNode = existingNodesById.get(documentNode.id) as FlowNode | undefined

        if (existingNode && movingIds.has(documentNode.id)) {
          return existingNode
        }

        const nextNode = toRuntimeNode(documentNode)

        if (existingNode && sameJson(normalizeNode(existingNode), normalizeNode(nextNode))) {
          return existingNode
        }

        changedNodeIds.add(documentNode.id)
        return nextNode
      })
      const documentNodeIds = new Set(orderedDocumentNodes.map((node) => node.id))

      runtime.selectedNodeIds.value = new Set(
        Array.from(runtime.selectedNodeIds.value).filter((nodeId) => documentNodeIds.has(nodeId))
      )
      runtime.nodes.value = nextNodes
    }

    if (edgeComponent && !sameJson(edgeComponent.od, edgeComponent.oi)) {
      runtime.edges.value = withDefaultEdges(
        document.edges,
        createGraphCache(orderNodesByHierarchy(document.nodes.map(cloneJson)), document.edges)
      )
    }

    if (changedNodeIds.size > 0) {
      nextTick(() => runtime.updateNodeInternals?.(Array.from(changedNodeIds)))
    }

    finishRemoteApply()
    return true
  }

  const applyRemoteOperation = (operation: JsonOp[], document: SyncFlowDocument) => {
    if (!Array.isArray(operation) || operation.length === 0) {
      return false
    }

    return (
      applyRemoteGranularNodeOperation(operation, document) ||
      applyRemoteNodeListOperation(operation, document) ||
      applyRemoteGraphReplacement(operation, document)
    )
  }

  const submitOperation = (operation: JsonOp[]) => {
    const document = runtime.flowDocument.value

    if (!document || operation.length === 0) {
      return
    }

    runtime.status.value = 'Syncing'
    document.submitOp(operation, { source: runtime.localSource }, (error?: Error) => {
      if (error) {
        runtime.errorMessage.value = error.message
        runtime.status.value = 'Error'
        return
      }

      runtime.errorMessage.value = ''
      runtime.status.value = 'Live'
    })
  }

  const submitGraphReplacement = (nextNodes: SyncNode[], nextEdges: SyncEdge[]) => {
    const document = runtime.flowDocument.value

    if (!document) {
      return
    }

    const oldNodes = document.data.nodes
    const oldEdges = document.data.edges
    orderNodesByHierarchy(nextNodes)
    runtime.nodes.value = services.withSelectionState(nextNodes.map(stripParentExtent) as FlowNode[])
    runtime.edges.value = withDefaultEdges(nextEdges, createGraphCache(nextNodes, nextEdges))
    nextTick(() => {
      runtime.updateNodeInternals?.(nextNodes.map((node) => node.id))
    })
    submitOperation(
      [
        !sameJson(oldNodes, nextNodes) && {
          p: ['nodes'],
          od: oldNodes,
          oi: nextNodes
        },
        !sameJson(oldEdges, nextEdges) && {
          p: ['edges'],
          od: oldEdges,
          oi: nextEdges
        }
      ].filter(Boolean) as JsonOp[]
    )
  }

  const submitGraphSnapshot = () => {
    const document = runtime.flowDocument.value

    if (!document || runtime.isApplyingRemote.value) {
      return
    }

    const snapshot = runtime.toObject()
    const nextNodes = orderNodesByHierarchy((snapshot.nodes as FlowNode[]).map(normalizeNode))
    const graph = createGraphCache(nextNodes)
    const nextEdges = (snapshot.edges as FlowEdge[]).map((edge) => normalizeEdge(edge, graph))
    const nextViewport = snapshot.viewport
    const operation: JsonOp[] = []

    if (!sameJson(document.data.nodes, nextNodes)) {
      operation.push({
        p: ['nodes'],
        od: document.data.nodes,
        oi: nextNodes
      })
    }

    if (!sameJson(document.data.edges, nextEdges)) {
      operation.push({
        p: ['edges'],
        od: document.data.edges,
        oi: nextEdges
      })
    }

    if (!sameJson(document.data.viewport, nextViewport)) {
      runtime.currentViewport.value = nextViewport
      operation.push({
        p: ['viewport'],
        od: document.data.viewport,
        oi: nextViewport
      })
    }

    submitOperation(operation)
  }

  const documentMatchesLocal = (document: SyncFlowDocument) => {
    const localNodes = orderNodesByHierarchy(services.getCurrentSyncNodes())
    const documentNodes = orderNodesByHierarchy(cloneJson(document.nodes))
    const localEdges = services.getCurrentSyncEdges(localNodes)

    return sameJson(documentNodes, localNodes) && sameJson(document.edges, localEdges)
  }

  const scheduleGraphSnapshot = (delay = 250) => {
    window.clearTimeout(runtime.timers.graphCommitTimer)
    runtime.timers.graphCommitTimer = window.setTimeout(submitGraphSnapshot, delay)
  }

  const cleanupRealtimeSync = () => {
    window.clearTimeout(runtime.timers.graphCommitTimer)
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
  }
}
