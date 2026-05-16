import { nextTick, onBeforeUnmount, onMounted } from "vue";
import { connectFlowDocument } from "../realtime";
import type { FlowAppState } from "../flowTypes";
import type { useViewport } from "../features/canvas/useViewport";
import type { useNodeActions } from "../features/nodes/useNodeActions";
import type { usePresence } from "../features/presence/usePresence";
import type { useRealtimeSync } from "../features/realtime/useRealtimeSync";
import type { useResize } from "../features/nodes/useResize";
import type { useSelection } from "../features/selection/useSelection";

type EditorLifecycleOptions = {
  nodeActions: ReturnType<typeof useNodeActions>;
  presence: ReturnType<typeof usePresence>;
  realtime: ReturnType<typeof useRealtimeSync>;
  resize: ReturnType<typeof useResize>;
  selection: ReturnType<typeof useSelection>;
  state: FlowAppState;
  viewport: ReturnType<typeof useViewport>;
};

export function useEditorLifecycle({
  nodeActions,
  presence,
  realtime,
  resize,
  selection,
  state,
  viewport
}: EditorLifecycleOptions) {
  const {
    errorMessage,
    flowDocument,
    isLoggedIn,
    presenceDocument,
    status
  } = state;

  onMounted(() => {
    window.addEventListener("keydown", selection.handleKeyDown);
    window.addEventListener("beforeunload", presence.removePresenceUser);
    window.addEventListener("resize", viewport.updateCanvasSize);
    nextTick(viewport.updateCanvasSize);

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

      realtime.applyFlowDocument(realtimeConnection.document.data, true);
      status.value = "Live";
      nextTick(nodeActions.sanitizeSectionMembership);

      realtimeConnection.document.on("op", (_operation, source) => {
        if (
          source === state.localSource ||
          realtime.documentMatchesLocal(realtimeConnection.document.data)
        ) {
          return;
        }

        realtime.applyFlowDocument(realtimeConnection.document.data);
        status.value = "Live";
      });
    });

    realtimeConnection.presenceDocument.subscribe((error?: Error) => {
      if (error) {
        errorMessage.value = error.message;
        status.value = "Error";
        return;
      }

      presence.applyPresenceDocument(realtimeConnection.presenceDocument.data);
      if (isLoggedIn.value) {
        presence.submitPresenceUser(presence.getLocalPresenceUser());
      }

      realtimeConnection.presenceDocument.on("op", () => {
        presence.applyPresenceDocument(realtimeConnection.presenceDocument.data);
      });
    });
  });

  onBeforeUnmount(() => {
    window.removeEventListener("keydown", selection.handleKeyDown);
    window.removeEventListener("beforeunload", presence.removePresenceUser);
    window.removeEventListener("resize", viewport.updateCanvasSize);
    selection.cleanupSelection();
    viewport.cleanupViewport();
    realtime.cleanupRealtimeSync();
    resize.cleanupResize();
    presence.cleanupPresence();
    state.closeRealtime.value?.();
  });
}
