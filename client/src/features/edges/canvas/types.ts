import type {
  Connection as FlowConnection,
  GraphEdge,
  GraphNode,
  HandleElement,
  MarkerType,
  ConnectionStatus
} from '@vue-flow/core'
import type { EdgeNodeOffsets, ResolvedEdgeGeometry } from '../edgeGeometry'
import type { SelectionMoveDrag } from '../../../flowTypes'

export type EdgeEndpoint = 'source' | 'target'
export type CanvasGraphEdge = GraphEdge<Record<string, never>>

export type EdgePaintStyle = {
  stroke: string
  lineWidth: number
  shadowBlur: number
  shadowColor: string
  dashed: boolean
}

export type EdgeBounds = {
  left: number
  top: number
  right: number
  bottom: number
}

export type CachedEdgeRender = {
  id: string
  geometryKey: string
  styleKey: string
  geometry: ResolvedEdgeGeometry
  bounds: EdgeBounds
  path: Path2D
  style: EdgePaintStyle
  markerType: MarkerType | null
}

export type CachedPreviewEdgeRender = CachedEdgeRender & {
  offsetKey: string
}

export type ActiveDragEdgePreview = {
  affectedEdgeIds: Set<string>
  previewEdges: CanvasGraphEdge[]
  nodeOffsets: EdgeNodeOffsets
  previewRenderCache: Map<string, CachedPreviewEdgeRender>
}

export type ActiveDragEdgePreviewCache = ActiveDragEdgePreview & {
  drag: SelectionMoveDrag
  edgeListVersion: number
  nodeOffsetsKey: string
}

export type CanvasLayoutState = {
  positioned: boolean
  transform: string
  width: string
  height: string
  pixelWidth: number
  pixelHeight: number
}

export type CanvasDrawWindow = {
  left: number
  top: number
  width: number
  height: number
  zoom: number
  viewportWidth: number
  viewportHeight: number
  ratio: number
  renderScale: number
  pixelWidth: number
  pixelHeight: number
  padding: number
}

export type ViewportMetrics = {
  visibleLeft: number
  visibleTop: number
  visibleWidth: number
  visibleHeight: number
  zoom: number
  viewportWidth: number
  viewportHeight: number
  ratio: number
  padding: number
}

export type HandleCandidate = {
  node: GraphNode
  handle: HandleElement
  point: { x: number, y: number }
  connection: FlowConnection
  distance: number
  valid: boolean
}

export type EdgeUpdateDrag = {
  edgeId: string
  endpoint: EdgeEndpoint
  pointerGraph: { x: number, y: number }
  candidate: HandleCandidate | null
}

export type CanvasConnectionPreview = {
  sourceNodeId: string
  sourceHandleId: string | null
  targetNodeId: string | null
  targetHandleId: string | null
  pointerGraph: { x: number, y: number }
  status: ConnectionStatus | null
}

export type CanvasEdgeDependencies = {
  createEdgeConnection: (connection: FlowConnection) => void
  openEdgeContextMenuById: (edgeId: string, event: MouseEvent) => void
  selectOnlyEdge: (edgeId: string) => void
  updateEdgeConnectionById: (edgeId: string, connection: FlowConnection) => boolean
}
