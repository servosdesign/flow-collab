import type { FlowRuntime } from '../../flowRuntime'

type ViewportLike = { x: number, y: number, zoom: number }
type MovePayload = { flowTransform?: ViewportLike } | ViewportLike
const viewportEpsilon = 0.001

const hasViewportChanged = (current: ViewportLike, next: ViewportLike) => {
  return (
    Math.abs(current.x - next.x) > viewportEpsilon ||
    Math.abs(current.y - next.y) > viewportEpsilon ||
    Math.abs(current.zoom - next.zoom) > viewportEpsilon
  )
}

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
      runtime.selectionOverlayGeometrySnapshot.value = null
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

  const refreshSelectionBounds = (payload?: MovePayload) => {
    const nextViewport = getViewportFromPayload(payload)
    const viewportChanged = hasViewportChanged(runtime.currentViewport.value, nextViewport)

    if (viewportChanged) {
      runtime.currentViewport.value = {
        x: nextViewport.x,
        y: nextViewport.y,
        zoom: nextViewport.zoom
      }
    }

    if (viewportChanged && runtime.interaction.selectionMoveDrag) {
      runtime.interaction.scheduleSelectionMoveFrame?.()
    }
  }

  const handleViewportMove = (payload?: MovePayload) => {
    refreshSelectionBounds(payload)
  }

  const handleViewportMoveEnd = (payload?: MovePayload) => {
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
    handleViewportMoveEnd,
    refreshSelectionBounds,
    scheduleSelectionBoundsRefresh,
    updateCanvasSize
  }
}
