import type { FlowRuntime } from '../../../flowRuntime'
import {
  resolveGraphEdgeGeometry,
  resolveGraphEdgeGeometryWithNodeOffsets,
  type EdgeNodeOffsets
} from '../edgeGeometry'
import { maxPreviewAffectedEdges, edgeHitRadiusPx, emptyNodeOffsets } from './constants'
import { drawEdgeRender, getEdgePaintStyle } from './drawing'
import {
  getCanvasGraphEdges,
  getEdgeGeometryKey,
  getEdgeStyleKey,
  getGeometryBounds,
  getMarkerType,
  isBoundsVisible,
  isPointNearSvgPath,
  roundLayoutValue
} from './geometry'
import {
  applyCanvasDrawWindow,
  createCanvasDrawWindow,
  createCanvasLayoutState,
  doesViewportFitDrawWindow
} from './layout'
import type {
  ActiveDragEdgePreview,
  ActiveDragEdgePreviewCache,
  CachedEdgeRender,
  CachedPreviewEdgeRender,
  CanvasDrawWindow,
  CanvasGraphEdge,
  EdgeBounds
} from './types'

type CanvasEdgeRendererOptions = {
  schedulePreviewDraw: () => void
}

export const createCanvasEdgeRenderer = (
  runtime: FlowRuntime,
  options: CanvasEdgeRendererOptions
) => {
  let canvasElement: HTMLCanvasElement | null = null
  let drawFrame: number | undefined
  let geometryDirty = true
  let edgeListVersion = 0
  let cachedGraphEdges: CanvasGraphEdge[] = []
  let cachedEdgeRenders: CachedEdgeRender[] = []
  let activeDragEdgePreviewCache: ActiveDragEdgePreviewCache | null = null
  let canvasDrawWindow: CanvasDrawWindow | null = null

  const edgeRenderCache = new Map<string, CachedEdgeRender>()
  const canvasLayoutState = createCanvasLayoutState()

  const needsCanvasDrawWindowRefresh = () => {
    return !canvasDrawWindow || !doesViewportFitDrawWindow(runtime, canvasDrawWindow)
  }

  const syncCanvasDrawWindow = (canvas: HTMLCanvasElement) => {
    if (!canvasDrawWindow || !doesViewportFitDrawWindow(runtime, canvasDrawWindow)) {
      canvasDrawWindow = createCanvasDrawWindow(runtime)
    }

    applyCanvasDrawWindow(canvas, canvasDrawWindow, canvasLayoutState)

    return canvasDrawWindow
  }

  const scheduleDraw = () => {
    if (drawFrame) {
      return
    }

    drawFrame = window.requestAnimationFrame(drawCanvas)
  }

  const markGeometryDirty = () => {
    geometryDirty = true
    activeDragEdgePreviewCache?.previewRenderCache.clear()
    scheduleDraw()
    options.schedulePreviewDraw()
  }

  const markEdgesDirty = () => {
    edgeListVersion += 1
    activeDragEdgePreviewCache = null
    markGeometryDirty()
  }

  const getSelectionMoveDelta = () => {
    const drag = runtime.interaction.selectionMoveDrag

    if (!drag) {
      return null
    }

    return {
      x: drag.currentGraphDelta.x,
      y: drag.currentGraphDelta.y
    }
  }

  const getOffsetKey = (offset: { x: number, y: number } | undefined) => {
    return offset
      ? `${roundLayoutValue(offset.x)},${roundLayoutValue(offset.y)}`
      : ''
  }

  const getPreviewOffsetKey = (edge: CanvasGraphEdge, nodeOffsets: EdgeNodeOffsets) => {
    return `${getOffsetKey(nodeOffsets.get(edge.source))}|${getOffsetKey(nodeOffsets.get(edge.target))}`
  }

  const syncPreviewNodeOffsets = (
    cache: ActiveDragEdgePreviewCache,
    delta: { x: number, y: number } | null
  ) => {
    if (!delta || cache.previewEdges.length === 0) {
      cache.nodeOffsets = emptyNodeOffsets
      cache.nodeOffsetsKey = ''
      return
    }

    const nodeOffsetsKey = `${roundLayoutValue(delta.x)},${roundLayoutValue(delta.y)}`

    if (cache.nodeOffsetsKey === nodeOffsetsKey) {
      return
    }

    const nodeOffsets: EdgeNodeOffsets = new Map()
    cache.drag.hiddenIds.forEach((nodeId) => {
      nodeOffsets.set(nodeId, delta)
    })

    cache.nodeOffsets = nodeOffsets
    cache.nodeOffsetsKey = nodeOffsetsKey
  }

  const getActiveDragEdgePreview = (edges: CanvasGraphEdge[]) : ActiveDragEdgePreview | null => {
    const drag = runtime.interaction.selectionMoveDrag

    if (!drag) {
      activeDragEdgePreviewCache = null
      return null
    }

    if (
      activeDragEdgePreviewCache?.drag !== drag ||
      activeDragEdgePreviewCache.edgeListVersion !== edgeListVersion
    ) {
      const affectedEdges = edges.filter((edge) =>
        drag.hiddenIds.has(edge.source) || drag.hiddenIds.has(edge.target)
      )

      activeDragEdgePreviewCache = {
        drag,
        edgeListVersion,
        affectedEdgeIds: new Set(affectedEdges.map((edge) => edge.id)),
        previewEdges: drag.mode === 'visible' && affectedEdges.length <= maxPreviewAffectedEdges
          ? affectedEdges
          : [],
        nodeOffsets: emptyNodeOffsets,
        nodeOffsetsKey: '',
        previewRenderCache: new Map()
      }
    }

    if (activeDragEdgePreviewCache.affectedEdgeIds.size === 0) {
      return null
    }

    syncPreviewNodeOffsets(activeDragEdgePreviewCache, getSelectionMoveDelta())

    return activeDragEdgePreviewCache
  }

  const resolveCachedPreviewEdgeRender = (
    edge: CanvasGraphEdge,
    activeDragEdgePreview: ActiveDragEdgePreview
  ) => {
    const geometryKey = getEdgeGeometryKey(edge)
    const styleKey = getEdgeStyleKey(edge)
    const offsetKey = getPreviewOffsetKey(edge, activeDragEdgePreview.nodeOffsets)
    const cached = activeDragEdgePreview.previewRenderCache.get(edge.id)
    const geometryChanged = cached?.geometryKey !== geometryKey || cached?.offsetKey !== offsetKey
    const styleChanged = cached?.styleKey !== styleKey
    const geometry = geometryChanged
      ? resolveGraphEdgeGeometryWithNodeOffsets(edge, activeDragEdgePreview.nodeOffsets)
      : cached.geometry

    if (!geometry) {
      activeDragEdgePreview.previewRenderCache.delete(edge.id)
      return null
    }

    const style = styleChanged || !cached
      ? getEdgePaintStyle(edge)
      : cached.style
    const render: CachedPreviewEdgeRender = {
      id: edge.id,
      geometryKey,
      styleKey,
      offsetKey,
      geometry,
      bounds: geometryChanged || styleChanged || !cached
        ? getGeometryBounds(geometry, style)
        : cached.bounds,
      path: geometryChanged || !cached
        ? new Path2D(geometry.path)
        : cached.path,
      style,
      markerType: getMarkerType(edge.markerEnd)
    }

    activeDragEdgePreview.previewRenderCache.set(edge.id, render)

    return render
  }

  const resolveCachedEdgeRender = (edge: CanvasGraphEdge) => {
    if (runtime.selectionMoveHiddenEdgeIds.value.has(edge.id)) {
      edgeRenderCache.delete(edge.id)
      return null
    }

    const geometryKey = getEdgeGeometryKey(edge)
    const styleKey = getEdgeStyleKey(edge)
    const cached = edgeRenderCache.get(edge.id)
    const geometryChanged = cached?.geometryKey !== geometryKey
    const styleChanged = cached?.styleKey !== styleKey
    const geometry = geometryChanged
      ? resolveGraphEdgeGeometry(edge)
      : cached.geometry

    if (!geometry) {
      edgeRenderCache.delete(edge.id)
      return null
    }

    const style = styleChanged || !cached
      ? getEdgePaintStyle(edge)
      : cached.style
    const render: CachedEdgeRender = {
      id: edge.id,
      geometryKey,
      styleKey,
      geometry,
      bounds: geometryChanged || styleChanged || !cached
        ? getGeometryBounds(geometry, style)
        : cached.bounds,
      path: geometryChanged || !cached
        ? new Path2D(geometry.path)
        : cached.path,
      style,
      markerType: getMarkerType(edge.markerEnd)
    }

    edgeRenderCache.set(edge.id, render)

    return render
  }

  const rebuildEdgeRenderCache = () => {
    const visibleEdgeIds = new Set<string>()
    const nextRenders: CachedEdgeRender[] = []
    const edges = getCanvasGraphEdges(runtime)

    for (const edge of edges) {
      visibleEdgeIds.add(edge.id)

      const render = resolveCachedEdgeRender(edge)

      if (render) {
        nextRenders.push(render)
      }
    }

    for (const edgeId of edgeRenderCache.keys()) {
      if (!visibleEdgeIds.has(edgeId)) {
        edgeRenderCache.delete(edgeId)
      }
    }

    cachedGraphEdges = edges
    cachedEdgeRenders = nextRenders
    geometryDirty = false
  }

  const ensureEdgeRenderCache = () => {
    if (geometryDirty) {
      rebuildEdgeRenderCache()
    }
  }

  const drawCanvas = () => {
    drawFrame = undefined

    const canvas = canvasElement
    const context = canvas?.getContext('2d')

    if (!canvas || !context) {
      return
    }

    const { left, top, width, height, renderScale } = syncCanvasDrawWindow(canvas)
    let hasAnimatedEdges = false

    ensureEdgeRenderCache()

    const activeDragEdgePreview = getActiveDragEdgePreview(cachedGraphEdges)

    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.setTransform(
      renderScale,
      0,
      0,
      renderScale,
      -left * renderScale,
      -top * renderScale
    )
    context.lineCap = 'round'
    context.lineJoin = 'round'

    for (const edgeRender of cachedEdgeRenders) {
      if (activeDragEdgePreview?.affectedEdgeIds.has(edgeRender.id)) {
        continue
      }

      if (!isBoundsVisible(edgeRender.bounds, left, top, width, height)) {
        continue
      }

      const { geometry, path, style } = edgeRender

      if (style.dashed) {
        hasAnimatedEdges = true
      }

      drawEdgeRender(context, geometry, path, style, edgeRender.markerType)
    }

    if (activeDragEdgePreview) {
      for (const edge of activeDragEdgePreview.previewEdges) {
        const edgeRender = resolveCachedPreviewEdgeRender(edge, activeDragEdgePreview)

        if (!edgeRender) {
          continue
        }

        if (!isBoundsVisible(edgeRender.bounds, left, top, width, height)) {
          continue
        }

        if (edgeRender.style.dashed) {
          hasAnimatedEdges = true
        }

        drawEdgeRender(
          context,
          edgeRender.geometry,
          edgeRender.path,
          edgeRender.style,
          edgeRender.markerType
        )
      }
    }

    if (hasAnimatedEdges) {
      scheduleDraw()
    }
  }

  const getGraphPointFromEvent = (event: MouseEvent | PointerEvent) => {
    const flowPoint = runtime.screenToFlowCoordinate({
      x: event.clientX,
      y: event.clientY
    })

    if (Number.isFinite(flowPoint.x) && Number.isFinite(flowPoint.y)) {
      return flowPoint
    }

    const bounds =
      runtime.canvasClientBounds.value ??
      runtime.canvasPanel.value?.getBoundingClientRect()
    const viewport = runtime.viewport.value

    if (!bounds || viewport.zoom <= 0) {
      return null
    }

    return {
      x: (event.clientX - bounds.left - viewport.x) / viewport.zoom,
      y: (event.clientY - bounds.top - viewport.y) / viewport.zoom
    }
  }

  const isPointNearBounds = (
    bounds: EdgeBounds,
    point: { x: number, y: number },
    radius: number
  ) => {
    return (
      point.x >= bounds.left - radius &&
      point.x <= bounds.right + radius &&
      point.y >= bounds.top - radius &&
      point.y <= bounds.bottom + radius
    )
  }

  const hitTestEdge = (event: MouseEvent | PointerEvent) => {
    const point = getGraphPointFromEvent(event)
    const context = canvasElement?.getContext('2d')

    if (!point || !context) {
      return null
    }

    ensureEdgeRenderCache()

    const hitRadius = edgeHitRadiusPx / Math.max(0.001, runtime.viewport.value.zoom)

    context.save()
    context.setTransform(1, 0, 0, 1, 0, 0)

    for (let index = cachedEdgeRenders.length - 1; index >= 0; index -= 1) {
      const render = cachedEdgeRenders[index]

      if (!isPointNearBounds(render.bounds, point, hitRadius)) {
        continue
      }

      context.lineWidth = Math.max(render.style.lineWidth, hitRadius * 2)

      if (
        context.isPointInStroke(render.path, point.x, point.y) ||
        isPointNearSvgPath(render.geometry.path, point, hitRadius)
      ) {
        context.restore()
        return { render, point }
      }
    }

    context.restore()
    return null
  }

  const setCanvasElement = (canvas: HTMLCanvasElement | null) => {
    canvasElement = canvas

    if (canvasElement) {
      scheduleDraw()
    }
  }

  const cleanup = () => {
    if (drawFrame) {
      window.cancelAnimationFrame(drawFrame)
      drawFrame = undefined
    }

    canvasDrawWindow = null
    canvasElement = null
    edgeRenderCache.clear()
    cachedEdgeRenders = []
    cachedGraphEdges = []
  }

  return {
    cleanup,
    ensureEdgeRenderCache,
    getCachedGraphEdges: () => cachedGraphEdges,
    getGraphPointFromEvent,
    hitTestEdge,
    markEdgesDirty,
    markGeometryDirty,
    needsCanvasDrawWindowRefresh,
    scheduleDraw,
    setCanvasElement
  }
}
