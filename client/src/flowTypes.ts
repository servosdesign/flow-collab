import type {
  FlowViewport,
  SyncFlowDocument,
  SyncNode,
  SyncPresenceDocument,
  SyncPresenceUser
} from "@vue-flow-sync/shared";
import type { NodeDragItem } from "@vue-flow/core";
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

export type CanvasClientBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type SelectionMoveDragMode = "visible" | "bundle";
export type SelectionMovePreviewShapeKind = "item" | "section";

export type SelectionMovePreviewCounts = {
  itemCount: number;
  sectionCount: number;
  containedCount: number;
  containedSectionCount: number;
};

export type SectionDragCandidateBounds = {
  id: string;
  bounds: { x: number; y: number; width: number; height: number };
  area: number;
};

export type SectionNodeDragPreview = {
  sectionId: string;
  previewCounts: SelectionMovePreviewCounts;
  hiddenIds: Set<string>;
  hideStrategy: "cover";
  showSummary: boolean;
};

export type SelectionMoveRuntimeSnapshot = {
  id: string;
  position: { x: number; y: number };
  hadClass: boolean;
  className?: FlowNode["class"];
  hadComputedPosition: boolean;
  computedPosition?: { x: number; y: number; z?: number };
  hadDragging: boolean;
  dragging?: boolean;
};

export type SelectionMoveDrag = {
  mode: SelectionMoveDragMode;
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  originalSyncNodes: SyncNode[];
  originalSyncNodesById: Map<string, SyncNode>;
  originalPositionsById: Map<string, { x: number; y: number }>;
  runtimeSnapshotsById: Map<string, SelectionMoveRuntimeSnapshot>;
  sectionDragCandidatesById: Map<string, SectionDragCandidateBounds[]>;
  dragItems: NodeDragItem[];
  movingIds: Set<string>;
  movingIndexes: number[];
  hiddenIds: Set<string>;
  previewCounts: SelectionMovePreviewCounts;
  previewShapeKinds: SelectionMovePreviewShapeKind[];
  frame?: number;
  selectedFlowBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
    padding: number;
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
  scheduleSelectionMoveFrame?: () => void;
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
  canvasClientBounds: Ref<CanvasClientBounds | null>;
  canvasSize: Ref<{ width: number; height: number }>;
  selectionBoundsVersion: Ref<number>;
  isHoveringSelection: Ref<boolean>;
  isMovingSelection: Ref<boolean>;
  sectionNodeDragPreview: Ref<SectionNodeDragPreview | null>;
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
