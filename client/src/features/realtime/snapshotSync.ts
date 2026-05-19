import { nextTick } from 'vue'
import type { SyncEdge, SyncFlowDocument, SyncNode } from '@vue-flow-sync/shared'
import type { JsonOp } from 'sharedb/lib/client'
import {
  cloneJson,
  createGraphCache,
  orderNodesByHierarchy,
  sameJson,
  stripParentExtent,
  withDefaultEdges,
  type FlowNode
} from '../../domain/graph'
import type { FlowEditorServices } from '../../app/flowEditorServices'
import type { FlowRuntime } from '../../flowRuntime'

export const createRealtimeSnapshotSync = (
  runtime: FlowRuntime,
  services: FlowEditorServices
) => {
  const bumpMiniMapGeometryVersion = () => {
    runtime.miniMapGeometryVersion.value += 1
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
    if (!sameJson(oldNodes, nextNodes)) {
      bumpMiniMapGeometryVersion()
    }
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

    const nextNodes = orderNodesByHierarchy(services.getCurrentSyncNodes())
    const nextEdges = services.getCurrentSyncEdges(nextNodes)
    const nextViewport = runtime.currentViewport.value
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

  const submitViewportSnapshot = () => {
    const document = runtime.flowDocument.value

    if (!document || runtime.isApplyingRemote.value) {
      return
    }

    const nextViewport = runtime.currentViewport.value

    if (sameJson(document.data.viewport, nextViewport)) {
      return
    }

    submitOperation([
      {
        p: ['viewport'],
        od: document.data.viewport,
        oi: nextViewport
      }
    ])
  }

  const documentMatchesLocal = (document: SyncFlowDocument) => {
    const localNodes = orderNodesByHierarchy(services.getCurrentSyncNodes())
    const documentNodes = orderNodesByHierarchy(cloneJson(document.nodes))
    const localEdges = services.getCurrentSyncEdges(localNodes)

    return sameJson(documentNodes, localNodes) && sameJson(document.edges, localEdges)
  }

  const scheduleGraphSnapshot = (delay = 250) => {
    window.clearTimeout(runtime.timers.viewportCommitTimer)
    runtime.timers.viewportCommitTimer = undefined
    window.clearTimeout(runtime.timers.graphCommitTimer)
    runtime.timers.graphCommitTimer = window.setTimeout(() => {
      runtime.timers.graphCommitTimer = undefined
      submitGraphSnapshot()
    }, delay)
  }

  const scheduleViewportSnapshot = (delay = 250) => {
    if (runtime.timers.graphCommitTimer) {
      return
    }

    window.clearTimeout(runtime.timers.viewportCommitTimer)
    runtime.timers.viewportCommitTimer = window.setTimeout(() => {
      runtime.timers.viewportCommitTimer = undefined
      submitViewportSnapshot()
    }, delay)
  }

  const cleanupRealtimeSync = () => {
    window.clearTimeout(runtime.timers.graphCommitTimer)
    runtime.timers.graphCommitTimer = undefined
    window.clearTimeout(runtime.timers.viewportCommitTimer)
    runtime.timers.viewportCommitTimer = undefined
  }

  return {
    cleanupRealtimeSync,
    documentMatchesLocal,
    scheduleGraphSnapshot,
    scheduleViewportSnapshot,
    submitGraphReplacement,
    submitGraphSnapshot,
    submitOperation,
    submitViewportSnapshot
  }
}
