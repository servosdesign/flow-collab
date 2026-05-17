import { nextTick } from 'vue'
import type { FlowRuntime } from '../../flowRuntime'
import { getNodeElementById } from './selectionDom'

type PendingNodePressSelection = {
  nodeId: string
  selectedElement: HTMLElement | null
  suppressedElements: HTMLElement[]
  suppressedOutlineElement: HTMLElement | null
}

type SetSelectedNodes = (
  nodeIds: string[],
  options?: { deferEffects?: boolean, afterEffects?: () => void }
) => void

const pendingSelectedClass = 'selection-pending-selected'
const pendingUnselectedClass = 'selection-pending-unselected'

export const usePendingNodePressSelection = (
  runtime: FlowRuntime,
  setSelectedNodes: SetSelectedNodes
) => {
  let pendingNodePressSelection: PendingNodePressSelection | null = null

  const clearPendingNodePressSelection = () => {
    const pending = pendingNodePressSelection

    if (!pending) {
      return
    }

    pending.selectedElement?.classList.remove(pendingSelectedClass)
    pending.suppressedElements.forEach((element) => {
      element.classList.remove(pendingUnselectedClass)
    })
    pending.suppressedOutlineElement?.classList.remove(pendingUnselectedClass)
    pendingNodePressSelection = null
  }

  const beginPendingNodePressSelection = (
    nodeId: string,
    selectedIds: string[],
    selectedElement: HTMLElement
  ) => {
    clearPendingNodePressSelection()

    const suppressedElements = selectedIds
      .filter((selectedId) => selectedId !== nodeId)
      .map((selectedId) => getNodeElementById(runtime, selectedId))
      .filter((element): element is HTMLElement => Boolean(element))
    const suppressedOutlineElement = selectedIds.length > 1
      ? runtime.canvasPanel.value?.querySelector<HTMLElement>('.selected-nodes-outline') ?? null
      : null

    selectedElement.classList.add(pendingSelectedClass)
    suppressedElements.forEach((element) => {
      element.classList.add(pendingUnselectedClass)
    })
    suppressedOutlineElement?.classList.add(pendingUnselectedClass)

    pendingNodePressSelection = {
      nodeId,
      selectedElement,
      suppressedElements,
      suppressedOutlineElement
    }
  }

  const commitPendingNodePressSelection = (nodeId: string, reason: 'click' | 'drop') => {
    const pending = pendingNodePressSelection

    if (!pending || pending.nodeId !== nodeId) {
      return
    }

    const clearCommittedPendingSelection = () => {
      if (pendingNodePressSelection !== pending) {
        return
      }

      clearPendingNodePressSelection()
    }

    if (reason === 'drop') {
      setSelectedNodes([nodeId], {
        deferEffects: true,
        afterEffects: clearCommittedPendingSelection
      })
      return
    }

    setSelectedNodes([nodeId])
    nextTick(clearCommittedPendingSelection)
  }

  const cancelPendingNodePressSelection = (nodeId: string) => {
    if (pendingNodePressSelection?.nodeId === nodeId) {
      clearPendingNodePressSelection()
    }
  }

  return {
    beginPendingNodePressSelection,
    cancelPendingNodePressSelection,
    clearPendingNodePressSelection,
    commitPendingNodePressSelection
  }
}
