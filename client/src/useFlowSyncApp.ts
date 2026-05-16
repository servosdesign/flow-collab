import {
  ConnectionLineType,
  ConnectionMode,
  MarkerType,
  useVueFlow
} from "@vue-flow/core";
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted } from "vue";
import type { SyncPresenceUser } from "@vue-flow-sync/shared";
import SectionThroughEdge from "./components/SectionThroughEdge.vue";
import { createFlowAppState } from "./flowState";
import { installActions, type FlowRuntime as RuntimeContext } from "./flowRuntime";
import type { FlowNode } from "./graph";
import { connectFlowDocument } from "./realtime";
import { useConnections } from "./useConnections";
import { useContextMenu } from "./useContextMenu";
import { useGraphState } from "./useGraphState";
import { useNodeActions } from "./useNodeActions";
import { usePresence } from "./usePresence";
import { useRealtimeSync } from "./useRealtimeSync";
import { useResize } from "./useResize";
import { useSelection } from "./useSelection";
import { useViewport } from "./useViewport";

export function useFlowSyncApp() {
  const state = createFlowAppState();
  const {
    authMessage,
    canvasPanel,
    contextTarget,
    currentViewport,
    duplicateCount,
    edges,
    errorMessage,
    flowDocument,
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
    presenceDocument,
    rightSelection,
    status,
    userId
  } = state;
  const vueFlow = useVueFlow();
  const { addEdges, fitView, screenToFlowCoordinate, setViewport, toObject } = vueFlow;
  const edgeTypes = {
    "section-through": markRaw(SectionThroughEdge)
  };
  const runtime: RuntimeContext = {
    ...vueFlow,
    ...state,
    addEdges,
    fitView,
    screenToFlowCoordinate,
    setViewport,
    toObject,
    edgeTypes,
    actions: {}
  };

  const graphState = installActions(runtime, useGraphState(runtime));
  const {
    isValidSectionConnection
  } = graphState;
  const viewport = installActions(runtime, useViewport(runtime));
  const {
    cleanupViewport,
    handleViewportMove,
    updateCanvasSize
  } = viewport;
  const realtime = installActions(runtime, useRealtimeSync(runtime));
  const {
    applyFlowDocument,
    cleanupRealtimeSync,
    documentMatchesLocal,
    scheduleGraphSnapshot
  } = realtime;
  const resize = installActions(runtime, useResize(runtime));
  const {
    cleanupResize,
    resizeNode,
    resizeNodePreview,
    startNodeResize
  } = resize;
  const nodeActions = installActions(runtime, useNodeActions(runtime));
  const {
    addNodePort,
    handleCreateDragStart,
    handleCreateDrop,
    handleNodeDrag,
    handleNodeDragStop,
    handlePaneClick,
    handleSelectionDrag,
    handleSelectionDragStop,
    sanitizeSectionMembership,
    setCreateMode,
    submitNodeData,
    uploadImage
  } = nodeActions;
  const selection = installActions(runtime, useSelection(runtime));
  const {
    cleanupSelection,
    handleCanvasPointerDown,
    handleCanvasPointerLeave,
    handleCanvasPointerMove,
    handleEdgeClick,
    handleKeyDown,
    handleNodeClick,
    handleNodeDragStart,
    handleNodesChange,
    handleSelectedBoundsPointerDown,
    isNodeSelected,
    isSingleNodeSelection,
    lassoPreviewRects,
    selectedBoundsStyle
  } = selection;
  const contextMenu = installActions(runtime, useContextMenu(runtime));
  const {
    closeContextMenu,
    deleteContextTarget,
    duplicateContextTarget,
    duplicateCountValue,
    handleCanvasContextMenu,
    openEdgeContextMenu,
    openNodeContextMenu,
    openNodeMenuButton,
    openSelectedBoundsContextMenu,
    openSelectionContextMenu,
    selectedLabel
  } = contextMenu;
  const presence = installActions(runtime, usePresence(runtime));
  const {
    applyPresenceDocument,
    cleanupPresence,
    getCursorStyle,
    getLocalPresenceUser,
    joinPresence,
    logoutUser,
    remoteCursors,
    removePresenceUser,
    submitPresenceUser,
    visibleCollaborators
  } = presence;
  const connections = installActions(runtime, useConnections(runtime));
  const {
    handleConnect,
    handleEdgeUpdate
  } = connections;

  const nodeCount = computed(() => nodes.value.length);
  const edgeCount = computed(() => edges.value.length);
  const hasError = computed(() => errorMessage.value.length > 0);
  const emptySelectedUsers: SyncPresenceUser[] = [];
  const selectedUsersByNodeId = computed(() => {
    const byNodeId = new Map<string, SyncPresenceUser[]>();

    visibleCollaborators.value.forEach((user) => {
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

    return byNodeId;
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
    if ((node.id && isNodeSelected(node.id)) || node.selected) {
      return "#dbeafe";
    }

    return node.type === "section" ? "#d1fae5" : "#f8fafc";
  }

  function getMiniMapNodeStroke(node: { id?: string; type?: string; selected?: boolean }) {
    if ((node.id && isNodeSelected(node.id)) || node.selected) {
      return "#1a73e8";
    }

    return node.type === "section" ? "#0f766e" : "#94a3b8";
  }

  function shouldShowNodeResizer(nodeId: string) {
    return !isLassoSelecting.value && isSingleNodeSelection.value && isNodeSelected(nodeId);
  }

  function getNodeResizerZoom(nodeId: string) {
    if (!shouldShowNodeResizer(nodeId)) {
      return undefined;
    }

    return currentViewport.value.zoom;
  }

  function handleViewportMoveEnd(payload?: Parameters<typeof handleViewportMove>[0]) {
    handleViewportMove(payload);
    scheduleGraphSnapshot(500);
  }

  onMounted(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("beforeunload", removePresenceUser);
    window.addEventListener("resize", updateCanvasSize);
    nextTick(updateCanvasSize);

    const realtimeConnection = connectFlowDocument();
    flowDocument.value = realtimeConnection.document;
    presenceDocument.value = realtimeConnection.presenceDocument;
    state.closeRealtime.value = realtimeConnection.close;

    realtimeConnection.document.subscribe((error?: Error) => {
      if (error) {
        errorMessage.value = error.message;
        status.value = "Error";
        return;
      }

      applyFlowDocument(realtimeConnection.document.data, true);
      status.value = "Live";
      nextTick(sanitizeSectionMembership);

      realtimeConnection.document.on("op", (_operation, source) => {
        if (source === state.localSource || documentMatchesLocal(realtimeConnection.document.data)) {
          return;
        }

        applyFlowDocument(realtimeConnection.document.data);
        status.value = "Live";
      });
    });

    realtimeConnection.presenceDocument.subscribe((error?: Error) => {
      if (error) {
        errorMessage.value = error.message;
        status.value = "Error";
        return;
      }

      applyPresenceDocument(realtimeConnection.presenceDocument.data);
      if (isLoggedIn.value) {
        submitPresenceUser(getLocalPresenceUser());
      }

      realtimeConnection.presenceDocument.on("op", () => {
        applyPresenceDocument(realtimeConnection.presenceDocument.data);
      });
    });
  });

  onBeforeUnmount(() => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("beforeunload", removePresenceUser);
    window.removeEventListener("resize", updateCanvasSize);
    cleanupSelection();
    cleanupViewport();
    cleanupRealtimeSync();
    cleanupResize();
    cleanupPresence();
    state.closeRealtime.value?.();
  });

  return {
    addNodePort,
    authMessage,
    canvasPanel,
    closeContextMenu,
    ConnectionLineType,
    ConnectionMode,
    contextTarget,
    currentViewport,
    deleteContextTarget,
    duplicateContextTarget,
    duplicateCount,
    duplicateCountValue,
    edgeCount,
    edges,
    edgeTypes,
    errorMessage,
    getCursorStyle,
    getMiniMapNodeColor,
    getMiniMapNodeStroke,
    getNodeResizerZoom,
    getSelectedUsersForNode,
    handleCanvasContextMenu,
    handleCanvasPointerDown,
    handleCanvasPointerLeave,
    handleCanvasPointerMove,
    handleConnect,
    handleCreateDragStart,
    handleCreateDrop,
    handleEdgeUpdate,
    handleEdgeClick,
    handleNodeClick,
    handleNodeDragStart,
    handleNodeDrag,
    handleNodeDragStop,
    handleNodesChange,
    handlePaneClick,
    handleSelectedBoundsPointerDown,
    handleSelectionDrag,
    handleSelectionDragStop,
    handleViewportMove,
    handleViewportMoveEnd,
    hasError,
    isValidSectionConnection,
    isFlowLoading,
    isLoggedIn,
    isMovingSelection,
    isHoveringSelection,
    isLassoSelecting,
    isResizingNode,
    isNodeSelected,
    isSingleNodeSelection,
    lassoPreviewRects,
    joinPresence,
    loginNameInput,
    loginPasswordInput,
    logoutUser,
    MarkerType,
    nodeCount,
    nodes: nodes as typeof nodes & { value: FlowNode[] },
    openEdgeContextMenu,
    openNodeContextMenu,
    openNodeMenuButton,
    openSelectedBoundsContextMenu,
    openSelectionContextMenu,
    pendingCreate,
    remoteCursors,
    resizeNode,
    resizeNodePreview,
    rightSelection,
    scheduleGraphSnapshot,
    selectedBoundsStyle,
    selectedLabel,
    setCreateMode,
    shouldShowNodeResizer,
    startNodeResize,
    status,
    submitNodeData,
    uploadImage,
    userInitials,
    visibleCollaborators
  };
}
