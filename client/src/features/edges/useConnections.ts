import { MarkerType, type Connection as FlowConnection } from '@vue-flow/core'
import { nextTick } from 'vue'
import {
  createGraphCache,
  getEdgeRenderType,
  type FlowEdge
} from '../../domain/graph'
import type { FlowEditorServices } from '../../app/flowEditorServices'
import type { FlowRuntime } from '../../flowRuntime'

export const useConnections = (runtime: FlowRuntime, services: FlowEditorServices) => {
  const handleConnect = (connection: FlowConnection) => {
    if (!runtime.isLoggedIn.value) {
      return
    }

    if (!services.isValidSectionConnection(connection)) {
      runtime.errorMessage.value =
        'Section boundaries only connect direct children or top-level outside nodes.'
      runtime.status.value = 'Error'
      window.setTimeout(() => {
        if (runtime.errorMessage.value.includes('section port')) {
          runtime.errorMessage.value = ''
          runtime.status.value = 'Live'
        }
      }, 2400)
      return
    }

    const graph = createGraphCache(services.getCurrentSyncNodes())
    const nextEdge = {
      ...connection,
      id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
      sourceHandle: connection.sourceHandle ?? null,
      targetHandle: connection.targetHandle ?? null,
      type: getEdgeRenderType(connection, graph),
      markerEnd: MarkerType.ArrowClosed
    }

    runtime.edges.value = [...runtime.edges.value, nextEdge as FlowEdge]
    nextTick(() => {
      runtime.updateNodeInternals?.([connection.source, connection.target].filter(Boolean) as string[])
      services.submitGraphSnapshot()
    })
  }

  const updateEdgeConnectionById = (edgeId: string, connection: FlowConnection) => {
    if (!runtime.isLoggedIn.value) {
      return false
    }

    if (!services.isValidSectionConnection(connection)) {
      return false
    }

    const nextEdges: FlowEdge[] = []

    runtime.edges.value.forEach((edge) => {
      nextEdges.push({ ...edge } as FlowEdge)
    })

    const edge = nextEdges.find((candidate) => candidate.id === edgeId)

    if (edge) {
      edge.source = connection.source
      edge.target = connection.target
      edge.sourceHandle = connection.sourceHandle ?? null
      edge.targetHandle = connection.targetHandle ?? null
      edge.type = getEdgeRenderType(
        edge,
        createGraphCache(services.getCurrentSyncNodes())
      )
      edge.markerEnd = MarkerType.ArrowClosed
      runtime.edges.value = nextEdges
      nextTick(() => services.submitGraphSnapshot())
      return true
    }

    return false
  }

  return {
    handleConnect,
    updateEdgeConnectionById
  }
}
