import type { SyncNode } from '@vue-flow-sync/shared'
import { computed } from 'vue'
import {
  createGraphCache,
  getNodeBounds
} from '../../domain/graph'
import type { FlowRuntime } from '../../flowRuntime'
import type {
  SelectionOverlayFlowBounds,
  SelectionOverlayGeometry,
  SelectionOverlayFlowRect
} from '../../flowTypes'
import {
  createSelectionOverlayGeometrySnapshot,
  emptySelectionGeometry,
  getRenderedOutlineBounds
} from './selectionOverlayGeometry'
import { areSelectionIdsEqual } from './useSelectionState'

type LassoNodeBounds = {
  id: string
  isSection: boolean
  bounds: SelectionOverlayFlowBounds
  renderedBounds: SelectionOverlayFlowBounds
}

type LassoPointerRect = {
  startClientX: number
  startClientY: number
  currentClientX: number
  currentClientY: number
}

type UseLassoSelectionOptions = {
  getCurrentSyncNodes: () => SyncNode[]
  setSelectedNodesImmediate: (nodeIds: string[]) => void
}

export const useLassoSelection = (
  runtime: FlowRuntime,
  options: UseLassoSelectionOptions
) => {
  let lassoBoundsCache: LassoNodeBounds[] = []
  let lassoBoundsCacheReady = false
  let pendingLassoRect: LassoPointerRect | null = null
  let lassoPanelOrigin = { left: 0, top: 0 }
  let lassoPointerCaptureTarget: HTMLElement | null = null
  let lassoSelectionBox: HTMLDivElement | null = null

  const lassoPreviewRects = computed(() => {
    if (!runtime.isLassoSelecting.value || runtime.lassoPreviewNodeIds.value.size === 0) {
      return []
    }

    const viewport = runtime.currentViewport.value
    const previewIds = runtime.lassoPreviewNodeIds.value
    const rects: Array<{ id: string, style: Record<string, string> }> = []

    for (const cachedBounds of lassoBoundsCache) {
      if (!previewIds.has(cachedBounds.id)) {
        continue
      }

      const bounds = cachedBounds.renderedBounds
      rects.push({
        id: cachedBounds.id,
        style: {
          left: `${bounds.x * viewport.zoom + viewport.x}px`,
          top: `${bounds.y * viewport.zoom + viewport.y}px`,
          width: `${bounds.width * viewport.zoom}px`,
          height: `${bounds.height * viewport.zoom}px`
        }
      })
    }

    return rects
  })

  const setLassoPreviewNodes = (nodeIds: string[]) => {
    if (areSelectionIdsEqual(runtime.lassoPreviewNodeIds.value, nodeIds)) {
      return
    }

    runtime.lassoPreviewNodeIds.value = new Set(nodeIds)
  }

  const ensureLassoSelectionBox = () => {
    if (lassoSelectionBox) {
      return lassoSelectionBox
    }

    lassoSelectionBox = document.createElement('div')
    lassoSelectionBox.className = 'right-drag-selection'
    document.body.appendChild(lassoSelectionBox)

    return lassoSelectionBox
  }

  const paintLassoSelectionBox = (selection: NonNullable<typeof runtime.rightSelection.value>) => {
    const element = ensureLassoSelectionBox()

    const left = Math.min(selection.startClientX, selection.currentClientX)
    const top = Math.min(selection.startClientY, selection.currentClientY)
    const width = Math.abs(selection.currentClientX - selection.startClientX)
    const height = Math.abs(selection.currentClientY - selection.startClientY)

    element.style.display = 'block'
    element.style.transform = `translate3d(${left}px, ${top}px, 0)`
    element.style.width = `${width}px`
    element.style.height = `${height}px`
  }

  const resetLassoSelectionBox = () => {
    const element = lassoSelectionBox

    if (!element) {
      return
    }

    element.style.display = 'none'
    element.style.transform = 'translate3d(0, 0, 0)'
    element.style.width = '0px'
    element.style.height = '0px'
  }

  const removeLassoSelectionBox = () => {
    lassoSelectionBox?.remove()
    lassoSelectionBox = null
  }

  const rebuildLassoBoundsCache = () => {
    const graphNodes = options.getCurrentSyncNodes()
    const graph = createGraphCache(graphNodes)

    lassoBoundsCache = graphNodes.map((node) => {
      const bounds = getNodeBounds(node, graph)

      return {
        id: node.id,
        isSection: node.type === 'section',
        bounds,
        renderedBounds: getRenderedOutlineBounds(node, bounds)
      }
    })
    lassoBoundsCacheReady = true
  }

  const ensureLassoBoundsCache = () => {
    if (!lassoBoundsCacheReady) {
      rebuildLassoBoundsCache()
    }
  }

  const hasGraphBoundsOverlap = (
    nodeBounds: SelectionOverlayFlowBounds,
    selectionBounds: { x: number, y: number, width: number, height: number }
  ) => {
    return (
      Math.min(nodeBounds.x + nodeBounds.width, selectionBounds.x + selectionBounds.width) >
        Math.max(nodeBounds.x, selectionBounds.x) &&
      Math.min(nodeBounds.y + nodeBounds.height, selectionBounds.y + selectionBounds.height) >
        Math.max(nodeBounds.y, selectionBounds.y)
    )
  }

  const getFlowSelectionBounds = (rect: LassoPointerRect) => {
    const viewport = runtime.currentViewport.value
    const localLeft = Math.min(rect.startClientX, rect.currentClientX) - lassoPanelOrigin.left
    const localTop = Math.min(rect.startClientY, rect.currentClientY) - lassoPanelOrigin.top
    const localRight = Math.max(rect.startClientX, rect.currentClientX) - lassoPanelOrigin.left
    const localBottom = Math.max(rect.startClientY, rect.currentClientY) - lassoPanelOrigin.top

    return {
      x: (localLeft - viewport.x) / viewport.zoom,
      y: (localTop - viewport.y) / viewport.zoom,
      width: (localRight - localLeft) / viewport.zoom,
      height: (localBottom - localTop) / viewport.zoom
    }
  }

  const getLassoSelectedIds = (rect: LassoPointerRect) => {
    ensureLassoBoundsCache()

    const selectionBounds = getFlowSelectionBounds(rect)
    const selectedIds: string[] = []

    for (const cachedBounds of lassoBoundsCache) {
      if (hasGraphBoundsOverlap(cachedBounds.renderedBounds, selectionBounds)) {
        selectedIds.push(cachedBounds.id)
      }
    }

    return selectedIds
  }

  const getLassoSelectionOverlayGeometry = (
    selectedIds: Set<string>
  ) : SelectionOverlayGeometry => {
    if (selectedIds.size < 2) {
      return emptySelectionGeometry
    }

    let selectedCount = 0
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    const outlineRects: SelectionOverlayFlowRect[] = []

    for (const cachedBounds of lassoBoundsCache) {
      if (!selectedIds.has(cachedBounds.id)) {
        continue
      }

      const bounds = cachedBounds.bounds
      selectedCount += 1
      minX = Math.min(minX, bounds.x)
      minY = Math.min(minY, bounds.y)
      maxX = Math.max(maxX, bounds.x + bounds.width)
      maxY = Math.max(maxY, bounds.y + bounds.height)

      if (!cachedBounds.isSection) {
        outlineRects.push({
          id: cachedBounds.id,
          bounds: cachedBounds.renderedBounds
        })
      }
    }

    if (selectedCount === 0) {
      return emptySelectionGeometry
    }

    return {
      selectedBounds: {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
      },
      outlineRects
    }
  }

  const seedLassoSelectionOverlayGeometrySnapshot = () => {
    const selectedIds = runtime.lassoPreviewNodeIds.value

    runtime.selectionOverlayGeometrySnapshot.value = createSelectionOverlayGeometrySnapshot(
      selectedIds,
      runtime.selectionBoundsVersion.value,
      getLassoSelectionOverlayGeometry(selectedIds)
    )
  }

  const updateLassoPreview = (rect: LassoPointerRect) => {
    setLassoPreviewNodes(getLassoSelectedIds(rect))
    runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350
  }

  const scheduleLassoPreview = (rect: LassoPointerRect) => {
    pendingLassoRect = rect

    if (runtime.timers.lassoSelectionFrame) {
      return
    }

    runtime.timers.lassoSelectionFrame = window.requestAnimationFrame(() => {
      runtime.timers.lassoSelectionFrame = undefined
      const nextRect = pendingLassoRect
      pendingLassoRect = null

      if (nextRect) {
        updateLassoPreview(nextRect)
      }
    })
  }

  const flushLassoPreview = (fallbackRect: LassoPointerRect) => {
    if (runtime.timers.lassoSelectionFrame) {
      window.cancelAnimationFrame(runtime.timers.lassoSelectionFrame)
      runtime.timers.lassoSelectionFrame = undefined
    }

    const nextRect = pendingLassoRect ?? fallbackRect
    pendingLassoRect = null
    updateLassoPreview(nextRect)
  }

  const clearLassoPreview = (clearOverlaySnapshot = true) => {
    if (runtime.timers.lassoSelectionFrame) {
      window.cancelAnimationFrame(runtime.timers.lassoSelectionFrame)
      runtime.timers.lassoSelectionFrame = undefined
    }

    if (clearOverlaySnapshot) {
      runtime.selectionOverlayGeometrySnapshot.value = null
    }

    pendingLassoRect = null
    lassoBoundsCache = []
    lassoBoundsCacheReady = false
    runtime.isLassoSelecting.value = false
    runtime.lassoPreviewNodeIds.value = new Set()
    resetLassoSelectionBox()
  }

  const handleRightSelectionMove = (event: PointerEvent) => {
    const selection = runtime.rightSelection.value

    if (!selection) {
      return
    }

    event.preventDefault()
    event.stopImmediatePropagation()
    selection.currentClientX = event.clientX
    selection.currentClientY = event.clientY
    selection.currentLocalX = event.clientX - lassoPanelOrigin.left
    selection.currentLocalY = event.clientY - lassoPanelOrigin.top
    paintLassoSelectionBox(selection)

    if (
      Math.abs(selection.currentClientX - selection.startClientX) > 4 ||
      Math.abs(selection.currentClientY - selection.startClientY) > 4
    ) {
      runtime.interaction.suppressNextContextMenu = true
      scheduleLassoPreview({
        startClientX: selection.startClientX,
        startClientY: selection.startClientY,
        currentClientX: selection.currentClientX,
        currentClientY: selection.currentClientY
      })
    }
  }

  const handleRightSelectionEnd = (event: PointerEvent) => {
    window.removeEventListener('pointermove', handleRightSelectionMove, true)

    const selection = runtime.rightSelection.value
    runtime.rightSelection.value = null
    resetLassoSelectionBox()
    if (lassoPointerCaptureTarget?.hasPointerCapture(event.pointerId)) {
      lassoPointerCaptureTarget.releasePointerCapture(event.pointerId)
    }
    lassoPointerCaptureTarget = null

    if (!selection) {
      return
    }

    if (!runtime.interaction.suppressNextContextMenu) {
      clearLassoPreview()
      options.setSelectedNodesImmediate([])
      return
    }

    event.preventDefault()
    event.stopImmediatePropagation()
    flushLassoPreview({
      startClientX: selection.startClientX,
      startClientY: selection.startClientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY
    })
    seedLassoSelectionOverlayGeometrySnapshot()
    options.setSelectedNodesImmediate(Array.from(runtime.lassoPreviewNodeIds.value))
    clearLassoPreview(false)
    runtime.interaction.suppressNextContextMenu = false
  }

  const beginLassoSelection = (event: PointerEvent, panel: HTMLElement) => {
    const rect = panel.getBoundingClientRect()
    lassoPanelOrigin = { left: rect.left, top: rect.top }
    lassoPointerCaptureTarget = panel
    if (typeof panel.setPointerCapture === 'function') {
      try {
        panel.setPointerCapture(event.pointerId)
      } catch {
        lassoPointerCaptureTarget = null
      }
    }
    lassoBoundsCache = []
    lassoBoundsCacheReady = false
    runtime.selectionOverlayGeometrySnapshot.value = null
    runtime.isLassoSelecting.value = true
    runtime.lassoPreviewNodeIds.value = new Set()
    runtime.rightSelection.value = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      startLocalX: event.clientX - rect.left,
      startLocalY: event.clientY - rect.top,
      currentLocalX: event.clientX - rect.left,
      currentLocalY: event.clientY - rect.top
    }
    paintLassoSelectionBox(runtime.rightSelection.value)
    window.addEventListener('pointermove', handleRightSelectionMove, { capture: true })
    window.addEventListener('pointerup', handleRightSelectionEnd, { capture: true, once: true })
  }

  const cleanupLassoSelection = () => {
    window.removeEventListener('pointermove', handleRightSelectionMove, true)
    window.removeEventListener('pointerup', handleRightSelectionEnd, true)
    lassoPointerCaptureTarget = null
    clearLassoPreview()
    removeLassoSelectionBox()
  }

  return {
    beginLassoSelection,
    cleanupLassoSelection,
    clearLassoPreview,
    lassoPreviewRects
  }
}
