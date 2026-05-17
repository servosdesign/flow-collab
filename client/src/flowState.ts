import { computed, ref, shallowRef } from 'vue'
import type { FlowNodeKind, FlowViewport, SyncFlowDocument, SyncPresenceDocument, SyncPresenceUser } from '@vue-flow-sync/shared'
import type { ShareDocument } from 'sharedb/lib/client'
import type { FlowEdge, FlowNode } from './graph'
import type { CanvasClientBounds, ContextTarget, DragSelection, FlowAppState } from './flowTypes'

const userColors = ['#0f766e', '#2563eb', '#dc2626', '#9333ea', '#d97706', '#0891b2']

export const createFlowAppState = () : FlowAppState => {
  const savedUserId =
    localStorage.getItem('vue-flow-sync-user-id') ??
    sessionStorage.getItem('vue-flow-sync-user-id')
  const savedName = localStorage.getItem('vue-flow-sync-user-name') ?? ''
  const savedColor = localStorage.getItem('vue-flow-sync-user-color') ?? ''
  const userName = ref(savedName)

  return {
    nodes: shallowRef<FlowNode[]>([]),
    edges: shallowRef<FlowEdge[]>([]),
    contextTarget: ref<ContextTarget | null>(null),
    pendingCreate: ref<FlowNodeKind | null>(null),
    status: ref('Connecting'),
    errorMessage: ref(''),
    isApplyingRemote: ref(false),
    flowDocument: shallowRef<ShareDocument<SyncFlowDocument> | null>(null),
    presenceDocument: shallowRef<ShareDocument<SyncPresenceDocument> | null>(null),
    closeRealtime: shallowRef<(() => void) | null>(null),
    localSource: crypto.randomUUID(),
    currentViewport: ref<FlowViewport>({ x: 80, y: 60, zoom: 0.45 }),
    rightSelection: shallowRef<DragSelection | null>(null),
    selectedNodeIds: shallowRef<Set<string>>(new Set()),
    lassoPreviewNodeIds: shallowRef<Set<string>>(new Set()),
    duplicateCount: ref(1),
    collaborators: ref<SyncPresenceUser[]>([]),
    canvasPanel: ref<HTMLElement | null>(null),
    canvasClientBounds: ref<CanvasClientBounds | null>(null),
    canvasSize: ref({ width: 0, height: 0 }),
    selectionBoundsVersion: ref(0),
    isHoveringSelection: ref(false),
    isMovingSelection: ref(false),
    sectionNodeDragPreview: ref(null),
    isResizingNode: ref(false),
    isLassoSelecting: ref(false),
    userId: ref(savedUserId ?? crypto.randomUUID()),
    userName,
    loginNameInput: ref(savedName),
    loginPasswordInput: ref(''),
    authMessage: ref(''),
    userColor: ref(
      savedColor || userColors[Math.floor(Math.random() * userColors.length)]
    ),
    isFlowLoading: ref(true),
    isLoggedIn: computed(() => userName.value.trim().length > 0),
    timers: {},
    interaction: {
      suppressNextContextMenu: false,
      selectionMoveDrag: null,
      ignoreVueFlowSelectionUntil: 0,
      isRestoringSelection: false
    }
  }
}

export const randomUserColor = () => {
  return userColors[Math.floor(Math.random() * userColors.length)]
}
