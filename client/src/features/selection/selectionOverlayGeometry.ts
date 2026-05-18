import type { SyncNode } from '@vue-flow-sync/shared'
import {
  getMinimumNodeHeight,
  getNodeBounds,
  type GraphCache
} from '../../domain/graph'
import type {
  SelectionOverlayFlowBounds,
  SelectionOverlayFlowRect,
  SelectionOverlayGeometry,
  SelectionOverlayGeometrySnapshot
} from '../../flowTypes'

export const selectionBoundsPadding = 4

export const emptySelectionGeometry: SelectionOverlayGeometry = {
  selectedBounds: null,
  outlineRects: []
}

export const getSelectionIdsKey = (nodeIds: Iterable<string>) => {
  return Array.from(nodeIds).sort().join('\u001f')
}

const cloneBounds = (
  bounds: SelectionOverlayFlowBounds
) : SelectionOverlayFlowBounds => ({ ...bounds })

export const cloneSelectionOverlayGeometry = (
  geometry: SelectionOverlayGeometry
) : SelectionOverlayGeometry => ({
  selectedBounds: geometry.selectedBounds ? cloneBounds(geometry.selectedBounds) : null,
  outlineRects: geometry.outlineRects.map((rect) => ({
    id: rect.id,
    bounds: cloneBounds(rect.bounds)
  }))
})

export const createSelectionOverlayGeometrySnapshot = (
  nodeIds: Iterable<string>,
  selectionBoundsVersion: number,
  geometry: SelectionOverlayGeometry
) : SelectionOverlayGeometrySnapshot | null => {
  if (!geometry.selectedBounds) {
    return null
  }

  return {
    selectedIdsKey: getSelectionIdsKey(nodeIds),
    selectionBoundsVersion,
    ...cloneSelectionOverlayGeometry(geometry)
  }
}

export const getReusableSelectionOverlayGeometry = (
  snapshot: SelectionOverlayGeometrySnapshot | null,
  nodeIds: Iterable<string>,
  selectionBoundsVersion: number
) : SelectionOverlayGeometry | null => {
  if (
    !snapshot ||
    snapshot.selectionBoundsVersion !== selectionBoundsVersion ||
    snapshot.selectedIdsKey !== getSelectionIdsKey(nodeIds)
  ) {
    return null
  }

  return cloneSelectionOverlayGeometry(snapshot)
}

export const translateSelectionOverlayGeometry = (
  geometry: SelectionOverlayGeometry,
  delta: { x: number, y: number }
) : SelectionOverlayGeometry => ({
  selectedBounds: geometry.selectedBounds
    ? {
      ...geometry.selectedBounds,
      x: geometry.selectedBounds.x + delta.x,
      y: geometry.selectedBounds.y + delta.y
    }
    : null,
  outlineRects: geometry.outlineRects.map((rect) => ({
    id: rect.id,
    bounds: {
      ...rect.bounds,
      x: rect.bounds.x + delta.x,
      y: rect.bounds.y + delta.y
    }
  }))
})

export const getFlowBoundsStyle = (
  bounds: SelectionOverlayFlowBounds,
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

export const getFlowRectStyle = (
  bounds: SelectionOverlayFlowBounds,
  viewport: { x: number, y: number, zoom: number }
) => {
  return {
    left: `${bounds.x * viewport.zoom + viewport.x}px`,
    top: `${bounds.y * viewport.zoom + viewport.y}px`,
    width: `${bounds.width * viewport.zoom}px`,
    height: `${bounds.height * viewport.zoom}px`
  }
}

export const getRenderedOutlineBounds = (
  node: SyncNode,
  bounds: SelectionOverlayFlowBounds
) => {
  if (node.type !== 'item') {
    return bounds
  }

  return {
    ...bounds,
    height: Math.max(bounds.height, getMinimumNodeHeight(node))
  }
}

export const getSelectionGeometry = (
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
  const outlineRects: SelectionOverlayFlowRect[] = []

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
