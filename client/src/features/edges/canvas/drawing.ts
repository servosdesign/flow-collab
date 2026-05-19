import { MarkerType, Position } from '@vue-flow/core'
import type { ResolvedEdgeGeometry } from '../edgeGeometry'
import type { CanvasGraphEdge, EdgePaintStyle } from './types'

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

export const drawEdgeRender = (
  context: CanvasRenderingContext2D,
  geometry: ResolvedEdgeGeometry,
  path: Path2D,
  style: EdgePaintStyle,
  markerType: MarkerType | null
) => {
  context.save()
  context.strokeStyle = style.stroke
  context.lineWidth = style.lineWidth
  context.shadowBlur = style.shadowBlur
  context.shadowColor = style.shadowColor
  context.setLineDash(style.dashed ? [5, 5] : [])
  context.lineDashOffset = style.dashed ? -(performance.now() / 45) % 10 : 0
  context.stroke(path)
  context.setLineDash([])
  drawArrowHead(context, geometry, style, markerType)
  context.restore()
}

export const getEdgePaintStyle = (edge: CanvasGraphEdge) : EdgePaintStyle => {
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
