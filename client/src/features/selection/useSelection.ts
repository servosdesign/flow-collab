import type {
  EdgeMouseEvent,
  NodeChange,
  NodeDragEvent,
  NodeMouseEvent
} from '@vue-flow/core'
import { nextTick } from 'vue'
import type { JsonOp } from 'sharedb/lib/client'
import {
  createGraphCache,
  withDefaultEdges,
  type FlowEdge
} from '../../domain/graph'
import type { FlowEditorServices } from '../../app/flowEditorServices'
import type { FlowRuntime } from '../../flowRuntime'
import { getNodeElementFromTarget } from './selectionDom'
import { useLassoSelection } from './useLassoSelection'
import { usePendingNodePressSelection } from './usePendingNodePressSelection'
import { useSelectionMove } from './useSelectionMove'
import { useSelectionOverlayModel } from './useSelectionOverlayModel'
import { useSelectionState } from './useSelectionState'

type RightContextGesture = {
  pointerId: number
  startClientX: number
  startClientY: number
}

const nodeInteractiveSelector =
  'input, textarea, button, label, select, [contenteditable], [data-node-interactive]'
const nodeMoveBlockedSelector =
  `${nodeInteractiveSelector}, .vue-flow__handle, .vue-flow__resize-control, .node-resizer-layer`
const rightContextDragThreshold = 4

export const useSelection = (runtime: FlowRuntime, services: FlowEditorServices) => {
  let rightContextGesture: RightContextGesture | null = null
  let hasPendingCursorClientPoint = false
  let pendingCursorClientX = 0
  let pendingCursorClientY = 0
  let cursorCoordinateFrame: number | undefined

  const selectionOverlay = useSelectionOverlayModel(runtime, services)
  const {
    getSelectedClientBounds,
    isPointInsideSelectedBounds,
    isSingleNodeSelection,
    selectedNodeOutlineRects,
    selectedBoundsStyle
  } = selectionOverlay

  const selectionState = useSelectionState(runtime, services)
  const {
    clearNodeSelection,
    cleanupSelectionState,
    getSelectedNodeIds,
    isNodeSelected,
    isNodeVisuallySelected,
    selectOnlyNode,
    setSelectedNodes
  } = selectionState

  const pendingNodePressSelection = usePendingNodePressSelection(runtime, setSelectedNodes)
  const {
    beginPendingNodePressSelection,
    cancelPendingNodePressSelection,
    clearPendingNodePressSelection,
    commitPendingNodePressSelection
  } = pendingNodePressSelection

  const setSelectedNodesImmediate = (nodeIds: string[]) => {
    clearPendingNodePressSelection()
    setSelectedNodes(nodeIds)
  }

  const clearNodeSelectionImmediate = () => {
    clearPendingNodePressSelection()
    clearNodeSelection()
  }

  const getCurrentSyncNodes = () => {
    return services.getCurrentSyncNodes()
  }

  const submitOperation = (operation: JsonOp[]) => {
    services.submitOperation(operation)
  }

  const scheduleSelectionBoundsRefresh = () => {
    services.scheduleSelectionBoundsRefresh()
  }

  const closeContextMenu = () => {
    services.closeContextMenu()
  }

  const lassoSelection = useLassoSelection(runtime, {
    getCurrentSyncNodes,
    setSelectedNodesImmediate
  })

  const selectionMove = useSelectionMove(runtime, services, {
    getSelectedNodeIds,
    commitPendingNodeSelection: commitPendingNodePressSelection,
    cancelPendingNodeSelection: cancelPendingNodePressSelection
  })

  const isNodeInteractiveTarget = (target: EventTarget | null) => {
    return target instanceof Element && Boolean(target.closest(nodeInteractiveSelector))
  }

  const isNodeMoveBlockedTarget = (target: EventTarget | null) => {
    return target instanceof Element && Boolean(target.closest(nodeMoveBlockedSelector))
  }

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

  const handleNodeClick = (payload: NodeMouseEvent) => {
    if (!runtime.isLoggedIn.value) {
      return
    }

    if (isNodeInteractiveTarget(payload.event.target)) {
      return
    }

    if (Date.now() < runtime.interaction.ignoreVueFlowSelectionUntil) {
      if (payload.event instanceof MouseEvent) {
        payload.event.stopPropagation()
      }

      return
    }

    const selectedIds = getSelectedNodeIds()

    if (selectedIds.length > 1 && selectedIds.includes(payload.node.id)) {
      if (payload.event instanceof MouseEvent) {
        payload.event.stopPropagation()
      }

      runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350
      setSelectedNodesImmediate(selectedIds)
      return
    }

    setSelectedNodesImmediate([payload.node.id])
  }

  const handleEdgeClick = (payload: EdgeMouseEvent) => {
    if (!runtime.isLoggedIn.value) {
      return
    }

    clearNodeSelectionImmediate()
    runtime.edges.value = runtime.edges.value.map((edge) => ({
      ...edge,
      selected: edge.id === payload.edge.id
    })) as unknown as FlowEdge[]
  }

  const handleNodeDragStart = (payload: NodeDragEvent) => {
    if (!runtime.isLoggedIn.value) {
      return
    }

    const selectedIds = getSelectedNodeIds()

    if (selectedIds.length > 1 && selectedIds.includes(payload.node.id)) {
      runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350
      selectionMove.handleSectionNodeDragStart(payload.node.id)
      return
    }

    setSelectedNodesImmediate([payload.node.id])
    runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350
    selectionMove.handleSectionNodeDragStart(payload.node.id)
  }

  const handleNodeDragStop = () => {
    selectionMove.clearSectionNodeDragPreview()
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

    const selectedNodeIds = getSelectedNodeIds()
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
        createGraphCache(getCurrentSyncNodes(), nextEdges)
      )
      submitOperation([
        {
          p: ['edges'],
          od: flowDocumentValue.data.edges,
          oi: nextEdges
        }
      ])
    }
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') {
      return
    }

    deleteSelectedElements()
  }

  const handleNodesChange = (changes: NodeChange[]) => {
    if (
      !runtime.interaction.selectionMoveDrag &&
      changes.some((change) => change.type === 'dimensions' || change.type === 'position')
    ) {
      nextTick(() => {
        scheduleSelectionBoundsRefresh()
      })
    }

    if (changes.some((change) => change.type === 'select')) {
      if (
        runtime.rightSelection.value ||
        runtime.isLassoSelecting.value ||
        runtime.interaction.suppressNextContextMenu ||
        Date.now() < runtime.interaction.ignoreVueFlowSelectionUntil
      ) {
        return
      }

      nextTick(() => {
        scheduleSelectionBoundsRefresh()
        services.updatePresenceSelection()
      })
    }
  }

  const isCanvasSelectionTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) {
      return false
    }

    return !target.closest(
      '.vue-flow__node, .vue-flow__edge, .vue-flow__minimap, .vue-flow__resize-control, .selected-nodes-outline, .selected-bounds-hit, .context-menu, input, textarea, button, label'
    )
  }

  const isSelectionOverlayTarget = (target: EventTarget | null) => {
    return target instanceof Element && Boolean(target.closest('.selected-nodes-outline'))
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

    const selectedIds = getSelectedNodeIds()
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
        beginPendingNodePressSelection(nodeId, selectedIds, selectedNodeElement)
        pendingSelectionNodeId = nodeId
      } else if (!shouldMoveSelection) {
        setSelectedNodesImmediate([nodeId])
      }

      runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350
      closeContextMenu()
      const started = selectionMove.beginNodePointerMove(event, nodeId, {
        pendingSelectionNodeId
      })
      if (!started && pendingSelectionNodeId) {
        cancelPendingNodePressSelection(pendingSelectionNodeId)
      }
      return
    }

    const selectedBounds = getSelectedClientBounds()

    if (
      selectedIds.length > 1 &&
      selectedBounds &&
      (isCanvasSelectionTarget(event.target) || isSelectionOverlayTarget(event.target)) &&
      event.clientX >= selectedBounds.left &&
      event.clientX <= selectedBounds.right &&
      event.clientY >= selectedBounds.top &&
      event.clientY <= selectedBounds.bottom
    ) {
      selectionMove.handleSelectedBoundsPointerDown(event)
      return
    }

    if (!isCanvasSelectionTarget(event.target)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    closeContextMenu()
    runtime.interaction.suppressNextContextMenu = false

    const panel = event.currentTarget as HTMLElement
    lassoSelection.beginLassoSelection(event, panel)
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
      shouldCheckSelectionBounds && isPointInsideSelectedBounds(event)

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

  const cleanupSelection = () => {
    cleanupRightContextGesture()
    selectionMove.cleanupSelectionMove()
    if (cursorCoordinateFrame) {
      window.cancelAnimationFrame(cursorCoordinateFrame)
      cursorCoordinateFrame = undefined
    }
    hasPendingCursorClientPoint = false
    lassoSelection.cleanupLassoSelection()
    clearPendingNodePressSelection()
    cleanupSelectionState()
  }

  return {
    cleanupSelection,
    deleteSelectedElements,
    getSelectedClientBounds,
    getSelectedNodeIds,
    handleCanvasPointerDown,
    handleCanvasPointerLeave,
    handleCanvasPointerMove,
    handleKeyDown,
    handleEdgeClick,
    handleNodeClick,
    handleNodeDragStart,
    handleNodeDragStop,
    handleNodesChange,
    handleSelectionMoveWheel: selectionMove.handleSelectionMoveWheel,
    handleSelectedBoundsPointerDown: selectionMove.handleSelectedBoundsPointerDown,
    isCanvasSelectionTarget,
    isNodeSelected,
    isNodeVisuallySelected,
    isSingleNodeSelection,
    lassoPreviewRects: lassoSelection.lassoPreviewRects,
    selectOnlyNode,
    selectionMovePreview: selectionMove.selectionMovePreview,
    selectedNodeOutlineRects,
    selectedBoundsStyle,
    setSelectedNodes: setSelectedNodesImmediate
  }
}
