import type { EdgeNodeOffsets } from '../edgeGeometry'
import type { EdgePaintStyle } from './types'

export const maxDevicePixelRatio = 2
export const viewportCullPadding = 160
export const maxPreviewAffectedEdges = 120
export const emptyNodeOffsets: EdgeNodeOffsets = new Map()
export const edgeHitRadiusPx = 10
export const endpointHitRadiusPx = 10
export const zoomEpsilon = 0.0001
export const drawWindowRedrawRatio = 0.5

export const invalidPreviewStyle: EdgePaintStyle = {
  stroke: '#dc2626',
  lineWidth: 2.8,
  shadowBlur: 4,
  shadowColor: 'rgb(220 38 38 / 30%)',
  dashed: false
}

export const connectionPreviewStyle: EdgePaintStyle = {
  stroke: '#2563eb',
  lineWidth: 2.8,
  shadowBlur: 0,
  shadowColor: 'transparent',
  dashed: false
}
