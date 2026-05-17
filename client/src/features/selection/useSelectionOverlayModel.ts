import { computed } from 'vue'
import type { FlowEditorServices } from '../../app/flowEditorServices'
import {
  createGraphCache,
  getNodeBounds
} from '../../domain/graph'
import type { FlowRuntime } from '../../flowRuntime'

const selectionBoundsPadding = 4

const getFlowBoundsStyle = (
  bounds: { x: number, y: number, width: number, height: number, padding?: number },
  viewport: { x: number, y: number, zoom: number }
) => {
  const padding = bounds.padding ?? selectionBoundsPadding

  return {
    left: `${bounds.x * viewport.zoom + viewport.x - padding}px`,
    top: `${bounds.y * viewport.zoom + viewport.y - padding}px`,
    width: `${bounds.width * viewport.zoom + padding * 2}px`,
    height: `${bounds.height * viewport.zoom + padding * 2}px`
  }
}

export const useSelectionOverlayModel = (
  runtime: FlowRuntime,
  services: FlowEditorServices
) => {
  const selectedBoundsStyle = computed<Record<string, string> | null>(() => {
    if (
      !runtime.isLoggedIn.value ||
      runtime.rightSelection.value
    ) {
      return null
    }

    const selectedNodeCount = runtime.selectedNodeIds.value.size
    const sectionDragPreview = runtime.sectionNodeDragPreview.value
    const selectionMoveDrag = runtime.interaction.selectionMoveDrag
    const isMovingSelection = runtime.isMovingSelection.value

    const hasSelectionMoveBounds = Boolean(
      isMovingSelection &&
        selectionMoveDrag?.selectedFlowBounds &&
        (sectionDragPreview || selectedNodeCount > 1)
    )

    if (!hasSelectionMoveBounds && !sectionDragPreview && selectedNodeCount < 2) {
      return null
    }

    void runtime.selectionBoundsVersion.value
    const viewport = runtime.currentViewport.value

    if (hasSelectionMoveBounds && selectionMoveDrag?.selectedFlowBounds) {
      return getFlowBoundsStyle(selectionMoveDrag.selectedFlowBounds, viewport)
    }

    const graphNodes = services.getCurrentSyncNodes()
    const graph = createGraphCache(graphNodes)

    if (sectionDragPreview) {
      const section = graph.nodeById.get(sectionDragPreview.sectionId)

      if (!section) {
        return null
      }

      const bounds = getNodeBounds(section, graph)
      return getFlowBoundsStyle(bounds, viewport)
    }

    if (selectedNodeCount < 2) {
      return null
    }

    const selectedIds = runtime.selectedNodeIds.value
    let selectedCount = 0
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const node of graphNodes) {
      if (!selectedIds.has(node.id)) {
        continue
      }

      const bounds = getNodeBounds(node, graph)
      selectedCount += 1
      minX = Math.min(minX, bounds.x)
      minY = Math.min(minY, bounds.y)
      maxX = Math.max(maxX, bounds.x + bounds.width)
      maxY = Math.max(maxY, bounds.y + bounds.height)
    }

    if (selectedCount === 0) {
      return null
    }

    return getFlowBoundsStyle({
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    }, viewport)
  })

  const isSingleNodeSelection = computed(() => runtime.selectedNodeIds.value.size <= 1)

  const getSelectedClientBounds = () => {
    const style = selectedBoundsStyle.value
    const panelRect = runtime.canvasPanel.value?.getBoundingClientRect()

    if (!style || !panelRect) {
      return null
    }

    const left = panelRect.left + Number.parseFloat(style.left)
    const top = panelRect.top + Number.parseFloat(style.top)
    const width = Number.parseFloat(style.width)
    const height = Number.parseFloat(style.height)

    return {
      left,
      top,
      right: left + width,
      bottom: top + height
    }
  }

  const isPointInsideSelectedBounds = (event: PointerEvent | MouseEvent) => {
    if (runtime.selectedNodeIds.value.size < 2) {
      return false
    }

    const selectedBounds = getSelectedClientBounds()

    return Boolean(
      selectedBounds &&
        event.clientX >= selectedBounds.left &&
        event.clientX <= selectedBounds.right &&
        event.clientY >= selectedBounds.top &&
        event.clientY <= selectedBounds.bottom
    )
  }

  return {
    getSelectedClientBounds,
    isPointInsideSelectedBounds,
    isSingleNodeSelection,
    selectedBoundsStyle
  }
}
