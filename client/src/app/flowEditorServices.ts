import type { ValidConnectionFunc } from '@vue-flow/core'
import type { SyncEdge, SyncFlowDocument, SyncNode } from '@vue-flow-sync/shared'
import type { JsonOp } from 'sharedb/lib/client'
import type { FlowNode } from '../domain/graph'

type SectionConnectionValidator = (
  connection: Parameters<ValidConnectionFunc>[0],
  elements?: Parameters<ValidConnectionFunc>[1]
) => boolean

export type ClientBounds = {
  left: number
  top: number
  right: number
  bottom: number
}

export type FlowEditorServices = {
  closeContextMenu: () => void
  deleteNodesById: (nodeIds: string[]) => void
  documentMatchesLocal: (document: SyncFlowDocument) => boolean
  duplicateNodesById: (nodeIds: string[], count?: number) => void
  getCurrentSyncEdges: (nodes?: SyncNode[]) => SyncEdge[]
  getCurrentSyncNodes: () => SyncNode[]
  getSelectedClientBounds: () => ClientBounds | null
  getSelectedNodeIds: () => string[]
  getSyncNodeById: (nodeId?: string | null) => SyncNode | undefined
  isCanvasSelectionTarget: (target: EventTarget | null) => boolean
  isValidSectionConnection: SectionConnectionValidator
  scheduleCursorUpdate: (position: { x: number, y: number }) => void
  scheduleGraphSnapshot: (delay?: number) => void
  scheduleSelectionBoundsRefresh: () => void
  selectOnlyNode: (nodeId: string) => void
  submitGraphReplacement: (nodes: SyncNode[], edges: SyncEdge[]) => void
  submitGraphSnapshot: () => void
  submitOperation: (operation: JsonOp[]) => void
  updatePresenceSelection: () => void
  withSelectionState: (nodes: FlowNode[]) => FlowNode[]
}

const notReady = (name: keyof FlowEditorServices) => {
  return () => {
    throw new Error(`Flow editor service "${name}" was used before initialization.`)
  }
}

export const createFlowEditorServices = () : FlowEditorServices => {
  return {
    closeContextMenu: notReady('closeContextMenu'),
    deleteNodesById: notReady('deleteNodesById'),
    documentMatchesLocal: notReady('documentMatchesLocal'),
    duplicateNodesById: notReady('duplicateNodesById'),
    getCurrentSyncEdges: notReady('getCurrentSyncEdges'),
    getCurrentSyncNodes: notReady('getCurrentSyncNodes'),
    getSelectedClientBounds: notReady('getSelectedClientBounds'),
    getSelectedNodeIds: notReady('getSelectedNodeIds'),
    getSyncNodeById: notReady('getSyncNodeById'),
    isCanvasSelectionTarget: notReady('isCanvasSelectionTarget'),
    isValidSectionConnection: notReady('isValidSectionConnection'),
    scheduleCursorUpdate: notReady('scheduleCursorUpdate'),
    scheduleGraphSnapshot: notReady('scheduleGraphSnapshot'),
    scheduleSelectionBoundsRefresh: notReady('scheduleSelectionBoundsRefresh'),
    selectOnlyNode: notReady('selectOnlyNode'),
    submitGraphReplacement: notReady('submitGraphReplacement'),
    submitGraphSnapshot: notReady('submitGraphSnapshot'),
    submitOperation: notReady('submitOperation'),
    updatePresenceSelection: notReady('updatePresenceSelection'),
    withSelectionState: notReady('withSelectionState')
  }
}
