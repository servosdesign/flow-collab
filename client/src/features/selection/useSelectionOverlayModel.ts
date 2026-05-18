import { computed } from 'vue'
import type { FlowEditorServices } from '../../app/flowEditorServices'
import {
  createGraphCache,
  getNodeBounds
} from '../../domain/graph'
import type { FlowRuntime } from '../../flowRuntime'
import type {
  SelectionOverlayGeometry,
  SelectionOverlayGeometrySnapshot
} from '../../flowTypes'
import {
  createSelectionOverlayGeometrySnapshot,
  emptySelectionGeometry,
  getFlowBoundsStyle,
  getFlowRectStyle,
  getReusableSelectionOverlayGeometry,
  getSelectionGeometry
} from './selectionOverlayGeometry'

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
    const selectionBoundsVersion = runtime.selectionBoundsVersion.value

    const hasSelectionMoveBounds = Boolean(
      isMovingSelection &&
        selectionMoveDrag?.selectedFlowBounds &&
        (sectionDragPreview || selectedNodeCount > 1 || selectionMoveDrag.mode === 'bundle')
    )

    if (!hasSelectionMoveBounds && !sectionDragPreview && selectedNodeCount < 2) {
      return emptySelectionGeometry
    }

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

    const cachedGeometry = getReusableSelectionOverlayGeometry(
      runtime.selectionOverlayGeometrySnapshot.value,
      runtime.selectedNodeIds.value,
      selectionBoundsVersion
    )

    if (
      cachedGeometry &&
      !runtime.isLassoSelecting.value &&
      !runtime.isMovingSelection.value
    ) {
      return cachedGeometry
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

  const getCurrentSelectionOverlayGeometrySnapshot = () : SelectionOverlayGeometrySnapshot | null => {
    return createSelectionOverlayGeometrySnapshot(
      runtime.selectedNodeIds.value,
      runtime.selectionBoundsVersion.value,
      selectedFlowGeometry.value
    )
  }

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
    getCurrentSelectionOverlayGeometrySnapshot,
    isPointInsideSelectedBounds,
    isSingleNodeSelection,
    selectedNodeOutlineRects,
    selectedBoundsStyle
  }
}
