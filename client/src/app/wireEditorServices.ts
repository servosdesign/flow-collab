import type { useGraphState } from "../domain/graph/useGraphState";
import type { useViewport } from "../features/canvas/useViewport";
import type { useContextMenu } from "../features/context-menu/useContextMenu";
import type { useNodeActions } from "../features/nodes/useNodeActions";
import type { usePresence } from "../features/presence/usePresence";
import type { useRealtimeSync } from "../features/realtime/useRealtimeSync";
import type { useSelection } from "../features/selection/useSelection";
import type { FlowEditorServices } from "./flowEditorServices";

type EditorServiceSources = {
  contextMenu?: ReturnType<typeof useContextMenu>;
  graphState?: ReturnType<typeof useGraphState>;
  nodeActions?: ReturnType<typeof useNodeActions>;
  presence?: ReturnType<typeof usePresence>;
  realtime?: ReturnType<typeof useRealtimeSync>;
  selection?: ReturnType<typeof useSelection>;
  viewport?: ReturnType<typeof useViewport>;
};

export function wireEditorServices(
  services: FlowEditorServices,
  sources: EditorServiceSources
) {
  if (sources.graphState) {
    Object.assign(services, {
      getCurrentSyncEdges: sources.graphState.getCurrentSyncEdges,
      getCurrentSyncNodes: sources.graphState.getCurrentSyncNodes,
      getSyncNodeById: sources.graphState.getSyncNodeById,
      isValidSectionConnection: sources.graphState.isValidSectionConnection,
      withSelectionState: sources.graphState.withSelectionState
    });
  }

  if (sources.viewport) {
    services.scheduleSelectionBoundsRefresh = sources.viewport.scheduleSelectionBoundsRefresh;
  }

  if (sources.realtime) {
    Object.assign(services, {
      documentMatchesLocal: sources.realtime.documentMatchesLocal,
      scheduleGraphSnapshot: sources.realtime.scheduleGraphSnapshot,
      submitGraphReplacement: sources.realtime.submitGraphReplacement,
      submitGraphSnapshot: sources.realtime.submitGraphSnapshot,
      submitOperation: sources.realtime.submitOperation
    });
  }

  if (sources.nodeActions) {
    Object.assign(services, {
      deleteNodesById: sources.nodeActions.deleteNodesById,
      duplicateNodesById: sources.nodeActions.duplicateNodesById
    });
  }

  if (sources.selection) {
    Object.assign(services, {
      getSelectedClientBounds: sources.selection.getSelectedClientBounds,
      getSelectedNodeIds: sources.selection.getSelectedNodeIds,
      isCanvasSelectionTarget: sources.selection.isCanvasSelectionTarget,
      selectOnlyNode: sources.selection.selectOnlyNode
    });
  }

  if (sources.contextMenu) {
    services.closeContextMenu = sources.contextMenu.closeContextMenu;
  }

  if (sources.presence) {
    Object.assign(services, {
      scheduleCursorUpdate: sources.presence.scheduleCursorUpdate,
      updatePresenceSelection: sources.presence.updatePresenceSelection
    });
  }
}
