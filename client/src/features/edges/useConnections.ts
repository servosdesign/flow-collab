import { MarkerType, type Connection as FlowConnection, type EdgeUpdateEvent } from '@vue-flow/core'
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

    runtime.addEdges([nextEdge])
    nextTick(() => {
      runtime.updateNodeInternals?.([connection.source, connection.target].filter(Boolean) as string[])
      services.submitGraphSnapshot()
    })
  }

  const handleEdgeUpdate = (payload: EdgeUpdateEvent) => {
    if (!runtime.isLoggedIn.value) {
      return
    }

    const nextEdges: FlowEdge[] = []

    runtime.edges.value.forEach((edge) => {
      nextEdges.push({ ...edge } as FlowEdge)
    })

    const edge = nextEdges.find((candidate) => candidate.id === payload.edge.id)

    if (edge) {
      edge.source = payload.connection.source ?? edge.source
      edge.target = payload.connection.target ?? edge.target
      edge.sourceHandle = payload.connection.sourceHandle ?? edge.sourceHandle ?? null
      edge.targetHandle = payload.connection.targetHandle ?? edge.targetHandle ?? null
      edge.type = getEdgeRenderType(
        edge,
        createGraphCache(services.getCurrentSyncNodes())
      )
      edge.markerEnd = MarkerType.ArrowClosed
      runtime.edges.value = nextEdges
    }

    nextTick(() => services.submitGraphSnapshot())
  }

  return {
    handleConnect,
    handleEdgeUpdate
  }
}
