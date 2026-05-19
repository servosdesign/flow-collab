import type { FlowEditorServices } from '../../app/flowEditorServices'
import type { FlowRuntime } from '../../flowRuntime'
import { getNodeElementFromTarget } from './selectionDom'
import {
  isCanvasSelectionTarget,
  isNodeMoveBlockedTarget,
  isSelectionOverlayTarget
} from './selectionTargets'
import type { useLassoSelection } from './useLassoSelection'
import type { usePendingNodePressSelection } from './usePendingNodePressSelection'
import type { useSelectionMove } from './useSelectionMove'

type RightContextGesture = {
  pointerId: number
  startClientX: number
  startClientY: number
}

type SelectionClientBounds = {
  left: number
  right: number
  top: number
  bottom: number
}

type SelectionCanvasEventOptions = {
  closeContextMenu: () => void
  getSelectedClientBounds: () => SelectionClientBounds | null
  getSelectedNodeIds: () => string[]
  isPointInsideSelectedBounds: (event: PointerEvent) => boolean
  lassoSelection: Pick<ReturnType<typeof useLassoSelection>, 'beginLassoSelection'>
  pendingNodePressSelection: Pick<
    ReturnType<typeof usePendingNodePressSelection>,
    'beginPendingNodePressSelection' | 'cancelPendingNodePressSelection'
  >
  selectionMove: Pick<
    ReturnType<typeof useSelectionMove>,
    'beginNodePointerMove' | 'handleSelectedBoundsPointerDown'
  >
  setSelectedNodesImmediate: (nodeIds: string[]) => void
}

const rightContextDragThreshold = 4

export const createSelectionCanvasEvents = (
  runtime: FlowRuntime,
  services: FlowEditorServices,
  options: SelectionCanvasEventOptions
) => {
  let rightContextGesture: RightContextGesture | null = null
  let hasPendingCursorClientPoint = false
  let pendingCursorClientX = 0
  let pendingCursorClientY = 0
  let cursorCoordinateFrame: number | undefined

  const getCachedFlowCoordinate = (clientX: number, clientY: number) => {
    const bounds = runtime.canvasClientBounds.value
    const viewport = runtime.currentViewport.value

    if (!bounds || bounds.width <= 0 || bounds.height <= 0 || viewport.zoom <= 0) {
      return runtime.screenToFlowCoordinate({ x: clientX, y: clientY })
    }

    return {
      x: (clientX - bounds.left - viewport.x) / viewport.zoom,
      y: (clientY - bounds.top - viewport.y) / viewport.zoom
    }
  }

  const cleanupRightContextGesture = () => {
    window.removeEventListener('pointermove', handleRightContextGestureMove, true)
    window.removeEventListener('pointerup', handleRightContextGestureEnd, true)
    window.removeEventListener('pointercancel', handleRightContextGestureEnd, true)
    rightContextGesture = null
  }

  const handleRightContextGestureMove = (event: PointerEvent) => {
    if (!rightContextGesture || event.pointerId !== rightContextGesture.pointerId) {
      return
    }

    if (
      Math.abs(event.clientX - rightContextGesture.startClientX) > rightContextDragThreshold ||
      Math.abs(event.clientY - rightContextGesture.startClientY) > rightContextDragThreshold
    ) {
      runtime.interaction.suppressNextContextMenu = true
    }
  }

  const handleRightContextGestureEnd = (event: PointerEvent) => {
    if (rightContextGesture && event.pointerId !== rightContextGesture.pointerId) {
      return
    }

    cleanupRightContextGesture()
  }

  const beginRightContextGesture = (event: PointerEvent) => {
    if (!runtime.isLoggedIn.value || event.button !== 2) {
      return false
    }

    cleanupRightContextGesture()
    runtime.interaction.suppressNextContextMenu = false
    rightContextGesture = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY
    }
    window.addEventListener('pointermove', handleRightContextGestureMove, { capture: true })
    window.addEventListener('pointerup', handleRightContextGestureEnd, { capture: true })
    window.addEventListener('pointercancel', handleRightContextGestureEnd, { capture: true })

    return true
  }

  const handleCanvasPointerDown = (event: PointerEvent) => {
    if (beginRightContextGesture(event)) {
      return
    }

    const activeElement = document.activeElement
    const targetIsEditor =
      event.target instanceof Element && Boolean(event.target.closest('input, textarea'))

    if (
      !targetIsEditor &&
      (activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement)
    ) {
      activeElement.blur()
    }

    if (!runtime.isLoggedIn.value || runtime.pendingCreate.value || event.button !== 0) {
      return
    }

    const selectedIds = options.getSelectedNodeIds()
    const isResizeTarget =
      event.target instanceof Element && Boolean(event.target.closest('.vue-flow__resize-control'))

    if (isResizeTarget) {
      runtime.isResizingNode.value = true
      runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350
      return
    }

    const selectedNodeElement = getNodeElementFromTarget(event.target)

    if (selectedNodeElement?.dataset.id) {
      const nodeId = selectedNodeElement.dataset.id
      const shouldMoveSelection = selectedIds.length > 1 && selectedIds.includes(nodeId)

      if (isNodeMoveBlockedTarget(event.target)) {
        return
      }

      const shouldDeferSelection =
        !shouldMoveSelection &&
        !selectedIds.includes(nodeId) &&
        (
          selectedNodeElement.classList.contains('vue-flow__node-item') ||
          selectedNodeElement.classList.contains('vue-flow__node-section')
        )
      let pendingSelectionNodeId: string | undefined

      if (shouldDeferSelection) {
        options.pendingNodePressSelection.beginPendingNodePressSelection(
          nodeId,
          selectedIds,
          selectedNodeElement
        )
        pendingSelectionNodeId = nodeId
      } else if (!shouldMoveSelection) {
        options.setSelectedNodesImmediate([nodeId])
      }

      runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350
      options.closeContextMenu()
      const started = options.selectionMove.beginNodePointerMove(event, nodeId, {
        pendingSelectionNodeId
      })
      if (!started && pendingSelectionNodeId) {
        options.pendingNodePressSelection.cancelPendingNodePressSelection(pendingSelectionNodeId)
      }
      return
    }

    const selectedBounds = options.getSelectedClientBounds()

    if (
      selectedIds.length > 1 &&
      selectedBounds &&
      (isCanvasSelectionTarget(event.target) || isSelectionOverlayTarget(event.target)) &&
      event.clientX >= selectedBounds.left &&
      event.clientX <= selectedBounds.right &&
      event.clientY >= selectedBounds.top &&
      event.clientY <= selectedBounds.bottom
    ) {
      options.selectionMove.handleSelectedBoundsPointerDown(event)
      return
    }

    if (!isCanvasSelectionTarget(event.target)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    options.closeContextMenu()
    runtime.interaction.suppressNextContextMenu = false

    const panel = event.currentTarget as HTMLElement
    options.lassoSelection.beginLassoSelection(event, panel)
  }

  const scheduleCoalescedCursorUpdate = (clientX: number, clientY: number) => {
    hasPendingCursorClientPoint = true
    pendingCursorClientX = clientX
    pendingCursorClientY = clientY

    if (cursorCoordinateFrame) {
      return
    }

    cursorCoordinateFrame = window.requestAnimationFrame(() => {
      cursorCoordinateFrame = undefined
      const shouldUpdateCursor = hasPendingCursorClientPoint
      const nextClientX = pendingCursorClientX
      const nextClientY = pendingCursorClientY
      hasPendingCursorClientPoint = false

      if (!shouldUpdateCursor || !runtime.isLoggedIn.value) {
        return
      }

      services.scheduleCursorUpdate(getCachedFlowCoordinate(nextClientX, nextClientY))
    })
  }

  const handleCanvasPointerMove = (event: PointerEvent) => {
    if (!runtime.isLoggedIn.value) {
      return
    }

    const shouldCheckSelectionBounds =
      runtime.selectedNodeIds.value.size > 1 &&
      !runtime.interaction.selectionMoveDrag &&
      isCanvasSelectionTarget(event.target)
    const nextIsHoveringSelection =
      shouldCheckSelectionBounds && options.isPointInsideSelectedBounds(event)

    if (runtime.isHoveringSelection.value !== nextIsHoveringSelection) {
      runtime.isHoveringSelection.value = nextIsHoveringSelection
    }

    scheduleCoalescedCursorUpdate(event.clientX, event.clientY)
  }

  const handleCanvasPointerLeave = () => {
    if (runtime.isHoveringSelection.value) {
      runtime.isHoveringSelection.value = false
    }
  }

  const cleanup = () => {
    cleanupRightContextGesture()
    if (cursorCoordinateFrame) {
      window.cancelAnimationFrame(cursorCoordinateFrame)
      cursorCoordinateFrame = undefined
    }
    hasPendingCursorClientPoint = false
  }

  return {
    cleanup,
    handleCanvasPointerDown,
    handleCanvasPointerLeave,
    handleCanvasPointerMove
  }
}
