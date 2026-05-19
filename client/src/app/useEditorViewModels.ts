import type { SyncPresenceUser } from '@vue-flow-sync/shared'
import { computed, type ComponentPublicInstance } from 'vue'
import type { FlowNode } from '../domain/graph'
import type { useViewport } from '../features/canvas/useViewport'
import type { useContextMenu } from '../features/context-menu/useContextMenu'
import type { useCanvasEdges } from '../features/edges/useCanvasEdges'
import type { useNodeActions } from '../features/nodes/useNodeActions'
import type { useResize } from '../features/nodes/useResize'
import type { usePresence } from '../features/presence/usePresence'
import type { useRealtimeSync } from '../features/realtime/useRealtimeSync'
import type { useSelection } from '../features/selection/useSelection'
import type { FlowAppState } from '../flowTypes'

type EditorViewModelOptions = {
  canvasEdges: ReturnType<typeof useCanvasEdges>
  contextMenu: ReturnType<typeof useContextMenu>
  nodeActions: ReturnType<typeof useNodeActions>
  presence: ReturnType<typeof usePresence>
  realtime: ReturnType<typeof useRealtimeSync>
  resize: ReturnType<typeof useResize>
  selection: ReturnType<typeof useSelection>
  state: FlowAppState
  viewport: ReturnType<typeof useViewport>
}

export const useEditorViewModels = ({
  canvasEdges,
  contextMenu,
  nodeActions,
  presence,
  realtime,
  resize,
  selection,
  state,
  viewport
}: EditorViewModelOptions) => {
  const {
    authMessage,
    canvasPanel,
    contextTarget,
    currentViewport,
    duplicateCount,
    edges,
    errorMessage,
    dropSettleVersion,
    isFlowLoading,
    isDropSettling,
    isHoveringSelection,
    isLassoSelecting,
    isLoggedIn,
    isMovingSelection,
    loginNameInput,
    loginPasswordInput,
    miniMapGeometryVersion,
    nodes,
    pendingCreate,
    selectionMoveHiddenEdgeIds,
    selectionMovePreviewVersion,
    selectedNodeIds,
    status,
    userId
  } = state
  const nodeCount = computed(() => nodes.value.length)
  const edgeCount = computed(() => edges.value.length)
  const hasError = computed(() => errorMessage.value.length > 0)
  const isCanvasLoading = computed(
    () => isFlowLoading.value || realtime.state.isResettingFlow.value
  )
  const emptySelectedUsers: SyncPresenceUser[] = []
  let selectedUsersSignature = ''
  let cachedSelectedUsersByNodeId = new Map<string, SyncPresenceUser[]>()

  const selectedUsersByNodeId = computed(() => {
    const signature = presence.visibleCollaborators.value
      .map((user) =>
        [
          user.id,
          user.name,
          user.color,
          user.selectedNodeIds?.join(',') ?? ''
        ].join('\u0001')
      )
      .join('\u0002')

    if (signature === selectedUsersSignature) {
      return cachedSelectedUsersByNodeId
    }

    const byNodeId = new Map<string, SyncPresenceUser[]>()

    presence.visibleCollaborators.value.forEach((user) => {
      if (user.id === userId.value) {
        return
      }

      user.selectedNodeIds?.forEach((nodeId) => {
        const selectedUsers = byNodeId.get(nodeId)

        if (selectedUsers) {
          selectedUsers.push(user)
          return
        }

        byNodeId.set(nodeId, [user])
      })
    })

    selectedUsersSignature = signature
    cachedSelectedUsersByNodeId = byNodeId

    return cachedSelectedUsersByNodeId
  })

  const userInitials = (name: string) => {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('')
  }

  const getSelectedUsersForNode = (nodeId: string) => {
    return selectedUsersByNodeId.value.get(nodeId) ?? emptySelectedUsers
  }

  const isMiniMapNodeSelected = (node: { id?: string, selected?: boolean }) => {
    return Boolean((node.id && selectedNodeIds.value.has(node.id)) || node.selected)
  }

  const getMiniMapNodeColor = (node: { id?: string, type?: string, selected?: boolean }) => {
    if (isMiniMapNodeSelected(node)) {
      return '#dbeafe'
    }

    return node.type === 'section' ? '#d1fae5' : '#f8fafc'
  }

  const getMiniMapNodeStroke = (node: { id?: string, type?: string, selected?: boolean }) => {
    if (isMiniMapNodeSelected(node)) {
      return '#1a73e8'
    }

    return node.type === 'section' ? '#0f766e' : '#94a3b8'
  }

  const shouldShowNodeResizer = (nodeId: string) => {
    return (
      !isLassoSelecting.value &&
      selection.queries.isSingleNodeSelection.value &&
      selection.queries.isNodeSelected(nodeId)
    )
  }

  const getNodeResizerZoom = (nodeId: string) => {
    if (!shouldShowNodeResizer(nodeId)) {
      return undefined
    }

    return currentViewport.value.zoom
  }

  const handleViewportMoveEnd = (payload?: Parameters<typeof viewport.handleViewportMove>[0]) => {
    viewport.handleViewportMoveEnd(payload)
    realtime.snapshots.scheduleViewportSnapshot(500)
  }

  const handleNodeDragStop = (payload: Parameters<typeof nodeActions.handleNodeDragStop>[0]) => {
    try {
      nodeActions.handleNodeDragStop(payload)
    } finally {
      selection.events.handleNodeDragStop()
    }
  }

  return {
    canvasSurface: {
      setCanvasPanel: (element: Element | ComponentPublicInstance | null) => {
        canvasPanel.value = element instanceof HTMLElement ? element : null
      },
      handleCanvasContextMenu: (event: MouseEvent) => {
        if (canvasEdges.events.handleContextMenu(event)) {
          return
        }

        contextMenu.handleCanvasContextMenu(event)
      },
      handleCanvasPointerDown: (event: PointerEvent) => {
        if (canvasEdges.events.handlePointerDown(event)) {
          return
        }

        selection.events.handleCanvasPointerDown(event)
      },
      handleCanvasPointerLeave: () => {
        canvasEdges.events.handlePointerLeave()
        selection.events.handleCanvasPointerLeave()
      },
      handleCanvasPointerMove: (event: PointerEvent) => {
        if (canvasEdges.events.handlePointerMove(event)) {
          return
        }

        selection.events.handleCanvasPointerMove(event)
      },
      isHoveringSelection,
      isMovingSelection
    },
    flowGraph: {
      canvasEdges,
      edges,
      events: {
        closeContextMenu: contextMenu.closeContextMenu,
        handleCreateDrop: nodeActions.handleCreateDrop,
        handleNodeClick: selection.events.handleNodeClick,
        handleNodeDrag: nodeActions.handleNodeDrag,
        handleNodeDragStart: selection.events.handleNodeDragStart,
        handleNodeDragStop,
        handleNodesChange: selection.events.handleNodesChange,
        handlePaneClick: nodeActions.handlePaneClick,
        handleViewportMove: viewport.handleViewportMove,
        handleViewportMoveEnd,
        openNodeContextMenu: contextMenu.openNodeContextMenu
      },
      isLoggedIn,
      nodes: nodes as typeof nodes & { value: FlowNode[] },
      selectionMoveHiddenEdgeIds,
      selectionMovePreviewVersion,
      getSelectionMoveDrag: () => state.interaction.selectionMoveDrag
    },
    miniMap: {
      dropSettleVersion,
      getMiniMapNodeColor,
      getMiniMapNodeStroke,
      isDropSettling,
      isLoggedIn,
      miniMapGeometryVersion,
      selectedNodeIds
    },
    canvasOverlay: {
      errorMessage,
      hasError,
      isFlowLoading: isCanvasLoading,
      isLoggedIn
    },
    contextMenu: {
      contextTarget,
      deleteContextTarget: contextMenu.deleteContextTarget,
      duplicateContextTarget: contextMenu.duplicateContextTarget,
      duplicateCount,
      duplicateCountValue: contextMenu.duplicateCountValue,
      selectedLabel: contextMenu.selectedLabel
    },
    nodeRenderer: {
      addNodePort: nodeActions.addNodePort,
      getNodeResizerZoom,
      getSelectedUsersForNode,
      isLassoSelecting,
      isLoggedIn,
      isNodeSelected: selection.queries.isNodeVisuallySelected,
      openNodeMenuButton: contextMenu.openNodeMenuButton,
      resizeNode: resize.resizeNode,
      resizeNodePreview: resize.resizeNodePreview,
      shouldShowNodeResizer,
      startNodeResize: resize.startNodeResize,
      submitNodeData: nodeActions.submitNodeData,
      uploadImage: nodeActions.uploadImage
    },
    presenceCursors: {
      currentViewport,
      getCursorStyle: presence.getCursorStyle,
      remoteCursors: presence.remoteCursors
    },
    selectionOverlay: {
      handleSelectionMoveWheel: selection.events.handleSelectionMoveWheel,
      handleSelectedBoundsPointerDown: selection.events.handleSelectedBoundsPointerDown,
      lassoPreviewRects: selection.overlay.lassoPreviewRects,
      openSelectedBoundsContextMenu: contextMenu.openSelectedBoundsContextMenu,
      selectedNodeOutlineRects: selection.overlay.selectedNodeOutlineRects,
      selectedBoundsStyle: selection.overlay.selectedBoundsStyle,
      selectionMovePreview: selection.overlay.selectionMovePreview
    },
    shell: {
      closeContextMenu: contextMenu.closeContextMenu,
      isLoggedIn
    },
    topbar: {
      authMessage,
      edgeCount,
      hasError,
      handleCreateDragStart: nodeActions.handleCreateDragStart,
      isFlowLoading,
      isLoggedIn,
      joinPresence: presence.joinPresence,
      loginNameInput,
      loginPasswordInput,
      logoutUser: presence.logoutUser,
      nodeCount,
      pendingCreate,
      isResettingFlow: realtime.state.isResettingFlow,
      resetFlowToSeed: realtime.commands.resetFlowToSeed,
      setCreateMode: nodeActions.setCreateMode,
      status,
      userInitials,
      visibleCollaborators: presence.visibleCollaborators
    }
  }
}
