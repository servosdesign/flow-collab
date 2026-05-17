<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useVueFlow, type GraphNode } from '@vue-flow/core'
import { useMiniMapContext } from '../../app/flowEditorContext'

type Rect = {
  x: number
  y: number
  width: number
  height: number
}

type CanvasSize = {
  width: number
  height: number
}

type MiniMapNodeSnapshot = Rect & {
  id: string
  type: string
  hidden: boolean
  fillColor: string
  strokeColor: string
  strokeWidth: number
}

type MiniMapSnapshot = {
  nodes: MiniMapNodeSnapshot[]
  bounds: Rect | null
  contentSignature: string
  selectionSignature: string
}

const props = withDefaults(defineProps<{
  width?: number
  height?: number
  ariaLabel?: string
}>(), {
  width: 200,
  height: 150,
  ariaLabel: 'Vue Flow mini map'
})

const viewBoxOffsetScale = 5
const maskColor = 'rgb(240, 240, 240, 0.6)'
const maskStrokeColor = '#94a3b8'
const viewportStrokeColor = '#1a73e8'
const clickMovementThreshold = 4
const wheelZoomStep = 0.002

const nodeCanvasElement = ref<HTMLCanvasElement | null>(null)
const overlayCanvasElement = ref<HTMLCanvasElement | null>(null)
let drawFrame: number | undefined
let nodeLayerDirty = true
let overlayLayerDirty = true
let miniMapSnapshotDirty = true
let deferredNodeLayerDirty = false
let lastDrawnViewBox: Rect | null = null
let lastCanvasSize: CanvasSize | null = null
let cachedMiniMapSnapshot: MiniMapSnapshot = {
  nodes: [],
  bounds: null,
  contentSignature: '',
  selectionSignature: ''
}
let miniMapDrag: {
  pointerId: number
  startClientX: number
  startClientY: number
  lastClientX: number
  lastClientY: number
  moved: boolean
} | null = null

const {
  dimensions: flowDimensions,
  maxZoom,
  minZoom,
  nodes,
  setViewport,
  viewport
} = useVueFlow()
const {
  dropSettleVersion,
  getMiniMapNodeColor,
  getMiniMapNodeStroke,
  isDropSettling,
  isLoggedIn,
  selectedNodeIds
} = useMiniMapContext()

const rootStyle = computed(() => ({
  width: `${props.width}px`,
  height: `${props.height}px`
}))

const buildMiniMapSnapshot = () : MiniMapSnapshot => {
  const snapshots: MiniMapNodeSnapshot[] = []
  const contentSignatureParts: string[] = []
  const selectionSignatureParts: string[] = []
  let bounds: Rect | null = null

  for (const node of nodes.value) {
    if (!isInitializedNode(node)) {
      continue
    }

    const rect = nodeRect(node)
    const hidden = node.hidden === true
    const fillColor = getMiniMapNodeColor(node)
    const strokeColor = getMiniMapNodeStroke(node)

    snapshots.push({
      id: node.id,
      type: node.type ?? '',
      hidden,
      fillColor,
      strokeColor,
      strokeWidth: 4,
      ...rect
    })

    if (!hidden) {
      bounds = bounds ? unionRect(bounds, rect) : rect
    }

    contentSignatureParts.push(
      [
        node.id,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        hidden ? 1 : 0,
        node.type ?? '',
        fillColor,
        strokeColor
      ].join(',')
    )

    if (node.selected) {
      selectionSignatureParts.push(node.id)
    }
  }

  return {
    nodes: snapshots,
    bounds,
    contentSignature: contentSignatureParts.join('|'),
    selectionSignature: selectionSignatureParts.join('|')
  }
}

const getMiniMapSnapshot = () => {
  if (miniMapSnapshotDirty && !isDropSettling.value) {
    cachedMiniMapSnapshot = buildMiniMapSnapshot()
    miniMapSnapshotDirty = false
  }

  return cachedMiniMapSnapshot
}

const queueNodeLayerDraw = () => {
  nodeLayerDirty = true
  overlayLayerDirty = true
  queueDraw()
}

const markNodeLayerDirty = () => {
  miniMapSnapshotDirty = true

  if (isDropSettling.value) {
    deferredNodeLayerDirty = true
    return
  }

  queueNodeLayerDraw()
}

const flushDeferredNodeLayerDraw = () => {
  if (!deferredNodeLayerDirty && !miniMapSnapshotDirty) {
    return
  }

  deferredNodeLayerDirty = false
  queueNodeLayerDraw()
}

const queueOverlayLayerDraw = () => {
  overlayLayerDirty = true
  queueDraw()
}

const queueDraw = () => {
  if (drawFrame) {
    return
  }

  drawFrame = window.requestAnimationFrame(() => {
    drawFrame = undefined
    flushDraw()
  })
}

const flushDraw = () => {
  const canvasSize = getCanvasSize()
  const viewBox = getViewBox(canvasSize)

  if (!viewBox) {
    clearCanvas(nodeCanvasElement.value, canvasSize)
    clearCanvas(overlayCanvasElement.value, canvasSize)
    nodeLayerDirty = false
    overlayLayerDirty = false
    lastDrawnViewBox = null
    lastCanvasSize = { ...canvasSize }
    return
  }

  const viewBoxChanged = lastDrawnViewBox === null || !rectsEqual(lastDrawnViewBox, viewBox)
  const canvasSizeChanged =
    lastCanvasSize === null || !canvasSizesEqual(lastCanvasSize, canvasSize)
  const shouldDrawNodes = nodeLayerDirty || viewBoxChanged || canvasSizeChanged
  const shouldDrawOverlay = overlayLayerDirty || shouldDrawNodes

  if (shouldDrawNodes) {
    drawNodeLayer(viewBox, canvasSize)
  }
  if (shouldDrawOverlay) {
    drawViewportMaskLayer(viewBox, canvasSize)
  }

  nodeLayerDirty = false
  overlayLayerDirty = false
  lastDrawnViewBox = { ...viewBox }
  lastCanvasSize = { ...canvasSize }
}

const drawNodeLayer = (viewBox: Rect, canvasSize: CanvasSize) => {
  const canvas = nodeCanvasElement.value
  const ctx = prepareCanvas(canvas, canvasSize)

  if (!ctx) {
    return
  }

  for (const node of getMiniMapSnapshot().nodes) {
    if (node.hidden) {
      continue
    }

    drawNode(ctx, node, viewBox, canvasSize)
  }
}

const drawNode = (
  ctx: CanvasRenderingContext2D,
  node: MiniMapNodeSnapshot,
  viewBox: Rect,
  canvasSize: CanvasSize
) => {
  const canvasRect = toCanvasRect(node, viewBox, canvasSize.width, canvasSize.height)

  if (canvasRect.width <= 0 || canvasRect.height <= 0) {
    return
  }

  const strokeWidth = Math.max(0.75, (node.strokeWidth / viewBox.width) * canvasSize.width)

  ctx.save()
  ctx.beginPath()
  ctx.rect(canvasRect.x, canvasRect.y, canvasRect.width, canvasRect.height)
  ctx.fillStyle = node.fillColor
  ctx.fill()
  ctx.strokeStyle = node.strokeColor
  ctx.lineWidth = strokeWidth
  ctx.stroke()
  ctx.restore()
}

const drawViewportMaskLayer = (viewBox: Rect, canvasSize: CanvasSize) => {
  const canvas = overlayCanvasElement.value
  const ctx = prepareCanvas(canvas, canvasSize)

  if (!ctx) {
    return
  }

  const viewRect = viewportRect()
  const canvasRect = toCanvasRect(viewRect, viewBox, canvasSize.width, canvasSize.height)
  const path = new Path2D()

  path.rect(0, 0, canvasSize.width, canvasSize.height)
  path.rect(canvasRect.x, canvasRect.y, canvasRect.width, canvasRect.height)

  ctx.save()
  ctx.fillStyle = maskColor
  ctx.fill(path, 'evenodd')
  ctx.strokeStyle = maskStrokeColor
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, Math.max(0, canvasSize.width - 1), Math.max(0, canvasSize.height - 1))
  ctx.strokeStyle = viewportStrokeColor
  ctx.lineWidth = 1.5
  ctx.strokeRect(canvasRect.x, canvasRect.y, canvasRect.width, canvasRect.height)
  ctx.restore()
}

const prepareCanvas = (canvas: HTMLCanvasElement | null, canvasSize: CanvasSize) => {
  const ctx = canvas?.getContext('2d')

  if (!canvas || !ctx) {
    return null
  }

  const pixelRatio = window.devicePixelRatio || 1
  const backingWidth = Math.round(canvasSize.width * pixelRatio)
  const backingHeight = Math.round(canvasSize.height * pixelRatio)

  if (canvas.width !== backingWidth) {
    canvas.width = backingWidth
  }
  if (canvas.height !== backingHeight) {
    canvas.height = backingHeight
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  ctx.imageSmoothingEnabled = false

  return ctx
}

const clearCanvas = (canvas: HTMLCanvasElement | null, canvasSize: CanvasSize) => {
  prepareCanvas(canvas, canvasSize)
}

const getCanvasSize = () : CanvasSize => {
  return {
    width: props.width,
    height: props.height
  }
}

const getViewBox = (canvasSize: CanvasSize) : Rect | null => {
  const nodesRect = getMiniMapSnapshot().bounds
  const fallbackRect = viewportRect()
  const boundingRect = nodesRect ?? fallbackRect

  if (boundingRect.width <= 0 || boundingRect.height <= 0) {
    return null
  }

  const scale = Math.max(
    boundingRect.width / canvasSize.width,
    boundingRect.height / canvasSize.height,
    Number.EPSILON
  )
  const viewWidth = scale * canvasSize.width
  const viewHeight = scale * canvasSize.height
  const offset = viewBoxOffsetScale * scale

  return {
    x: boundingRect.x - (viewWidth - boundingRect.width) / 2 - offset,
    y: boundingRect.y - (viewHeight - boundingRect.height) / 2 - offset,
    width: viewWidth + offset * 2,
    height: viewHeight + offset * 2
  }
}

const viewportRect = () : Rect => {
  const currentViewport = viewport.value
  const zoom = currentViewport.zoom || 1

  return {
    x: -currentViewport.x / zoom,
    y: -currentViewport.y / zoom,
    width: flowDimensions.value.width / zoom,
    height: flowDimensions.value.height / zoom
  }
}

const unionRect = (first: Rect, second: Rect) : Rect => {
  const left = Math.min(first.x, second.x)
  const top = Math.min(first.y, second.y)
  const right = Math.max(first.x + first.width, second.x + second.width)
  const bottom = Math.max(first.y + first.height, second.y + second.height)

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  }
}

const rectsEqual = (first: Rect, second: Rect) => {
  return (
    Math.abs(first.x - second.x) < 0.01 &&
    Math.abs(first.y - second.y) < 0.01 &&
    Math.abs(first.width - second.width) < 0.01 &&
    Math.abs(first.height - second.height) < 0.01
  )
}

const canvasSizesEqual = (first: CanvasSize, second: CanvasSize) => {
  return first.width === second.width && first.height === second.height
}

const nodeRect = (node: GraphNode) : Rect => {
  return {
    x: node.computedPosition.x,
    y: node.computedPosition.y,
    width: node.dimensions.width,
    height: node.dimensions.height
  }
}

const toCanvasRect = (
  rect: Rect,
  viewBox: Rect,
  canvasWidth: number,
  canvasHeight: number
) : Rect => {
  return {
    x: ((rect.x - viewBox.x) / viewBox.width) * canvasWidth,
    y: ((rect.y - viewBox.y) / viewBox.height) * canvasHeight,
    width: (rect.width / viewBox.width) * canvasWidth,
    height: (rect.height / viewBox.height) * canvasHeight
  }
}

const canvasPointToGraphPoint = (clientX: number, clientY: number) => {
  const root = overlayCanvasElement.value
  const rect = root?.getBoundingClientRect()
  const viewBox = lastDrawnViewBox ?? getViewBox(getCanvasSize())

  if (!rect || !viewBox || rect.width <= 0 || rect.height <= 0) {
    return null
  }

  return {
    x: viewBox.x + ((clientX - rect.left) / rect.width) * viewBox.width,
    y: viewBox.y + ((clientY - rect.top) / rect.height) * viewBox.height
  }
}

const canvasDeltaToGraphDelta = (clientDeltaX: number, clientDeltaY: number) => {
  const canvasSize = getCanvasSize()
  const viewBox = lastDrawnViewBox ?? getViewBox(canvasSize)

  if (!viewBox || canvasSize.width <= 0 || canvasSize.height <= 0) {
    return null
  }

  return {
    x: (clientDeltaX / canvasSize.width) * viewBox.width,
    y: (clientDeltaY / canvasSize.height) * viewBox.height
  }
}

const isInitializedNode = (node: GraphNode) => {
  return (
    node.dimensions.width !== 0 &&
    node.dimensions.height !== 0 &&
    node.handleBounds !== undefined
  )
}

const clampZoom = (nextZoom: number) => {
  return Math.min(Math.max(nextZoom, minZoom.value), maxZoom.value)
}

const centerViewportOn = (graphX: number, graphY: number, zoom = viewport.value.zoom) => {
  return setViewport({
    x: flowDimensions.value.width / 2 - graphX * zoom,
    y: flowDimensions.value.height / 2 - graphY * zoom,
    zoom
  })
}

const handlePointerDown = (event: PointerEvent) => {
  if (!isLoggedIn.value || event.button !== 0) {
    return
  }

  event.preventDefault()
  event.stopPropagation()
  miniMapDrag = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    lastClientX: event.clientX,
    lastClientY: event.clientY,
    moved: false
  }

  if (event.currentTarget instanceof HTMLElement) {
    event.currentTarget.setPointerCapture(event.pointerId)
  }
}

const handlePointerMove = (event: PointerEvent) => {
  if (!miniMapDrag || event.pointerId !== miniMapDrag.pointerId) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  const delta = canvasDeltaToGraphDelta(
    event.clientX - miniMapDrag.lastClientX,
    event.clientY - miniMapDrag.lastClientY
  )

  if (!delta) {
    return
  }

  if (
    Math.abs(event.clientX - miniMapDrag.startClientX) > clickMovementThreshold ||
    Math.abs(event.clientY - miniMapDrag.startClientY) > clickMovementThreshold
  ) {
    miniMapDrag.moved = true
  }

  miniMapDrag.lastClientX = event.clientX
  miniMapDrag.lastClientY = event.clientY

  void setViewport({
    x: viewport.value.x - delta.x * viewport.value.zoom,
    y: viewport.value.y - delta.y * viewport.value.zoom,
    zoom: viewport.value.zoom
  })
}

const handlePointerUp = (event: PointerEvent) => {
  if (!miniMapDrag || event.pointerId !== miniMapDrag.pointerId) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  const drag = miniMapDrag
  miniMapDrag = null

  if (event.currentTarget instanceof HTMLElement && event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  if (drag.moved) {
    return
  }

  const graphPoint = canvasPointToGraphPoint(event.clientX, event.clientY)

  if (graphPoint) {
    void centerViewportOn(graphPoint.x, graphPoint.y)
  }
}

const handlePointerCancel = (event: PointerEvent) => {
  if (!miniMapDrag || event.pointerId !== miniMapDrag.pointerId) {
    return
  }

  miniMapDrag = null
}

const handleWheel = (event: WheelEvent) => {
  if (!isLoggedIn.value) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  const currentZoom = viewport.value.zoom || 1
  const nextZoom = clampZoom(currentZoom * 2 ** (-event.deltaY * wheelZoomStep))

  if (Math.abs(nextZoom - currentZoom) < 0.0001) {
    return
  }

  const centerX = (-viewport.value.x + flowDimensions.value.width / 2) / currentZoom
  const centerY = (-viewport.value.y + flowDimensions.value.height / 2) / currentZoom

  void centerViewportOn(centerX, centerY, nextZoom)
}

watch(nodes, markNodeLayerDirty, { flush: 'post' })
watch(selectedNodeIds, markNodeLayerDirty, { flush: 'post' })

watch(
  () => [isDropSettling.value, dropSettleVersion.value],
  ([settling]) => {
    if (!settling) {
      flushDeferredNodeLayerDraw()
    }
  },
  { flush: 'post' }
)

watch(
  () => [
    viewport.value.x,
    viewport.value.y,
    viewport.value.zoom,
    flowDimensions.value.width,
    flowDimensions.value.height,
    props.width,
    props.height
  ],
  queueOverlayLayerDraw,
  { flush: 'post' }
)

onMounted(queueNodeLayerDraw)

onBeforeUnmount(() => {
  if (drawFrame) {
    window.cancelAnimationFrame(drawFrame)
  }
})
</script>

<template>
  <div
    class="flowchart-canvas-minimap vue-flow__minimap"
    :class="{ pannable: isLoggedIn, zoomable: isLoggedIn }"
    :style="rootStyle"
    @contextmenu.prevent.stop
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="handlePointerUp"
    @pointercancel="handlePointerCancel"
    @wheel="handleWheel"
  >
    <canvas
      ref="nodeCanvasElement"
      class="flowchart-canvas-minimap__canvas"
      role="img"
      :aria-label="props.ariaLabel"
    />
    <canvas
      ref="overlayCanvasElement"
      class="flowchart-canvas-minimap__canvas flowchart-canvas-minimap__overlay"
      aria-hidden="true"
    />
  </div>
</template>

<style scoped>
.flowchart-canvas-minimap {
  position: absolute;
  background: #ffffff;
  contain: layout paint style;
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.flowchart-canvas-minimap:active {
  cursor: grabbing;
}

.flowchart-canvas-minimap__canvas {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.flowchart-canvas-minimap__overlay {
  position: absolute;
  inset: 0;
}
</style>
