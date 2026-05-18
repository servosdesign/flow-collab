import { computed } from 'vue'
import type { FlowEditorServices } from '../../app/flowEditorServices'
import {
  createGraphCache,
  getMinimumNodeHeight,
  getNodeBounds,
  type GraphCache
} from '../../domain/graph'
import type { FlowRuntime } from '../../flowRuntime'
import type { SyncNode } from '@vue-flow-sync/shared'

const selectionBoundsPadding = 4

type FlowBounds = {
  x: number
  y: number
  width: number
  height: number
  padding?: number
}

type SelectedNodeOutlineFlowRect = {
  id: string
  bounds: FlowBounds
}

type SelectionOverlayGeometry = {
  selectedBounds: FlowBounds | null
  outlineRects: SelectedNodeOutlineFlowRect[]
}

const emptySelectionGeometry: SelectionOverlayGeometry = {
  selectedBounds: null,
  outlineRects: []
}

const getFlowBoundsStyle = (
  bounds: FlowBounds,
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

const getFlowRectStyle = (
  bounds: FlowBounds,
  viewport: { x: number, y: number, zoom: number }
) => {
  return {
    left: `${bounds.x * viewport.zoom + viewport.x}px`,
    top: `${bounds.y * viewport.zoom + viewport.y}px`,
    width: `${bounds.width * viewport.zoom}px`,
    height: `${bounds.height * viewport.zoom}px`
  }
}

const getRenderedOutlineBounds = (node: SyncNode, bounds: FlowBounds) => {
  if (node.type !== 'item') {
    return bounds
  }

  return {
    ...bounds,
    height: Math.max(bounds.height, getMinimumNodeHeight(node))
  }
}

const getSelectionGeometry = (
  graphNodes: SyncNode[],
  graph: GraphCache,
  selectedIds: Set<string>,
  includeOutlineRects: boolean
) : SelectionOverlayGeometry => {
  let selectedCount = 0
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const outlineRects: SelectedNodeOutlineFlowRect[] = []

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

    if (includeOutlineRects && node.type !== 'section') {
      outlineRects.push({
        id: node.id,
        bounds: getRenderedOutlineBounds(node, bounds)
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

export const useSelectionOverlayModel = (
  runtime: FlowRuntime,
  services: FlowEditorServices
) => {
  const selectedFlowGeometry = computed<SelectionOverlayGeometry>(() => {
    if (
      !runtime.isLoggedIn.value ||
      runtime.rightSelection.value
    ) {
      return emptySelectionGeometry
    }

    const selectedNodeCount = runtime.selectedNodeIds.value.size
    const sectionDragPreview = runtime.sectionNodeDragPreview.value
    const selectionMoveDrag = runtime.interaction.selectionMoveDrag
    const isMovingSelection = runtime.isMovingSelection.value

    const hasSelectionMoveBounds = Boolean(
      isMovingSelection &&
        selectionMoveDrag?.selectedFlowBounds &&
        (sectionDragPreview || selectedNodeCount > 1 || selectionMoveDrag.mode === 'bundle')
    )

    if (!hasSelectionMoveBounds && !sectionDragPreview && selectedNodeCount < 2) {
      return emptySelectionGeometry
    }

    void runtime.selectionBoundsVersion.value

    if (hasSelectionMoveBounds && selectionMoveDrag?.selectedFlowBounds) {
      return {
        selectedBounds: selectionMoveDrag.selectedFlowBounds,
        outlineRects: []
      }
    }

    if (sectionDragPreview) {
      if (sectionDragPreview.selectedFlowBounds) {
        return {
          selectedBounds: sectionDragPreview.selectedFlowBounds,
          outlineRects: []
        }
      }

      const graphNodes = services.getCurrentSyncNodes()
      const graph = createGraphCache(graphNodes)
      const section = graph.nodeById.get(sectionDragPreview.sectionId)

      if (!section) {
        return emptySelectionGeometry
      }

      return {
        selectedBounds: getNodeBounds(section, graph),
        outlineRects: []
      }
    }

    if (selectedNodeCount < 2) {
      return emptySelectionGeometry
    }

    const graphNodes = services.getCurrentSyncNodes()
    const graph = createGraphCache(graphNodes)
    const includeOutlineRects =
      !runtime.isLassoSelecting.value &&
      !runtime.isMovingSelection.value

    return getSelectionGeometry(
      graphNodes,
      graph,
      runtime.selectedNodeIds.value,
      includeOutlineRects
    )
  })

  const selectedBoundsStyle = computed<Record<string, string> | null>(() => {
    const bounds = selectedFlowGeometry.value.selectedBounds

    if (!bounds) {
      return null
    }

    return getFlowBoundsStyle(bounds, runtime.currentViewport.value)
  })

  const isSingleNodeSelection = computed(() => runtime.selectedNodeIds.value.size <= 1)

  const selectedNodeOutlineRects = computed<Array<{ id: string, style: Record<string, string> }>>(() => {
    const rects = selectedFlowGeometry.value.outlineRects

    if (rects.length === 0) {
      return []
    }

    const viewport = runtime.currentViewport.value

    return rects.map((rect) => ({
      id: rect.id,
      style: getFlowRectStyle(rect.bounds, viewport)
    }))
  })

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
    selectedNodeOutlineRects,
    selectedBoundsStyle
  }
}
