import type { FlowEdge } from '../../../domain/graph'
import type { FlowRuntime } from '../../../flowRuntime'
import type { SelectionMoveDrag } from '../../../flowTypes'
import {
  hideSelectedNodesDuringBundleMove,
  selectionDragHiddenEdgeClass,
  selectionDragHiddenNodeClass
} from './constants'
import { getEdgeElementById, getNodeElementById } from '../selectionDom'
import type {
  HiddenElementClassSnapshot,
  RuntimePositionedFlowNode,
  SelectionMoveDeltaGetter,
  VisibleDragElementSnapshot
} from './types'

export const createSelectionMovePresentation = (
  runtime: FlowRuntime,
  getSelectionMoveDelta: SelectionMoveDeltaGetter
) => {
  let selectionMovePreviewElement: HTMLElement | null = null
  let selectionMoveHiddenNodeIds = new Set<string>()
  let selectionMoveHiddenEdgeIds = new Set<string>()
  let visibleDragElementSnapshots = new Map<string, VisibleDragElementSnapshot>()
  let hiddenNodeClassSnapshots = new Map<string, HiddenElementClassSnapshot>()
  let hiddenEdgeClassSnapshots = new Map<string, HiddenElementClassSnapshot>()

  const getSelectionMovePreviewElement = () => {
    return selectionMovePreviewElement
  }

  const setSelectionMovePreviewElement = (element: HTMLElement | null) => {
    selectionMovePreviewElement = element

    if (selectionMovePreviewElement) {
      selectionMovePreviewElement.style.willChange = 'transform'
    }
  }

  const syncSelectionMoveHiddenRefs = () => {
    runtime.selectionMoveHiddenNodeIds.value = new Set(selectionMoveHiddenNodeIds)
    runtime.selectionMoveHiddenEdgeIds.value = new Set(selectionMoveHiddenEdgeIds)
  }

  const clearHiddenClassSnapshots = () => {
    hiddenNodeClassSnapshots.forEach((snapshot) => {
      if (snapshot.element.isConnected && !snapshot.hadClass) {
        snapshot.element.classList.remove(selectionDragHiddenNodeClass)
      }
    })
    hiddenEdgeClassSnapshots.forEach((snapshot) => {
      if (snapshot.element.isConnected && !snapshot.hadClass) {
        snapshot.element.classList.remove(selectionDragHiddenEdgeClass)
      }
    })
    hiddenNodeClassSnapshots = new Map()
    hiddenEdgeClassSnapshots = new Map()
  }

  const applyHiddenClassSnapshots = (
    ids: Set<string>,
    className: string,
    getElementById: (id: string) => HTMLElement | null
  ) => {
    const snapshots = new Map<string, HiddenElementClassSnapshot>()

    ids.forEach((id) => {
      const element = getElementById(id)

      if (!element) {
        return
      }

      const hadClass = element.classList.contains(className)

      if (!hadClass) {
        element.classList.add(className)
      }

      snapshots.set(id, { id, element, hadClass })
    })

    return snapshots
  }

  const clearSelectionMoveHiddenIds = () => {
    if (
      selectionMoveHiddenNodeIds.size === 0 &&
      selectionMoveHiddenEdgeIds.size === 0 &&
      hiddenNodeClassSnapshots.size === 0 &&
      hiddenEdgeClassSnapshots.size === 0
    ) {
      return
    }

    clearHiddenClassSnapshots()
    selectionMoveHiddenNodeIds = new Set()
    selectionMoveHiddenEdgeIds = new Set()
    syncSelectionMoveHiddenRefs()
  }

  const getSelectionMoveInternalEdgeIds = (hiddenIds: Set<string>) => {
    const nextHiddenEdgeIds = new Set<string>()

    if (hiddenIds.size >= 2) {
      for (const edge of runtime.edges.value as FlowEdge[]) {
        if (hiddenIds.has(edge.source) && hiddenIds.has(edge.target)) {
          nextHiddenEdgeIds.add(edge.id)
        }
      }
    }

    return nextHiddenEdgeIds
  }

  const hideSelectionMoveIds = (hiddenIds: Set<string>) => {
    clearHiddenClassSnapshots()
    selectionMoveHiddenNodeIds = new Set(hiddenIds)
    selectionMoveHiddenEdgeIds = getSelectionMoveInternalEdgeIds(hiddenIds)
    hiddenNodeClassSnapshots = applyHiddenClassSnapshots(
      selectionMoveHiddenNodeIds,
      selectionDragHiddenNodeClass,
      (nodeId) => getNodeElementById(runtime, nodeId)
    )
    hiddenEdgeClassSnapshots = applyHiddenClassSnapshots(
      selectionMoveHiddenEdgeIds,
      selectionDragHiddenEdgeClass,
      (edgeId) => getEdgeElementById(runtime, edgeId)
    )
    syncSelectionMoveHiddenRefs()
  }

  const hideBundleSelectionNodes = (selectionMoveDrag: SelectionMoveDrag) => {
    if (
      !hideSelectedNodesDuringBundleMove ||
      selectionMoveDrag.mode !== 'bundle' ||
      selectionMoveDrag.presentationStrategy === 'origin-mask'
    ) {
      clearSelectionMoveHiddenIds()
      return
    }

    hideSelectionMoveIds(selectionMoveDrag.hiddenIds)
  }

  const clearVisibleDragElementSnapshots = (restoreTransforms = true) => {
    if (visibleDragElementSnapshots.size === 0) {
      return
    }

    visibleDragElementSnapshots.forEach((snapshot) => {
      if (!snapshot.element.isConnected) {
        return
      }

      if (restoreTransforms) {
        snapshot.element.style.transform = snapshot.transform
      }

      snapshot.element.style.willChange = snapshot.willChange
      snapshot.element.style.zIndex = snapshot.zIndex
      snapshot.element.style.pointerEvents = snapshot.pointerEvents
    })

    visibleDragElementSnapshots = new Map()
  }

  const beginVisibleDragPreview = (selectionMoveDrag: SelectionMoveDrag) => {
    clearVisibleDragElementSnapshots()

    if (selectionMoveDrag.mode !== 'visible') {
      return
    }

    const nextSnapshots = new Map<string, VisibleDragElementSnapshot>()

    selectionMoveDrag.hiddenIds.forEach((nodeId) => {
      const element = getNodeElementById(runtime, nodeId)

      if (!element) {
        return
      }

      nextSnapshots.set(nodeId, {
        id: nodeId,
        element,
        transform: element.style.transform,
        willChange: element.style.willChange,
        zIndex: element.style.zIndex,
        pointerEvents: element.style.pointerEvents
      })

      element.style.willChange = 'transform'
      element.style.pointerEvents = 'none'

      const node = runtime.findNode(nodeId) as RuntimePositionedFlowNode | undefined
      if (node?.type !== 'section') {
        element.style.zIndex = '20'
      }
    })

    visibleDragElementSnapshots = nextSnapshots

    if (visibleDragElementSnapshots.size !== selectionMoveDrag.hiddenIds.size) {
      clearVisibleDragElementSnapshots()
    }
  }

  const markSelectionMovePreviewPainted = (selectionMoveDrag: SelectionMoveDrag) => {
    selectionMoveDrag.lastPaintedClientX = selectionMoveDrag.currentClientX
    selectionMoveDrag.lastPaintedClientY = selectionMoveDrag.currentClientY
    selectionMoveDrag.lastPaintedGraphDelta = { ...selectionMoveDrag.currentGraphDelta }
    selectionMoveDrag.hasPaintedPreview = true
  }

  const paintVisibleDragPreview = (selectionMoveDrag: SelectionMoveDrag) => {
    if (selectionMoveDrag.mode !== 'visible' || visibleDragElementSnapshots.size === 0) {
      return
    }

    const delta = getSelectionMoveDelta(selectionMoveDrag)
    const previewTransform = `translate3d(${delta.x}px, ${delta.y}px, 0)`

    visibleDragElementSnapshots.forEach((snapshot) => {
      if (!snapshot.element.isConnected) {
        return
      }

      snapshot.element.style.transform = snapshot.transform
        ? `${snapshot.transform} ${previewTransform}`
        : previewTransform
    })
    markSelectionMovePreviewPainted(selectionMoveDrag)
  }

  const paintSelectionMovePreview = (selectionMoveDrag: SelectionMoveDrag) => {
    const element = selectionMovePreviewElement
    const viewport = runtime.currentViewport.value
    const delta = getSelectionMoveDelta(selectionMoveDrag)
    const deltaX = delta.x * viewport.zoom
    const deltaY = delta.y * viewport.zoom

    if (element) {
      element.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`
    }
  }

  const clearSelectionMovePreview = (restoreVisibleDragTransforms = true) => {
    if (selectionMovePreviewElement) {
      selectionMovePreviewElement.style.transform = ''
      selectionMovePreviewElement.style.willChange = ''
    }

    selectionMovePreviewElement = null
    clearVisibleDragElementSnapshots(restoreVisibleDragTransforms)
    clearSelectionMoveHiddenIds()
  }

  const hasTransformOnlyVisiblePreview = (selectionMoveDrag: SelectionMoveDrag) => {
    return selectionMoveDrag.mode === 'visible' && visibleDragElementSnapshots.size > 0
  }

  const hasVisibleDragElementSnapshots = () => {
    return visibleDragElementSnapshots.size > 0
  }

  return {
    beginVisibleDragPreview,
    clearSelectionMoveHiddenIds,
    clearSelectionMovePreview,
    getSelectionMovePreviewElement,
    hasTransformOnlyVisiblePreview,
    hasVisibleDragElementSnapshots,
    hideBundleSelectionNodes,
    hideSelectionMoveIds,
    paintSelectionMovePreview,
    paintVisibleDragPreview,
    setSelectionMovePreviewElement
  }
}
