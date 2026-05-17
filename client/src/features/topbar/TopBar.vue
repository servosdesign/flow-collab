<script setup lang="ts">
import { BoxSelect, FolderPlus, LogOut, PlusSquare } from "@lucide/vue";
import { useTopBarContext } from "../../app/flowEditorContext";

const {
  authMessage,
  edgeCount,
  hasError,
  handleCreateDragStart,
  isLoggedIn,
  joinPresence,
  loginNameInput,
  loginPasswordInput,
  logoutUser,
  nodeCount,
  pendingCreate,
  setCreateMode,
  status,
  userInitials,
  visibleCollaborators
} = useTopBarContext();
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <BoxSelect :size="20" aria-hidden="true" />
      <span>Vue Flow Sync</span>
      <span class="status-pill" :class="{ error: hasError }">{{ status }}</span>
    </div>

    <div class="metrics" aria-label="Flow counts">
      <span>{{ nodeCount }} nodes</span>
      <span>{{ edgeCount }} edges</span>
    </div>

    <form v-if="!isLoggedIn" class="login-tools" @submit.prevent="joinPresence">
      <input
        v-model="loginNameInput"
        class="login-input"
        type="text"
        autocomplete="name"
        placeholder="Username"
      />
      <input
        v-model="loginPasswordInput"
        class="login-input password-input"
        type="password"
        autocomplete="current-password"
        placeholder="Password"
      />
      <button type="submit" class="login-button">Login</button>
      <span v-if="authMessage" class="auth-message">{{ authMessage }}</span>
    </form>

    <div v-else class="presence-tools" aria-label="Connected users">
      <span
        v-for="user in visibleCollaborators"
        :key="user.id"
        v-memo="[user.id, user.name, user.color]"
        class="user-chip"
        :title="user.name"
        :style="{ backgroundColor: user.color }"
      >
        {{ userInitials(user.name) }}
      </span>
      <button type="button" class="logout-button" title="Logout" @click.stop="logoutUser">
        <LogOut :size="15" aria-hidden="true" />
        <span>Logout</span>
      </button>
    </div>

    <div v-if="isLoggedIn" class="create-tools" aria-label="Create nodes">
      <button
        type="button"
        class="create-button"
        :class="{ active: pendingCreate === 'section' }"
        draggable="true"
        title="Create section"
        @click.stop="setCreateMode('section')"
        @dragstart="handleCreateDragStart('section', $event)"
      >
        <FolderPlus :size="18" aria-hidden="true" />
        <span>Section</span>
      </button>
      <button
        type="button"
        class="create-button"
        :class="{ active: pendingCreate === 'item' }"
        draggable="true"
        title="Create node"
        @click.stop="setCreateMode('item')"
        @dragstart="handleCreateDragStart('item', $event)"
      >
        <PlusSquare :size="18" aria-hidden="true" />
        <span>Node</span>
      </button>
    </div>
  </header>
</template>
