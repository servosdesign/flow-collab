import {
  Position,
  getSmoothStepPath,
  type EdgeProps,
  type GraphEdge,
  type GraphNode,
  type HandleElement,
  type SmoothStepPathOptions
} from '@vue-flow/core'

type EdgeClassValue = GraphEdge['class']

type EdgeGeometryInput = Pick<
  EdgeProps,
  'sourceX' | 'sourceY' | 'targetX' | 'targetY' | 'sourcePosition' | 'targetPosition'
> & {
  type?: string | null
  sourceHandleId?: string | null
  targetHandleId?: string | null
  sourceNode?: GraphNode | null
  targetNode?: GraphNode | null
  pathOptions?: SmoothStepPathOptions
}

export type ResolvedEdgeGeometry = {
  path: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
}

export const edgeHasClass = (className: EdgeClassValue, name: string) => {
  if (typeof className === 'string') {
    return className.split(/\s+/).includes(name)
  }

  if (Array.isArray(className)) {
    return className.includes(name)
  }

  if (className && typeof className === 'object') {
    return Boolean((className as Record<string, unknown>)[name])
  }

  return false
}

export const edgeClassSignature = (className: EdgeClassValue) => {
  if (typeof className === 'string') {
    return className
  }

  if (Array.isArray(className)) {
    return className.join(' ')
  }

  if (className && typeof className === 'object') {
    return Object.entries(className)
      .filter(([, value]) => Boolean(value))
      .map(([name]) => name)
      .sort()
      .join(' ')
  }

  return ''
}

const isInsideSection = (
  node: GraphNode | null | undefined,
  section: GraphNode | null | undefined
) => {
  return Boolean(node && section && node.parentNode === section.id)
}

const resolveSectionPortPosition = (
  handleId: string | null | undefined,
  sectionNode: GraphNode | null | undefined,
  otherNode: GraphNode | null | undefined,
  fallback: Position
) => {
  if (handleId === 'section-left') {
    return isInsideSection(otherNode, sectionNode) ? Position.Right : Position.Left
  }

  if (handleId === 'section-right') {
    return isInsideSection(otherNode, sectionNode) ? Position.Left : Position.Right
  }

  return fallback
}

const resolveSectionPortX = (
  x: number,
  handleId: string | null | undefined,
  sectionNode: GraphNode | null | undefined,
  otherNode: GraphNode | null | undefined
) => {
  if (!sectionNode) {
    return x
  }

  const isInside = isInsideSection(otherNode, sectionNode)
  const portGap = 0

  if (handleId === 'section-left') {
    return isInside ? x + portGap : x - portGap
  }

  if (handleId === 'section-right') {
    return isInside ? x - portGap : x + portGap
  }

  return x
}

const findHandle = (
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

const getNodeHandlePosition = (
  node: GraphNode,
  handle: HandleElement | null,
  fallbackPosition: Position
) => {
  const position = handle?.position ?? fallbackPosition
  const x = (handle?.x ?? 0) + node.computedPosition.x
  const y = (handle?.y ?? 0) + node.computedPosition.y
  const width = handle?.width ?? node.dimensions.width
  const height = handle?.height ?? node.dimensions.height

  switch (position) {
    case Position.Top:
      return { x: x + width / 2, y }
    case Position.Right:
      return { x: x + width, y: y + height / 2 }
    case Position.Bottom:
      return { x: x + width / 2, y: y + height }
    case Position.Left:
      return { x, y: y + height / 2 }
  }
}

const finiteOrFallback = (value: number | undefined, fallback: number) => {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export const resolveEdgeGeometry = (input: EdgeGeometryInput) : ResolvedEdgeGeometry => {
  const isSectionThrough = input.type === 'section-through'
  const sourcePosition = isSectionThrough
    ? resolveSectionPortPosition(
      input.sourceHandleId,
      input.sourceNode,
      input.targetNode,
      input.sourcePosition
    )
    : input.sourcePosition
  const targetPosition = isSectionThrough
    ? resolveSectionPortPosition(
      input.targetHandleId,
      input.targetNode,
      input.sourceNode,
      input.targetPosition
    )
    : input.targetPosition
  const sourceX = isSectionThrough
    ? resolveSectionPortX(
      input.sourceX,
      input.sourceHandleId,
      input.sourceNode,
      input.targetNode
    )
    : input.sourceX
  const targetX = isSectionThrough
    ? resolveSectionPortX(
      input.targetX,
      input.targetHandleId,
      input.targetNode,
      input.sourceNode
    )
    : input.targetX
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY: input.sourceY,
    sourcePosition,
    targetX,
    targetY: input.targetY,
    targetPosition,
    borderRadius: isSectionThrough ? 0 : input.pathOptions?.borderRadius ?? 0,
    offset: isSectionThrough ? 8 : input.pathOptions?.offset
  })

  return {
    path,
    sourceX,
    sourceY: input.sourceY,
    targetX,
    targetY: input.targetY,
    sourcePosition,
    targetPosition
  }
}

export const resolveSectionThroughEdgePath = (input: EdgeGeometryInput) => {
  return resolveEdgeGeometry({
    ...input,
    type: 'section-through'
  }).path
}

export const resolveGraphEdgeGeometry = (edge: GraphEdge) : ResolvedEdgeGeometry | null => {
  if (edge.hidden || edge.sourceNode?.hidden || edge.targetNode?.hidden) {
    return null
  }

  const sourceNode = edge.sourceNode
  const targetNode = edge.targetNode

  if (!sourceNode || !targetNode) {
    return null
  }

  const sourceHandle = findHandle(sourceNode, 'source', edge.sourceHandle)
  const targetHandle = findHandle(targetNode, 'target', edge.targetHandle)
  const sourcePosition = sourceHandle?.position ?? Position.Bottom
  const targetPosition = targetHandle?.position ?? Position.Top
  const sourcePoint = getNodeHandlePosition(sourceNode, sourceHandle, sourcePosition)
  const targetPoint = getNodeHandlePosition(targetNode, targetHandle, targetPosition)
  const pathOptions = 'pathOptions' in edge
    ? (edge.pathOptions as SmoothStepPathOptions | undefined)
    : undefined

  return resolveEdgeGeometry({
    type: edge.type,
    sourceNode,
    targetNode,
    sourceHandleId: edge.sourceHandle,
    targetHandleId: edge.targetHandle,
    sourceX: finiteOrFallback(edge.sourceX, sourcePoint.x),
    sourceY: finiteOrFallback(edge.sourceY, sourcePoint.y),
    targetX: finiteOrFallback(edge.targetX, targetPoint.x),
    targetY: finiteOrFallback(edge.targetY, targetPoint.y),
    sourcePosition,
    targetPosition,
    pathOptions
  })
}
