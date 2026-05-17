<script setup lang="ts">
import {
  MarkerType,
  Position,
  useVueFlow,
  type GraphEdge,
  type GraphNode,
  type HandleElement
} from '@vue-flow/core'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  edgeClassSignature,
  edgeHasClass,
  resolveGraphEdgeGeometry,
  type ResolvedEdgeGeometry
} from './edgeGeometry'

const canvasElement = ref<HTMLCanvasElement | null>(null)

const {
  dimensions,
  getEdges,
  getNodes,
  viewport
} = useVueFlow()

let drawFrame: number | undefined
let geometryDirty = true
let cachedEdgeRenders: CachedEdgeRender[] = []

const hiddenEdgeClass = 'selection-drag-hidden-edge'
const maxDevicePixelRatio = 2
const viewportCullPadding = 160

type EdgePaintStyle = {
  stroke: string
  lineWidth: number
  shadowBlur: number
  shadowColor: string
  dashed: boolean
}

type EdgeBounds = {
  left: number
  top: number
  right: number
  bottom: number
}

type CachedEdgeRender = {
  geometryKey: string
  styleKey: string
  geometry: ResolvedEdgeGeometry
  bounds: EdgeBounds
  path: Path2D
  style: EdgePaintStyle
  markerType: MarkerType | null
}

type CanvasLayoutState = {
  positioned: boolean
  transform: string
  width: string
  height: string
  pixelWidth: number
  pixelHeight: number
}

const edgeRenderCache = new Map<string, CachedEdgeRender>()
const canvasLayoutState: CanvasLayoutState = {
  positioned: false,
  transform: '',
  width: '',
  height: '',
  pixelWidth: 0,
  pixelHeight: 0
}

const roundLayoutValue = (value: number) => Math.round(value * 1000) / 1000

const roundGeometryValue = (value: number | undefined) => {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : ''
}

const classSignature = (edge: GraphEdge) => edgeClassSignature(edge.class)

const stableValueKey = (value: unknown): string => {
  if (value == null) {
    return ''
  }

  if (typeof value !== 'object') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableValueKey).join(',')}]`
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${key}:${stableValueKey(entryValue)}`)
    .join(',')}}`
}

const getRelevantHandle = (
  node: GraphNode | null | undefined,
  handleType: 'source' | 'target',
  handleId?: string | null
) => {
  const handles = node?.handleBounds?.[handleType]

  if (!handles?.length) {
    return null
  }

  if (!handleId) {
    return handles[0]
  }

  return handles.find((handle) => handle.id === handleId) ?? null
}

const getHandleGeometryKey = (handle: HandleElement | null) => {
  if (!handle) {
    return 'no-handle'
  }

  return [
    handle.id ?? '',
    handle.position,
    roundGeometryValue(handle.x),
    roundGeometryValue(handle.y),
    roundGeometryValue(handle.width),
    roundGeometryValue(handle.height)
  ].join(',')
}

const getNodeGeometryKey = (
  node: GraphNode | null | undefined,
  handleType: 'source' | 'target',
  handleId?: string | null
) => {
  if (!node) {
    return 'missing-node'
  }

  return [
    node.id,
    node.hidden ? 1 : 0,
    node.parentNode ?? '',
    roundGeometryValue(node.computedPosition.x),
    roundGeometryValue(node.computedPosition.y),
    roundGeometryValue(node.dimensions.width),
    roundGeometryValue(node.dimensions.height),
    getHandleGeometryKey(getRelevantHandle(node, handleType, handleId))
  ].join(':')
}

const getEdgeGeometryKey = (edge: GraphEdge) => {
  const pathOptions = 'pathOptions' in edge ? stableValueKey(edge.pathOptions) : ''

  return [
    edge.source,
    edge.target,
    edge.sourceHandle ?? '',
    edge.targetHandle ?? '',
    edge.type ?? '',
    roundGeometryValue(edge.sourceX),
    roundGeometryValue(edge.sourceY),
    roundGeometryValue(edge.targetX),
    roundGeometryValue(edge.targetY),
    getNodeGeometryKey(edge.sourceNode, 'source', edge.sourceHandle),
    getNodeGeometryKey(edge.targetNode, 'target', edge.targetHandle),
    pathOptions
  ].join('|')
}

const getMarkerType = (marker: GraphEdge['markerEnd']) => {
  if (!marker) {
    return null
  }

  const markerType = typeof marker === 'string' ? marker : marker.type

  return markerType === MarkerType.Arrow || markerType === MarkerType.ArrowClosed
    ? markerType
    : null
}

const getMarkerKey = (marker: GraphEdge['markerEnd']) => {
  if (!marker) {
    return ''
  }

  if (typeof marker === 'string') {
    return marker
  }

  return stableValueKey(marker)
}

const getEdgeStyleKey = (edge: GraphEdge) => {
  return [
    edge.selected ? 1 : 0,
    edge.animated ? 1 : 0,
    edge.type ?? '',
    getMarkerKey(edge.markerEnd),
    classSignature(edge)
  ].join('|')
}

const getGeometryBounds = (geometry: ResolvedEdgeGeometry, style: EdgePaintStyle): EdgeBounds => {
  const padding = Math.max(24, style.lineWidth * 8 + style.shadowBlur)

  return {
    left: Math.min(geometry.sourceX, geometry.targetX) - padding,
    top: Math.min(geometry.sourceY, geometry.targetY) - padding,
    right: Math.max(geometry.sourceX, geometry.targetX) + padding,
    bottom: Math.max(geometry.sourceY, geometry.targetY) + padding
  }
}

const markGeometryDirty = () => {
  geometryDirty = true
  scheduleDraw()
}

const scheduleDraw = () => {
  if (drawFrame) {
    return
  }

  drawFrame = window.requestAnimationFrame(drawCanvas)
}

const syncCanvasSize = (canvas: HTMLCanvasElement) => {
  const view = viewport.value
  const zoom = Math.max(0.001, view.zoom)
  const viewportWidth = Math.max(1, dimensions.value.width)
  const viewportHeight = Math.max(1, dimensions.value.height)
  const padding = viewportCullPadding / zoom
  const left = roundLayoutValue(-view.x / zoom - padding)
  const top = roundLayoutValue(-view.y / zoom - padding)
  const width = roundLayoutValue(viewportWidth / zoom + padding * 2)
  const height = roundLayoutValue(viewportHeight / zoom + padding * 2)
  const ratio = Math.min(maxDevicePixelRatio, Math.max(1, window.devicePixelRatio || 1))
  const renderScale = ratio * zoom
  const pixelWidth = Math.max(1, Math.round(width * renderScale))
  const pixelHeight = Math.max(1, Math.round(height * renderScale))
  const transform = `translate3d(${left}px, ${top}px, 0)`
  const cssWidth = `${width}px`
  const cssHeight = `${height}px`

  if (!canvasLayoutState.positioned) {
    canvas.style.left = '0'
    canvas.style.top = '0'
    canvasLayoutState.positioned = true
  }

  if (canvasLayoutState.transform !== transform) {
    canvas.style.transform = transform
    canvasLayoutState.transform = transform
  }

  if (canvasLayoutState.width !== cssWidth) {
    canvas.style.width = cssWidth
    canvasLayoutState.width = cssWidth
  }

  if (canvasLayoutState.height !== cssHeight) {
    canvas.style.height = cssHeight
    canvasLayoutState.height = cssHeight
  }

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    canvasLayoutState.pixelWidth = pixelWidth
    canvasLayoutState.pixelHeight = pixelHeight
  } else {
    canvasLayoutState.pixelWidth = pixelWidth
    canvasLayoutState.pixelHeight = pixelHeight
  }

  return {
    left,
    top,
    width,
    height,
    renderScale
  }
}

const getEdgePaintStyle = (edge: GraphEdge) : EdgePaintStyle => {
  if (edge.selected) {
    return {
      stroke: '#dc2626',
      lineWidth: 4,
      shadowBlur: 4,
      shadowColor: 'rgb(220 38 38 / 36%)',
      dashed: false
    }
  }

  if (edge.animated) {
    return {
      stroke: '#0f766e',
      lineWidth: edge.type === 'section-through' ? 2.7 : 2,
      shadowBlur: 0,
      shadowColor: 'transparent',
      dashed: true
    }
  }

  if (edge.type === 'section-through') {
    return {
      stroke: '#2563eb',
      lineWidth: 2.7,
      shadowBlur: 0,
      shadowColor: 'transparent',
      dashed: false
    }
  }

  return {
    stroke: '#3f5870',
    lineWidth: 2,
    shadowBlur: 0,
    shadowColor: 'transparent',
    dashed: false
  }
}

const isBoundsVisible = (
  bounds: EdgeBounds,
  left: number,
  top: number,
  width: number,
  height: number
) => {
  const right = left + width
  const bottom = top + height

  return bounds.right >= left && bounds.left <= right && bounds.bottom >= top && bounds.top <= bottom
}

const getMarkerAngle = (position: Position) => {
  switch (position) {
    case Position.Left:
      return 0
    case Position.Right:
      return Math.PI
    case Position.Top:
      return Math.PI / 2
    case Position.Bottom:
      return -Math.PI / 2
  }
}

const drawArrowHead = (
  context: CanvasRenderingContext2D,
  geometry: ResolvedEdgeGeometry,
  style: EdgePaintStyle,
  markerType: MarkerType | null
) => {
  if (!markerType) {
    return
  }

  const angle = getMarkerAngle(geometry.targetPosition)
  const length = Math.max(9, style.lineWidth * 4)
  const halfWidth = Math.max(4, style.lineWidth * 2.2)

  context.save()
  context.translate(geometry.targetX, geometry.targetY)
  context.rotate(angle)
  context.beginPath()
  context.moveTo(0, 0)
  context.lineTo(-length, -halfWidth)

  if (markerType === MarkerType.ArrowClosed) {
    context.lineTo(-length, halfWidth)
    context.closePath()
    context.fillStyle = style.stroke
    context.fill()
  } else {
    context.moveTo(0, 0)
    context.lineTo(-length, halfWidth)
  }

  context.strokeStyle = style.stroke
  context.lineWidth = Math.max(1, style.lineWidth)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.stroke()
  context.restore()
}

const resolveCachedEdgeRender = (edge: GraphEdge) => {
  if (edgeHasClass(edge.class, hiddenEdgeClass)) {
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

  for (const edge of getEdges.value) {
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

  cachedEdgeRenders = nextRenders
  geometryDirty = false
}

const drawCanvas = () => {
  drawFrame = undefined

  const canvas = canvasElement.value
  const context = canvas?.getContext('2d')

  if (!canvas || !context) {
    return
  }

  const { left, top, width, height, renderScale } = syncCanvasSize(canvas)
  let hasAnimatedEdges = false

  if (geometryDirty) {
    rebuildEdgeRenderCache()
  }

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
    if (!isBoundsVisible(edgeRender.bounds, left, top, width, height)) {
      continue
    }

    const { geometry, path, style } = edgeRender

    if (style.dashed) {
      hasAnimatedEdges = true
    }

    context.save()
    context.strokeStyle = style.stroke
    context.lineWidth = style.lineWidth
    context.shadowBlur = style.shadowBlur
    context.shadowColor = style.shadowColor
    context.setLineDash(style.dashed ? [5, 5] : [])
    context.lineDashOffset = style.dashed ? -(performance.now() / 45) % 10 : 0
    context.stroke(path)
    context.setLineDash([])
    drawArrowHead(context, geometry, style, edgeRender.markerType)
    context.restore()
  }

  if (hasAnimatedEdges) {
    scheduleDraw()
  }
}

watch(
  () => [
    viewport.value.x,
    viewport.value.y,
    viewport.value.zoom,
    dimensions.value.width,
    dimensions.value.height
  ],
  scheduleDraw,
  { flush: 'post', immediate: true }
)

watch(getEdges, markGeometryDirty, { deep: true, flush: 'post' })
watch(getNodes, markGeometryDirty, { deep: true, flush: 'post' })

onMounted(() => {
  scheduleDraw()
})

onBeforeUnmount(() => {
  if (drawFrame) {
    window.cancelAnimationFrame(drawFrame)
    drawFrame = undefined
  }
})
</script>

<template>
  <canvas
    ref="canvasElement"
    class="canvas-edge-layer"
    aria-hidden="true"
  />
</template>
