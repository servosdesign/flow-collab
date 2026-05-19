import type { FlowEditorServices } from '../../app/flowEditorServices'
import type { FlowRuntime } from '../../flowRuntime'
import { createSelectionCanvasEvents } from './selectionCanvasEvents'
import { createSelectionCommands } from './selectionCommands'
import { createSelectionNodeEvents } from './selectionNodeEvents'
import { isCanvasSelectionTarget } from './selectionTargets'
import { useLassoSelection } from './useLassoSelection'
import { usePendingNodePressSelection } from './usePendingNodePressSelection'
import { useSelectionMove } from './useSelectionMove'
import { useSelectionOverlayModel } from './useSelectionOverlayModel'
import { useSelectionState } from './useSelectionState'

export const useSelection = (runtime: FlowRuntime, services: FlowEditorServices) => {
  const selectionOverlay = useSelectionOverlayModel(runtime, services)
  const {
    getCurrentSelectionOverlayGeometrySnapshot,
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

  const lassoSelection = useLassoSelection(runtime, {
    getCurrentSyncNodes: () => services.getCurrentSyncNodes(),
    setSelectedNodesImmediate
  })

  const selectionMove = useSelectionMove(runtime, services, {
    getSelectedNodeIds,
    getCurrentSelectionOverlayGeometrySnapshot,
    commitPendingNodeSelection: commitPendingNodePressSelection,
    cancelPendingNodeSelection: cancelPendingNodePressSelection
  })

  const commands = createSelectionCommands(runtime, services, {
    clearNodeSelectionImmediate,
    getSelectedNodeIds
  })

  const nodeEvents = createSelectionNodeEvents(runtime, services, {
    deleteSelectedElements: commands.deleteSelectedElements,
    getSelectedNodeIds,
    scheduleSelectionBoundsRefresh: () => services.scheduleSelectionBoundsRefresh(),
    selectionMove,
    setSelectedNodesImmediate
  })

  const canvasEvents = createSelectionCanvasEvents(runtime, services, {
    closeContextMenu: () => services.closeContextMenu(),
    getSelectedClientBounds,
    getSelectedNodeIds,
    isPointInsideSelectedBounds,
    lassoSelection,
    pendingNodePressSelection,
    selectionMove,
    setSelectedNodesImmediate
  })

  const cleanupSelection = () => {
    canvasEvents.cleanup()
    selectionMove.cleanupSelectionMove()
    lassoSelection.cleanupLassoSelection()
    clearPendingNodePressSelection()
    cleanupSelectionState()
  }

  return {
    commands: {
      deleteSelectedElements: commands.deleteSelectedElements,
      selectOnlyEdge: commands.selectOnlyEdge,
      selectOnlyNode,
      setSelectedNodes: setSelectedNodesImmediate
    },
    events: {
      handleCanvasPointerDown: canvasEvents.handleCanvasPointerDown,
      handleCanvasPointerLeave: canvasEvents.handleCanvasPointerLeave,
      handleCanvasPointerMove: canvasEvents.handleCanvasPointerMove,
      handleKeyDown: nodeEvents.handleKeyDown,
      handleNodeClick: nodeEvents.handleNodeClick,
      handleNodeDragStart: nodeEvents.handleNodeDragStart,
      handleNodeDragStop: nodeEvents.handleNodeDragStop,
      handleNodesChange: nodeEvents.handleNodesChange,
      handleSelectionMoveWheel: selectionMove.handleSelectionMoveWheel,
      handleSelectedBoundsPointerDown: selectionMove.handleSelectedBoundsPointerDown
    },
    lifecycle: {
      cleanup: cleanupSelection
    },
    overlay: {
      lassoPreviewRects: lassoSelection.lassoPreviewRects,
      selectionMovePreview: selectionMove.selectionMovePreview,
      selectedNodeOutlineRects,
      selectedBoundsStyle
    },
    queries: {
      getSelectedClientBounds,
      getSelectedNodeIds,
      isCanvasSelectionTarget,
      isNodeSelected,
      isNodeVisuallySelected,
      isSingleNodeSelection
    }
  }
}
