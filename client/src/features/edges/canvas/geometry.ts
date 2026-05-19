import {
  MarkerType,
  Position,
  type EdgeMarkerType,
  type GraphNode,
  type HandleElement
} from '@vue-flow/core'
import type { FlowEdge } from '../../../domain/graph'
import type { FlowRuntime } from '../../../flowRuntime'
import {
  edgeClassSignature,
  type ResolvedEdgeGeometry
} from '../edgeGeometry'
import type { CanvasGraphEdge, EdgeBounds, EdgePaintStyle } from './types'

export const roundLayoutValue = (value: number) => Math.round(value * 1000) / 1000

export const roundGeometryValue = (value: number | undefined) => {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : ''
}

export const stableValueKey = (value: unknown): string => {
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

export const getRelevantHandle = (
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

const classSignature = (edge: CanvasGraphEdge) => edgeClassSignature(edge.class)

export const getEdgeGeometryKey = (edge: CanvasGraphEdge) => {
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

export const getMarkerType = (marker: EdgeMarkerType | undefined) => {
  if (!marker) {
    return null
  }

  const markerType = typeof marker === 'string' ? marker : marker.type

  return markerType === MarkerType.Arrow || markerType === MarkerType.ArrowClosed
    ? markerType
    : null
}

const getMarkerKey = (marker: EdgeMarkerType | undefined) => {
  if (!marker) {
    return ''
  }

  if (typeof marker === 'string') {
    return marker
  }

  return stableValueKey(marker)
}

export const getEdgeStyleKey = (edge: CanvasGraphEdge) => {
  return [
    edge.selected ? 1 : 0,
    edge.animated ? 1 : 0,
    edge.type ?? '',
    getMarkerKey(edge.markerEnd),
    classSignature(edge)
  ].join('|')
}

export const getGeometryBounds = (
  geometry: ResolvedEdgeGeometry,
  style: EdgePaintStyle
): EdgeBounds => {
  const padding = Math.max(24, style.lineWidth * 8 + style.shadowBlur)

  return {
    left: Math.min(geometry.sourceX, geometry.targetX) - padding,
    top: Math.min(geometry.sourceY, geometry.targetY) - padding,
    right: Math.max(geometry.sourceX, geometry.targetX) + padding,
    bottom: Math.max(geometry.sourceY, geometry.targetY) + padding
  }
}

export const isBoundsVisible = (
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

type PathPoint = { x: number, y: number }

const pathTokenPattern = /[MLQ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi

const parseNumber = (token: string | undefined) => {
  if (!token) {
    return null
  }

  const value = Number.parseFloat(token)

  return Number.isFinite(value) ? value : null
}

const getPointSegmentDistance = (
  point: PathPoint,
  start: PathPoint,
  end: PathPoint
) => {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const lengthSquared = deltaX * deltaX + deltaY * deltaY

  if (lengthSquared <= 0) {
    return Math.hypot(point.x - start.x, point.y - start.y)
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared
    )
  )
  const projectedX = start.x + t * deltaX
  const projectedY = start.y + t * deltaY

  return Math.hypot(point.x - projectedX, point.y - projectedY)
}

const getQuadraticPoint = (
  start: PathPoint,
  control: PathPoint,
  end: PathPoint,
  t: number
) => {
  const inverse = 1 - t

  return {
    x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
    y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y
  }
}

export const isPointNearSvgPath = (
  path: string,
  point: PathPoint,
  radius: number
) => {
  const tokens = path.match(pathTokenPattern) ?? []
  let index = 0
  let command = ''
  let current: PathPoint | null = null

  while (index < tokens.length) {
    const token = tokens[index]

    if (token === 'M' || token === 'L' || token === 'Q') {
      command = token
      index += 1
    }

    if (command === 'M' || command === 'L') {
      const x = parseNumber(tokens[index])
      const y = parseNumber(tokens[index + 1])

      if (x == null || y == null) {
        return false
      }

      const next = { x, y }

      if (command === 'L' && current && getPointSegmentDistance(point, current, next) <= radius) {
        return true
      }

      current = next
      index += 2
      continue
    }

    if (command === 'Q') {
      const controlX = parseNumber(tokens[index])
      const controlY = parseNumber(tokens[index + 1])
      const endX = parseNumber(tokens[index + 2])
      const endY = parseNumber(tokens[index + 3])

      if (!current || controlX == null || controlY == null || endX == null || endY == null) {
        return false
      }

      const control = { x: controlX, y: controlY }
      const end = { x: endX, y: endY }
      let previous = current

      for (let step = 1; step <= 8; step += 1) {
        const next = getQuadraticPoint(current, control, end, step / 8)

        if (getPointSegmentDistance(point, previous, next) <= radius) {
          return true
        }

        previous = next
      }

      current = end
      index += 4
      continue
    }

    index += 1
  }

  return false
}

export const getHandleAnchor = (
  node: GraphNode,
  handle: HandleElement,
  offset = { x: 0, y: 0 }
) => {
  const x = handle.x + node.computedPosition.x + offset.x
  const y = handle.y + node.computedPosition.y + offset.y

  switch (handle.position) {
    case Position.Top:
      return { x: x + handle.width / 2, y }
    case Position.Right:
      return { x: x + handle.width, y: y + handle.height / 2 }
    case Position.Bottom:
      return { x: x + handle.width / 2, y: y + handle.height }
    case Position.Left:
      return { x, y: y + handle.height / 2 }
  }
}

export const getOppositePosition = (position: Position) => {
  switch (position) {
    case Position.Left:
      return Position.Right
    case Position.Right:
      return Position.Left
    case Position.Top:
      return Position.Bottom
    case Position.Bottom:
      return Position.Top
  }
}

export const isInsideSection = (
  node: GraphNode | null | undefined,
  section: GraphNode | null | undefined
) => {
  return Boolean(node && section && node.parentNode === section.id)
}

export const isPointInsideNode = (x: number, y: number, node: GraphNode) => {
  return (
    x >= node.computedPosition.x &&
    x <= node.computedPosition.x + node.dimensions.width &&
    y >= node.computedPosition.y &&
    y <= node.computedPosition.y + node.dimensions.height
  )
}

export const portEndpointX = (
  x: number,
  handleId: string | null | undefined,
  sectionNode: GraphNode | null | undefined,
  otherNode: GraphNode | null | undefined,
  pointerInsideSection = false
) => {
  if (!sectionNode) {
    return x
  }

  const isInside = pointerInsideSection || isInsideSection(otherNode, sectionNode)

  if (handleId === 'section-left') {
    return isInside ? x : x
  }

  if (handleId === 'section-right') {
    return isInside ? x : x
  }

  return x
}

export const getNodeLookup = (runtime: FlowRuntime) => {
  const lookup = new Map<string, GraphNode>()

  runtime.getNodes.value.forEach((node) => {
    lookup.set(node.id, node)
  })

  return lookup
}

export const toCanvasGraphEdge = (
  edge: FlowEdge,
  nodeLookup: Map<string, GraphNode>
) => {
  const sourceNode = nodeLookup.get(edge.source)
  const targetNode = nodeLookup.get(edge.target)

  if (!sourceNode || !targetNode) {
    return null
  }

  return {
    ...edge,
    sourceNode,
    targetNode,
    sourceX: Number.NaN,
    sourceY: Number.NaN,
    targetX: Number.NaN,
    targetY: Number.NaN,
    selected: Boolean((edge as FlowEdge & { selected?: boolean }).selected),
    type: edge.type ?? 'step',
    data: {},
    events: {}
  } as CanvasGraphEdge
}

export const getCanvasGraphEdges = (runtime: FlowRuntime) => {
  const nodeLookup = getNodeLookup(runtime)
  const nextEdges: CanvasGraphEdge[] = []

  for (const edge of runtime.edges.value as FlowEdge[]) {
    const graphEdge = toCanvasGraphEdge(edge, nodeLookup)

    if (graphEdge) {
      nextEdges.push(graphEdge)
    }
  }

  return nextEdges
}
