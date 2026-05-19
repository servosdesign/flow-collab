import type { FlowRuntime } from '../../../flowRuntime'
import {
  drawWindowRedrawRatio,
  maxDevicePixelRatio,
  viewportCullPadding,
  zoomEpsilon
} from './constants'
import { roundLayoutValue } from './geometry'
import type { CanvasDrawWindow, CanvasLayoutState, ViewportMetrics } from './types'

export const createCanvasLayoutState = (): CanvasLayoutState => ({
  positioned: false,
  transform: '',
  width: '',
  height: '',
  pixelWidth: 0,
  pixelHeight: 0
})

export const createPreviewCanvasLayoutState = () => ({
  width: '',
  height: '',
  pixelWidth: 0,
  pixelHeight: 0
})

export const getViewportMetrics = (runtime: FlowRuntime): ViewportMetrics => {
  const view = runtime.viewport.value
  const zoom = Math.max(0.001, view.zoom)
  const viewportWidth = Math.max(1, runtime.dimensions.value.width)
  const viewportHeight = Math.max(1, runtime.dimensions.value.height)
  const padding = viewportCullPadding / zoom
  const ratio = Math.min(maxDevicePixelRatio, Math.max(1, window.devicePixelRatio || 1))
  const visibleLeft = -view.x / zoom
  const visibleTop = -view.y / zoom

  return {
    visibleLeft,
    visibleTop,
    visibleWidth: viewportWidth / zoom,
    visibleHeight: viewportHeight / zoom,
    zoom,
    viewportWidth,
    viewportHeight,
    ratio,
    padding
  }
}

export const createCanvasDrawWindow = (
  runtime: FlowRuntime,
  metrics = getViewportMetrics(runtime)
): CanvasDrawWindow => {
  const left = roundLayoutValue(metrics.visibleLeft - metrics.padding)
  const top = roundLayoutValue(metrics.visibleTop - metrics.padding)
  const width = roundLayoutValue(metrics.visibleWidth + metrics.padding * 2)
  const height = roundLayoutValue(metrics.visibleHeight + metrics.padding * 2)
  const renderScale = metrics.ratio * metrics.zoom
  const pixelWidth = Math.max(1, Math.round(width * renderScale))
  const pixelHeight = Math.max(1, Math.round(height * renderScale))

  return {
    left,
    top,
    width,
    height,
    zoom: metrics.zoom,
    viewportWidth: metrics.viewportWidth,
    viewportHeight: metrics.viewportHeight,
    ratio: metrics.ratio,
    renderScale,
    pixelWidth,
    pixelHeight,
    padding: metrics.padding
  }
}

export const doesViewportFitDrawWindow = (
  runtime: FlowRuntime,
  drawWindow: CanvasDrawWindow,
  metrics = getViewportMetrics(runtime)
) => {
  if (
    Math.abs(drawWindow.zoom - metrics.zoom) > zoomEpsilon ||
    drawWindow.viewportWidth !== metrics.viewportWidth ||
    drawWindow.viewportHeight !== metrics.viewportHeight ||
    drawWindow.ratio !== metrics.ratio
  ) {
    return false
  }

  const redrawInset = metrics.padding * drawWindowRedrawRatio
  const visibleRight = metrics.visibleLeft + metrics.visibleWidth
  const visibleBottom = metrics.visibleTop + metrics.visibleHeight

  return (
    metrics.visibleLeft >= drawWindow.left + redrawInset &&
    metrics.visibleTop >= drawWindow.top + redrawInset &&
    visibleRight <= drawWindow.left + drawWindow.width - redrawInset &&
    visibleBottom <= drawWindow.top + drawWindow.height - redrawInset
  )
}

export const applyCanvasDrawWindow = (
  canvas: HTMLCanvasElement,
  drawWindow: CanvasDrawWindow,
  layoutState: CanvasLayoutState
) => {
  const transform = `translate3d(${drawWindow.left}px, ${drawWindow.top}px, 0)`
  const cssWidth = `${drawWindow.width}px`
  const cssHeight = `${drawWindow.height}px`

  if (!layoutState.positioned) {
    canvas.style.left = '0'
    canvas.style.top = '0'
    layoutState.positioned = true
  }

  if (layoutState.transform !== transform) {
    canvas.style.transform = transform
    layoutState.transform = transform
  }

  if (layoutState.width !== cssWidth) {
    canvas.style.width = cssWidth
    layoutState.width = cssWidth
  }

  if (layoutState.height !== cssHeight) {
    canvas.style.height = cssHeight
    layoutState.height = cssHeight
  }

  if (canvas.width !== drawWindow.pixelWidth || canvas.height !== drawWindow.pixelHeight) {
    canvas.width = drawWindow.pixelWidth
    canvas.height = drawWindow.pixelHeight
    layoutState.pixelWidth = drawWindow.pixelWidth
    layoutState.pixelHeight = drawWindow.pixelHeight
  } else {
    layoutState.pixelWidth = drawWindow.pixelWidth
    layoutState.pixelHeight = drawWindow.pixelHeight
  }
}

export const syncPreviewCanvas = (
  runtime: FlowRuntime,
  canvas: HTMLCanvasElement,
  layoutState: ReturnType<typeof createPreviewCanvasLayoutState>
) => {
  const metrics = getViewportMetrics(runtime)
  const width = `${metrics.viewportWidth}px`
  const height = `${metrics.viewportHeight}px`
  const pixelWidth = Math.max(1, Math.round(metrics.viewportWidth * metrics.ratio))
  const pixelHeight = Math.max(1, Math.round(metrics.viewportHeight * metrics.ratio))

  if (layoutState.width !== width) {
    canvas.style.width = width
    layoutState.width = width
  }

  if (layoutState.height !== height) {
    canvas.style.height = height
    layoutState.height = height
  }

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    layoutState.pixelWidth = pixelWidth
    layoutState.pixelHeight = pixelHeight
  }

  return metrics
}
