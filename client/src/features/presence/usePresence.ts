import { computed } from "vue";
import type { SyncPresenceDocument, SyncPresenceUser } from "@vue-flow-sync/shared";
import { loginUser } from "../../api";
import type { FlowEditorServices } from "../../app/flowEditorServices";
import { cloneJson, type FlowNode } from "../../domain/graph";
import { randomUserColor } from "../../flowState";
import type { FlowRuntime } from "../../flowRuntime";

export function usePresence(runtime: FlowRuntime, services: FlowEditorServices) {
  let cachedSelectedNodeIdSource: Set<string> | null = null;
  let cachedSelectedNodeIds: string[] = [];

  const visibleCollaborators = computed(() =>
    runtime.collaborators.value
      .filter((user) => Date.now() - user.updatedAt < 45_000)
      .sort((left, right) => left.name.localeCompare(right.name))
  );

  const remoteCursors = computed(() =>
    visibleCollaborators.value.filter((user) => {
      if (user.id === runtime.userId.value || !user.cursor || !runtime.isLoggedIn.value) {
        return false;
      }

      const x = user.cursor.x * runtime.currentViewport.value.zoom + runtime.currentViewport.value.x;
      const y = user.cursor.y * runtime.currentViewport.value.zoom + runtime.currentViewport.value.y;

      return (
        x >= 0 &&
        y >= 0 &&
        x <= runtime.canvasSize.value.width &&
        y <= runtime.canvasSize.value.height
      );
    })
  );

  function getCursorStyle(user: SyncPresenceUser) {
    const cursor = user.cursor ?? { x: 0, y: 0 };

    return {
      left: `${cursor.x * runtime.currentViewport.value.zoom + runtime.currentViewport.value.x}px`,
      top: `${cursor.y * runtime.currentViewport.value.zoom + runtime.currentViewport.value.y}px`,
      "--cursor-color": user.color
    };
  }

  function applyPresenceDocument(document?: SyncPresenceDocument | null) {
    if (!document?.users) {
      runtime.collaborators.value = [];
      return;
    }

    runtime.collaborators.value = Object.values(cloneJson(document).users ?? {});
  }

  function getPresenceDocumentData() {
    const document = runtime.presenceDocument.value;

    if (!document?.data?.users) {
      return null;
    }

    return {
      document,
      data: document.data
    };
  }

  function submitPresenceUser(user: SyncPresenceUser) {
    const presence = getPresenceDocumentData();

    if (!presence) {
      return;
    }

    const oldUser = presence.data.users[user.id];
    const operation = oldUser
      ? {
          p: ["users", user.id],
          od: oldUser,
          oi: user
        }
      : {
          p: ["users", user.id],
          oi: user
        };

    presence.document.submitOp([operation], { source: runtime.localSource });
  }

  function getPresenceSelectedNodeIds() {
    const selectedNodeIdSource = runtime.selectedNodeIds.value;

    if (cachedSelectedNodeIdSource !== selectedNodeIdSource) {
      cachedSelectedNodeIdSource = selectedNodeIdSource;
      cachedSelectedNodeIds = Array.from(selectedNodeIdSource);
    }

    return cachedSelectedNodeIds;
  }

  function getLocalPresenceUser(cursor = runtime.timers.pendingCursor): SyncPresenceUser {
    return {
      id: runtime.userId.value,
      name: runtime.userName.value.trim(),
      color: runtime.userColor.value,
      cursor: cursor ? { x: cursor.x, y: cursor.y } : undefined,
      selectedNodeIds: getPresenceSelectedNodeIds(),
      updatedAt: Date.now()
    };
  }

  function updatePresenceSelection() {
    if (!runtime.isLoggedIn.value) {
      return;
    }

    submitPresenceUser(getLocalPresenceUser());
  }

  function removePresenceUser() {
    const presence = getPresenceDocumentData();
    const oldUser = presence?.data.users[runtime.userId.value];

    if (!presence || !oldUser) {
      return;
    }

    presence.document.submitOp(
      [
        {
          p: ["users", runtime.userId.value],
          od: oldUser
        }
      ],
      { source: runtime.localSource }
    );
  }

  function logoutUser() {
    removePresenceUser();
    runtime.userName.value = "";
    runtime.loginPasswordInput.value = "";
    runtime.authMessage.value = "";
    sessionStorage.removeItem("vue-flow-sync-user-id");
    localStorage.removeItem("vue-flow-sync-user-id");
    localStorage.removeItem("vue-flow-sync-user-name");
    localStorage.removeItem("vue-flow-sync-user-color");
    runtime.userId.value = crypto.randomUUID();
    runtime.userColor.value = randomUserColor();
    runtime.selectedNodeIds.value = new Set();
    runtime.nodes.value = services.withSelectionState(runtime.nodes.value as FlowNode[]);
    services.closeContextMenu();
  }

  async function joinPresence() {
    const name = runtime.loginNameInput.value.trim();
    const password = runtime.loginPasswordInput.value;

    if (!name || !password) {
      runtime.authMessage.value = "Enter a username and password.";
      return;
    }

    try {
      runtime.authMessage.value = "";
      const user = await loginUser(name, password);

      runtime.userId.value = user.id;
      runtime.userName.value = user.displayName || user.username;
      runtime.userColor.value = user.color;
      sessionStorage.setItem("vue-flow-sync-user-id", user.id);
      localStorage.setItem("vue-flow-sync-user-id", user.id);
      localStorage.setItem("vue-flow-sync-user-name", runtime.userName.value);
      localStorage.setItem("vue-flow-sync-user-color", user.color);
      submitPresenceUser(getLocalPresenceUser());
    } catch (error) {
      runtime.authMessage.value =
        error instanceof Error ? error.message : "Could not log in.";
    }
  }

  function submitCursorNow() {
    if (!runtime.timers.pendingCursor || !runtime.isLoggedIn.value) {
      return;
    }

    submitPresenceUser(getLocalPresenceUser());
  }

  function scheduleCursorUpdate(position: { x: number; y: number }) {
    if (!runtime.isLoggedIn.value) {
      return;
    }

    const x = Math.round(position.x);
    const y = Math.round(position.y);
    const pendingCursor = runtime.timers.pendingCursor;

    if (pendingCursor) {
      if (pendingCursor.x === x && pendingCursor.y === y) {
        return;
      }

      pendingCursor.x = x;
      pendingCursor.y = y;
    } else {
      runtime.timers.pendingCursor = { x, y };
    }

    if (runtime.timers.cursorCommitTimer) {
      return;
    }

    runtime.timers.cursorCommitTimer = window.setTimeout(() => {
      runtime.timers.cursorCommitTimer = undefined;
      submitCursorNow();
    }, 80);
  }

  function cleanupPresence() {
    window.clearTimeout(runtime.timers.cursorCommitTimer);
    runtime.timers.cursorCommitTimer = undefined;
    removePresenceUser();
  }

  return {
    applyPresenceDocument,
    cleanupPresence,
    getCursorStyle,
    getLocalPresenceUser,
    joinPresence,
    logoutUser,
    remoteCursors,
    removePresenceUser,
    scheduleCursorUpdate,
    submitPresenceUser,
    updatePresenceSelection,
    visibleCollaborators
  };
}
