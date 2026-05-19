import type {
  NodeChange,
  NodeDragEvent,
  NodeMouseEvent
} from '@vue-flow/core'
import { nextTick } from 'vue'
import type { FlowEditorServices } from '../../app/flowEditorServices'
import type { FlowRuntime } from '../../flowRuntime'
import type { useSelectionMove } from './useSelectionMove'
import { isNodeInteractiveTarget } from './selectionTargets'

type SelectionNodeEventOptions = {
  deleteSelectedElements: () => void
  getSelectedNodeIds: () => string[]
  scheduleSelectionBoundsRefresh: () => void
  selectionMove: Pick<
    ReturnType<typeof useSelectionMove>,
    'clearSectionNodeDragPreview' | 'handleSectionNodeDragStart'
  >
  setSelectedNodesImmediate: (nodeIds: string[]) => void
}

export const createSelectionNodeEvents = (
  runtime: FlowRuntime,
  services: FlowEditorServices,
  options: SelectionNodeEventOptions
) => {
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

    const selectedIds = options.getSelectedNodeIds()

    if (selectedIds.length > 1 && selectedIds.includes(payload.node.id)) {
      if (payload.event instanceof MouseEvent) {
        payload.event.stopPropagation()
      }

      runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350
      options.setSelectedNodesImmediate(selectedIds)
      return
    }

    options.setSelectedNodesImmediate([payload.node.id])
  }

  const handleNodeDragStart = (payload: NodeDragEvent) => {
    if (!runtime.isLoggedIn.value) {
      return
    }

    const selectedIds = options.getSelectedNodeIds()

    if (selectedIds.length > 1 && selectedIds.includes(payload.node.id)) {
      runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350
      options.selectionMove.handleSectionNodeDragStart(payload.node.id)
      return
    }

    options.setSelectedNodesImmediate([payload.node.id])
    runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350
    options.selectionMove.handleSectionNodeDragStart(payload.node.id)
  }

  const handleNodeDragStop = () => {
    options.selectionMove.clearSectionNodeDragPreview()
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') {
      return
    }

    options.deleteSelectedElements()
  }

  const handleNodesChange = (changes: NodeChange[]) => {
    if (
      !runtime.interaction.selectionMoveDrag &&
      changes.some((change) => change.type === 'dimensions' || change.type === 'position')
    ) {
      nextTick(() => {
        options.scheduleSelectionBoundsRefresh()
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
        options.scheduleSelectionBoundsRefresh()
        services.updatePresenceSelection()
      })
    }
  }

  return {
    handleKeyDown,
    handleNodeClick,
    handleNodeDragStart,
    handleNodeDragStop,
    handleNodesChange
  }
}
