import type { JsonOp } from 'sharedb/lib/client'
import {
  createGraphCache,
  withDefaultEdges,
  type FlowEdge
} from '../../domain/graph'
import type { FlowEditorServices } from '../../app/flowEditorServices'
import type { FlowRuntime } from '../../flowRuntime'

type SelectionCommandOptions = {
  clearNodeSelectionImmediate: () => void
  getSelectedNodeIds: () => string[]
}

export const createSelectionCommands = (
  runtime: FlowRuntime,
  services: FlowEditorServices,
  options: SelectionCommandOptions
) => {
  const selectOnlyEdge = (edgeId: string) => {
    if (!runtime.isLoggedIn.value) {
      return
    }

    options.clearNodeSelectionImmediate()
    runtime.edges.value = runtime.edges.value.map((edge) => ({
      ...edge,
      selected: edge.id === edgeId
    })) as unknown as FlowEdge[]
  }

  const deleteSelectedElements = () => {
    if (!runtime.isLoggedIn.value) {
      return
    }

    const activeElement = document.activeElement

    if (
      activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement
    ) {
      return
    }

    const selectedNodeIds = options.getSelectedNodeIds()
    const selectedEdgeIds: string[] = []

    runtime.edges.value.forEach((edge) => {
      if ((edge as FlowEdge & { selected?: boolean }).selected) {
        selectedEdgeIds.push(edge.id)
      }
    })
    const flowDocumentValue = runtime.flowDocument.value

    if (!flowDocumentValue) {
      return
    }

    if (selectedNodeIds.length > 0) {
      services.deleteNodesById(selectedNodeIds)
      return
    }

    if (selectedEdgeIds.length > 0) {
      const selectedEdgeSet = new Set(selectedEdgeIds)
      const nextEdges = flowDocumentValue.data.edges.filter(
        (edge) => !selectedEdgeSet.has(edge.id)
      )

      runtime.edges.value = withDefaultEdges(
        nextEdges,
        createGraphCache(services.getCurrentSyncNodes(), nextEdges)
      )
      services.submitOperation([
        {
          p: ['edges'],
          od: flowDocumentValue.data.edges,
          oi: nextEdges
        }
      ] as JsonOp[])
    }
  }

  return {
    deleteSelectedElements,
    selectOnlyEdge
  }
}
