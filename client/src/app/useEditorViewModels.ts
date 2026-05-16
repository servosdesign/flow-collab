import {
  ConnectionLineType,
  ConnectionMode,
  MarkerType
} from "@vue-flow/core";
import type { SyncPresenceUser } from "@vue-flow-sync/shared";
import { computed, type Component } from "vue";
import type { FlowNode } from "../domain/graph";
import type { useGraphState } from "../domain/graph/useGraphState";
import type { useViewport } from "../features/canvas/useViewport";
import type { useContextMenu } from "../features/context-menu/useContextMenu";
import type { useConnections } from "../features/edges/useConnections";
import type { useNodeActions } from "../features/nodes/useNodeActions";
import type { useResize } from "../features/nodes/useResize";
import type { usePresence } from "../features/presence/usePresence";
import type { useRealtimeSync } from "../features/realtime/useRealtimeSync";
import type { useSelection } from "../features/selection/useSelection";
import type { FlowAppState } from "../flowTypes";

type EditorViewModelOptions = {
  connections: ReturnType<typeof useConnections>;
  contextMenu: ReturnType<typeof useContextMenu>;
  edgeTypes: Record<string, Component>;
  graphState: ReturnType<typeof useGraphState>;
  nodeActions: ReturnType<typeof useNodeActions>;
  presence: ReturnType<typeof usePresence>;
  realtime: ReturnType<typeof useRealtimeSync>;
  resize: ReturnType<typeof useResize>;
  selection: ReturnType<typeof useSelection>;
  state: FlowAppState;
  viewport: ReturnType<typeof useViewport>;
};

export function useEditorViewModels({
  connections,
  contextMenu,
  edgeTypes,
  graphState,
  nodeActions,
  presence,
  realtime,
  resize,
  selection,
  state,
  viewport
}: EditorViewModelOptions) {
  const {
    authMessage,
    canvasPanel,
    contextTarget,
    currentViewport,
    duplicateCount,
    edges,
    errorMessage,
    isFlowLoading,
    isHoveringSelection,
    isLassoSelecting,
    isLoggedIn,
    isMovingSelection,
    isResizingNode,
    loginNameInput,
    loginPasswordInput,
    nodes,
    pendingCreate,
    status,
    userId
  } = state;
  const nodeCount = computed(() => nodes.value.length);
  const edgeCount = computed(() => edges.value.length);
  const hasError = computed(() => errorMessage.value.length > 0);
  const emptySelectedUsers: SyncPresenceUser[] = [];
  let selectedUsersSignature = "";
  let cachedSelectedUsersByNodeId = new Map<string, SyncPresenceUser[]>();

  const selectedUsersByNodeId = computed(() => {
    const signature = presence.visibleCollaborators.value
      .map((user) =>
        [
          user.id,
          user.name,
          user.color,
          user.selectedNodeIds?.join(",") ?? ""
        ].join("\u0001")
      )
      .join("\u0002");

    if (signature === selectedUsersSignature) {
      return cachedSelectedUsersByNodeId;
    }

    const byNodeId = new Map<string, SyncPresenceUser[]>();

    presence.visibleCollaborators.value.forEach((user) => {
      if (user.id === userId.value) {
        return;
      }

      user.selectedNodeIds?.forEach((nodeId) => {
        const selectedUsers = byNodeId.get(nodeId);

        if (selectedUsers) {
          selectedUsers.push(user);
          return;
        }

        byNodeId.set(nodeId, [user]);
      });
    });

    selectedUsersSignature = signature;
    cachedSelectedUsersByNodeId = byNodeId;

    return cachedSelectedUsersByNodeId;
  });

  function userInitials(name: string) {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");
  }

  function getSelectedUsersForNode(nodeId: string) {
    return selectedUsersByNodeId.value.get(nodeId) ?? emptySelectedUsers;
  }

  function getMiniMapNodeColor(node: { id?: string; type?: string; selected?: boolean }) {
    if ((node.id && selection.isNodeSelected(node.id)) || node.selected) {
      return "#dbeafe";
    }

    return node.type === "section" ? "#d1fae5" : "#f8fafc";
  }

  function getMiniMapNodeStroke(node: { id?: string; type?: string; selected?: boolean }) {
    if ((node.id && selection.isNodeSelected(node.id)) || node.selected) {
      return "#1a73e8";
    }

    return node.type === "section" ? "#0f766e" : "#94a3b8";
  }

  function shouldShowNodeResizer(nodeId: string) {
    return (
      !isLassoSelecting.value &&
      selection.isSingleNodeSelection.value &&
      selection.isNodeSelected(nodeId)
    );
  }

  function getNodeResizerZoom(nodeId: string) {
    if (!shouldShowNodeResizer(nodeId)) {
      return undefined;
    }

    return currentViewport.value.zoom;
  }

  function handleViewportMoveEnd(payload?: Parameters<typeof viewport.handleViewportMove>[0]) {
    viewport.handleViewportMove(payload);
    realtime.scheduleGraphSnapshot(500);
  }

  function handleNodeDragStop(payload: Parameters<typeof nodeActions.handleNodeDragStop>[0]) {
    try {
      nodeActions.handleNodeDragStop(payload);
    } finally {
      selection.handleNodeDragStop();
    }
  }

  return {
    canvas: {
      canvasPanel,
      closeContextMenu: contextMenu.closeContextMenu,
      ConnectionLineType,
      ConnectionMode,
      edges,
      edgeTypes,
      getMiniMapNodeColor,
      getMiniMapNodeStroke,
      handleCanvasContextMenu: contextMenu.handleCanvasContextMenu,
      handleCanvasPointerDown: selection.handleCanvasPointerDown,
      handleCanvasPointerLeave: selection.handleCanvasPointerLeave,
      handleCanvasPointerMove: selection.handleCanvasPointerMove,
      handleConnect: connections.handleConnect,
      handleCreateDrop: nodeActions.handleCreateDrop,
      handleEdgeClick: selection.handleEdgeClick,
      handleEdgeUpdate: connections.handleEdgeUpdate,
      handleNodeClick: selection.handleNodeClick,
      handleNodeDrag: nodeActions.handleNodeDrag,
      handleNodeDragStart: selection.handleNodeDragStart,
      handleNodeDragStop,
      handleNodesChange: selection.handleNodesChange,
      handlePaneClick: nodeActions.handlePaneClick,
      handleSelectionDrag: nodeActions.handleSelectionDrag,
      handleSelectionDragStop: nodeActions.handleSelectionDragStop,
      handleViewportMove: viewport.handleViewportMove,
      handleViewportMoveEnd,
      isHoveringSelection,
      isLoggedIn,
      isMovingSelection,
      isResizingNode,
      isValidSectionConnection: graphState.isValidSectionConnection,
      MarkerType,
      nodes: nodes as typeof nodes & { value: FlowNode[] },
      openEdgeContextMenu: contextMenu.openEdgeContextMenu,
      openNodeContextMenu: contextMenu.openNodeContextMenu,
      openSelectionContextMenu: contextMenu.openSelectionContextMenu
    },
    canvasOverlay: {
      errorMessage,
      hasError,
      isFlowLoading,
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
      isNodeSelected: selection.isNodeSelected,
      openNodeMenuButton: contextMenu.openNodeMenuButton,
      resizeNode: resize.resizeNode,
      resizeNodePreview: resize.resizeNodePreview,
      shouldShowNodeResizer,
      startNodeResize: resize.startNodeResize,
      submitNodeData: nodeActions.submitNodeData,
      uploadImage: nodeActions.uploadImage
    },
    presenceCursors: {
      getCursorStyle: presence.getCursorStyle,
      remoteCursors: presence.remoteCursors
    },
    selectionOverlay: {
      handleSelectedBoundsPointerDown: selection.handleSelectedBoundsPointerDown,
      lassoPreviewRects: selection.lassoPreviewRects,
      openSelectedBoundsContextMenu: contextMenu.openSelectedBoundsContextMenu,
      selectedBoundsStyle: selection.selectedBoundsStyle,
      selectionMovePreview: selection.selectionMovePreview
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
      isLoggedIn,
      joinPresence: presence.joinPresence,
      loginNameInput,
      loginPasswordInput,
      logoutUser: presence.logoutUser,
      nodeCount,
      pendingCreate,
      setCreateMode: nodeActions.setCreateMode,
      status,
      userInitials,
      visibleCollaborators: presence.visibleCollaborators
    }
  };
}
