import { nextTick } from 'vue'
import type { FlowEditorServices } from '../../app/flowEditorServices'
import type { FlowEdge, FlowNode } from '../../domain/graph'
import type { FlowRuntime } from '../../flowRuntime'

type SelectionUpdateOptions = {
  deferEffects?: boolean
  afterEffects?: () => void
}

const deferredSelectionDelay = 160

export const areSelectionIdsEqual = (currentIds: Set<string>, nextIds: string[]) => {
  if (currentIds.size !== nextIds.length) {
    return false
  }

  return nextIds.every((nodeId) => currentIds.has(nodeId))
}

export const useSelectionState = (runtime: FlowRuntime, services: FlowEditorServices) => {
  let pendingDeferredSelection: {
    nodeIds: string[]
    afterEffects: Array<() => void>
  } | null = null

  const getSelectedNodeIds = () => {
    return Array.from(runtime.selectedNodeIds.value)
  }

  const clearDeferredSelection = () => {
    if (runtime.timers.deferredSelectionTimer) {
      window.clearTimeout(runtime.timers.deferredSelectionTimer)
      runtime.timers.deferredSelectionTimer = undefined
    }

    pendingDeferredSelection = null
    if (runtime.isDropSettling.value) {
      runtime.isDropSettling.value = false
      runtime.dropSettleVersion.value += 1
    }
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

  const runSelectionSideEffects = () => {
    const shouldFinishDropSettle = runtime.isDropSettling.value

    refreshSelectedNodeClasses()
    nextTick(() => {
      services.scheduleSelectionBoundsRefresh()
      services.updatePresenceSelection()
      if (shouldFinishDropSettle || runtime.isDropSettling.value) {
        runtime.isDropSettling.value = false
        runtime.dropSettleVersion.value += 1
      }
    })
  }

  const applySelectedNodes = (nodeIds: string[]) => {
    clearEdgeSelection()

    if (areSelectionIdsEqual(runtime.selectedNodeIds.value, nodeIds)) {
      return false
    }

    runtime.selectedNodeIds.value = new Set(nodeIds)
    runSelectionSideEffects()
    return true
  }

  const flushDeferredSelection = () => {
    const pending = pendingDeferredSelection

    runtime.timers.deferredSelectionTimer = undefined
    pendingDeferredSelection = null

    if (!pending) {
      runtime.isDropSettling.value = false
      runtime.dropSettleVersion.value += 1
      return
    }

    const changed = applySelectedNodes(pending.nodeIds)

    nextTick(() => {
      pending.afterEffects.forEach((callback) => callback())
      if (!changed && runtime.isDropSettling.value) {
        runtime.isDropSettling.value = false
        runtime.dropSettleVersion.value += 1
      }
    })
  }

  const scheduleDeferredSelection = (nodeIds: string[], afterEffects?: () => void) => {
    pendingDeferredSelection = {
      nodeIds,
      afterEffects: afterEffects ? [afterEffects] : []
    }
    runtime.isDropSettling.value = true

    if (runtime.timers.deferredSelectionTimer) {
      window.clearTimeout(runtime.timers.deferredSelectionTimer)
    }

    runtime.timers.deferredSelectionTimer = window.setTimeout(() => {
      window.requestAnimationFrame(flushDeferredSelection)
    }, deferredSelectionDelay)
  }

  const clearNodeSelection = () => {
    clearDeferredSelection()

    if (runtime.selectedNodeIds.value.size === 0) {
      return
    }

    runtime.selectedNodeIds.value = new Set()
    runSelectionSideEffects()
  }

  const isNodeSelected = (nodeId: string) => {
    return runtime.selectedNodeIds.value.has(nodeId)
  }

  const setSelectedNodes = (nodeIds: string[], options: SelectionUpdateOptions = {}) => {
    if (options.deferEffects) {
      scheduleDeferredSelection(nodeIds, options.afterEffects)
      return
    }

    clearDeferredSelection()
    applySelectedNodes(nodeIds)
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
