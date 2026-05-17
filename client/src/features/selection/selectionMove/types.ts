import type { NodeDragItem } from '@vue-flow/core'
import type { SyncNode } from '@vue-flow-sync/shared'
import type { FlowNode } from '../../../domain/graph'
import type {
  SectionDragCandidateBounds,
  SelectionMoveDrag,
  SelectionMovePreviewCounts,
  SelectionMoveRuntimeSnapshot,
  SelectionMovePreviewShapeKind
} from '../../../flowTypes'

export type UseSelectionMoveOptions = {
  getSelectedNodeIds: () => string[]
  commitPendingNodeSelection?: (nodeId: string, reason: 'click' | 'drop') => void
  cancelPendingNodeSelection?: (nodeId: string) => void
}

export type SelectionMovePreviewShape = {
  id: number
  kind: SelectionMovePreviewShapeKind
}

export type RuntimePositionedFlowNode = FlowNode & {
  computedPosition?: { x: number, y: number, z?: number }
  dragging?: boolean
  dimensions?: { width?: number, height?: number }
  extent?: NodeDragItem['extent']
  expandParent?: boolean
}

export type VisibleDragElementSnapshot = {
  id: string
  element: HTMLElement
  transform: string
  willChange: string
  zIndex: string
  pointerEvents: string
}

export type HiddenElementClassSnapshot = {
  id: string
  element: HTMLElement
  hadClass: boolean
}

export type SelectionMoveDragMetadata = {
  dragItems: NodeDragItem[]
  originalPositionsById: Map<string, { x: number, y: number }>
  runtimeSnapshotsById: Map<string, SelectionMoveRuntimeSnapshot>
  sectionDragCandidatesById: Map<string, SectionDragCandidateBounds[]>
}

export type SelectionMoveStartOptions = {
  startClientX: number
  startClientY: number
  currentClientX: number
  currentClientY: number
  pointerId: number
  target: HTMLElement | null
  previewElement: HTMLElement | null
  movingIds: Set<string>
  selectedFlowBounds: SelectionMoveDrag['selectedFlowBounds']
  normalizedOriginalNodes?: SyncNode[]
  forceVisible?: boolean
  hiddenIds?: Set<string>
  previewCounts?: SelectionMovePreviewCounts
  previewShapeKinds?: SelectionMovePreviewShapeKind[]
  movingIndexes?: number[]
  mode?: SelectionMoveDrag['mode']
  dragMetadata?: SelectionMoveDragMetadata
}

export type SingleSectionMoveStartMetadata = {
  syncSection: SyncNode
  movingIds: Set<string>
  hiddenIds: Set<string>
  previewCounts: SelectionMovePreviewCounts
  previewShapeKinds: SelectionMovePreviewShapeKind[]
  movingIndexes: number[]
  mode: SelectionMoveDrag['mode']
  selectedFlowBounds: SelectionMoveDrag['selectedFlowBounds']
  dragMetadata: SelectionMoveDragMetadata
}

export type PendingNodePointerMove = {
  nodeId: string
  pointerId: number
  startClientX: number
  startClientY: number
  target: HTMLElement | null
  pendingSelectionNodeId?: string
  singleSectionMove?: SingleSectionMoveStartMetadata
}

export type PendingSelectionMoveCommit = {
  drag: SelectionMoveDrag
  pendingSelectionNodeId: string | null
}

export type BeginNodePointerMoveOptions = {
  pendingSelectionNodeId?: string
}

export type SelectionMoveDeltaGetter = (
  selectionMoveDrag: SelectionMoveDrag
) => { x: number, y: number }
