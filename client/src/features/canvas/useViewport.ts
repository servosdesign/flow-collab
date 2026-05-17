import type { FlowRuntime } from '../../flowRuntime'

type ViewportLike = { x: number, y: number, zoom: number }
type MovePayload = { flowTransform?: ViewportLike } | ViewportLike

export const useViewport = (runtime: FlowRuntime) => {
  const updateCanvasSize = () => {
    const bounds = runtime.canvasPanel.value?.getBoundingClientRect()

    if (!bounds) {
      return
    }

    runtime.canvasClientBounds.value = {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height
    }
    runtime.canvasSize.value = {
      width: bounds.width,
      height: bounds.height
    }
    scheduleSelectionBoundsRefresh()
  }

  const scheduleSelectionBoundsRefresh = () => {
    if (runtime.timers.selectionBoundsFrame) {
      return
    }

    runtime.timers.selectionBoundsFrame = window.requestAnimationFrame(() => {
      runtime.timers.selectionBoundsFrame = undefined
      runtime.selectionBoundsVersion.value += 1
    })
  }

  const getViewportFromPayload = (payload?: MovePayload) => {
    if (!payload) {
      return runtime.toObject().viewport
    }

    if ('x' in payload && 'y' in payload && 'zoom' in payload) {
      return payload
    }

    if ('flowTransform' in payload && payload.flowTransform) {
      return payload.flowTransform
    }

    return runtime.currentViewport.value
  }

  const needsViewportSelectionBoundsRefresh = () => {
    return (
      runtime.selectedNodeIds.value.size > 1 ||
      runtime.isLassoSelecting.value ||
      runtime.lassoPreviewNodeIds.value.size > 0 ||
      runtime.rightSelection.value !== null ||
      runtime.sectionNodeDragPreview.value !== null ||
      runtime.interaction.selectionMoveDrag !== null ||
      runtime.isMovingSelection.value
    )
  }

  const refreshSelectionBounds = (payload?: MovePayload) => {
    runtime.currentViewport.value = getViewportFromPayload(payload)

    if (runtime.interaction.selectionMoveDrag) {
      runtime.interaction.scheduleSelectionMoveFrame?.()
    }

    if (needsViewportSelectionBoundsRefresh()) {
      scheduleSelectionBoundsRefresh()
    }
  }

  const handleViewportMove = (payload?: MovePayload) => {
    refreshSelectionBounds(payload)
  }

  const cleanupViewport = () => {
    if (runtime.timers.selectionBoundsFrame) {
      window.cancelAnimationFrame(runtime.timers.selectionBoundsFrame)
      runtime.timers.selectionBoundsFrame = undefined
    }
  }

  return {
    cleanupViewport,
    handleViewportMove,
    refreshSelectionBounds,
    scheduleSelectionBoundsRefresh,
    updateCanvasSize
  }
}
