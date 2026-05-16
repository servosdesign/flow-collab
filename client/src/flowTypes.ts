import type {
  FlowViewport,
  SyncFlowDocument,
  SyncNode,
  SyncPresenceDocument,
  SyncPresenceUser
} from "@vue-flow-sync/shared";
import type { ComputedRef, Ref } from "vue";
import type { ShareDocument } from "sharedb/lib/client";
import type { FlowEdge, FlowNode, ResizeParams } from "./graph";

export type ContextTarget =
  | { kind: "node"; id: string; x: number; y: number }
  | { kind: "edge"; id: string; x: number; y: number }
  | { kind: "selection"; ids: string[]; x: number; y: number };

export type DragSelection = {
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  startLocalX: number;
  startLocalY: number;
  currentLocalX: number;
  currentLocalY: number;
};

export type SelectionMoveDrag = {
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  originalNodes: FlowNode[];
  movingIds: Set<string>;
  movingIndexes: number[];
  frame?: number;
  selectedBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null;
};

export type FlowTimers = {
  graphCommitTimer?: number;
  cursorCommitTimer?: number;
  resizeCommitTimer?: number;
  pendingResizeCommit?: { nodeId: string; params: ResizeParams };
  pendingCursor?: { x: number; y: number };
  selectionBoundsFrame?: number;
  lassoSelectionFrame?: number;
};

export type FlowInteractionState = {
  suppressNextContextMenu: boolean;
  selectionMoveDrag: SelectionMoveDrag | null;
  ignoreVueFlowSelectionUntil: number;
  isRestoringSelection: boolean;
};

export type FlowAppState = {
  nodes: Ref<FlowNode[]>;
  edges: Ref<FlowEdge[]>;
  contextTarget: Ref<ContextTarget | null>;
  pendingCreate: Ref<"section" | "item" | null>;
  status: Ref<string>;
  errorMessage: Ref<string>;
  isApplyingRemote: Ref<boolean>;
  flowDocument: Ref<ShareDocument<SyncFlowDocument> | null>;
  presenceDocument: Ref<ShareDocument<SyncPresenceDocument> | null>;
  closeRealtime: Ref<(() => void) | null>;
  currentViewport: Ref<FlowViewport>;
  rightSelection: Ref<DragSelection | null>;
  selectedNodeIds: Ref<Set<string>>;
  lassoPreviewNodeIds: Ref<Set<string>>;
  duplicateCount: Ref<number>;
  collaborators: Ref<SyncPresenceUser[]>;
  canvasPanel: Ref<HTMLElement | null>;
  canvasSize: Ref<{ width: number; height: number }>;
  selectionBoundsVersion: Ref<number>;
  isHoveringSelection: Ref<boolean>;
  isMovingSelection: Ref<boolean>;
  isResizingNode: Ref<boolean>;
  isLassoSelecting: Ref<boolean>;
  userId: Ref<string>;
  userName: Ref<string>;
  loginNameInput: Ref<string>;
  loginPasswordInput: Ref<string>;
  authMessage: Ref<string>;
  userColor: Ref<string>;
  isFlowLoading: Ref<boolean>;
  isLoggedIn: ComputedRef<boolean>;
  timers: FlowTimers;
  interaction: FlowInteractionState;
  localSource: string;
};
