<script setup lang="ts">
import { BoxSelect, LogIn, LogOut, RotateCcw } from '@lucide/vue'
import { ref, watch } from 'vue'
import { useTopBarContext } from '../../app/flowEditorContext'

const {
  authMessage,
  edgeCount,
  hasError,
  isFlowLoading,
  isLoggedIn,
  isResettingFlow,
  joinPresence,
  loginNameInput,
  loginPasswordInput,
  logoutUser,
  nodeCount,
  resetFlowToSeed,
  status,
  userInitials,
  visibleCollaborators
} = useTopBarContext()

const isLoginDialogOpen = ref(false)
const isResetDialogOpen = ref(false)

watch(
  isLoggedIn,
  (loggedIn) => {
    isLoginDialogOpen.value = !loggedIn
  },
  { immediate: true }
)

const openLoginDialog = () => {
  isLoginDialogOpen.value = true
}

const closeLoginDialog = () => {
  isLoginDialogOpen.value = false
}

const submitLogin = () => {
  void joinPresence()
}

const openResetDialog = () => {
  if (isResettingFlow.value || isFlowLoading.value) {
    return
  }

  isResetDialogOpen.value = true
}

const closeResetDialog = () => {
  isResetDialogOpen.value = false
}

const confirmResetFlow = () => {
  isResetDialogOpen.value = false
  void resetFlowToSeed()
}
</script>

<template>
  <header class="topbar">
    <div class="topbar-brand">
      <div class="brand-mark">
        <BoxSelect
          :size="19"
          aria-hidden="true"
        />
      </div>
      <div class="brand-copy">
        <strong>Flow Collab</strong>
        <span>Shared workspace</span>
      </div>
      <span
        class="status-pill"
        :class="{ error: hasError }"
      >{{ status }}</span>
    </div>

    <div
      class="flow-summary"
      aria-label="Flow counts"
    >
      <span><strong>{{ nodeCount }}</strong> nodes</span>
      <span><strong>{{ edgeCount }}</strong> edges</span>
    </div>

    <div class="topbar-actions">
      <button
        v-if="isLoggedIn"
        type="button"
        class="topbar-button danger"
        :disabled="isResettingFlow || isFlowLoading"
        title="Reset flowchart"
        @click.stop="openResetDialog"
      >
        <RotateCcw
          :size="17"
          aria-hidden="true"
        />
        <span>{{ isResettingFlow ? 'Resetting' : 'Reset' }}</span>
      </button>

      <div
        v-if="isLoggedIn"
        class="presence-tools"
        aria-label="Connected users"
      >
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
      </div>

      <button
        v-if="isLoggedIn"
        type="button"
        class="topbar-button"
        title="Logout"
        @click.stop="logoutUser"
      >
        <LogOut
          :size="15"
          aria-hidden="true"
        />
        <span>Logout</span>
      </button>

      <button
        v-else
        type="button"
        class="topbar-button primary"
        title="Login"
        @click.stop="openLoginDialog"
      >
        <LogIn
          :size="17"
          aria-hidden="true"
        />
        <span>Login</span>
      </button>
    </div>
  </header>

  <Teleport to="body">
    <div
      v-if="!isLoggedIn && isLoginDialogOpen"
      class="dialog-backdrop"
      @click.self="closeLoginDialog"
    >
      <section
        class="app-dialog login-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-dialog-title"
      >
        <header class="dialog-header">
          <div>
            <h2 id="login-dialog-title">
              Login
            </h2>
            <p>Join the shared flow workspace.</p>
          </div>
        </header>

        <form
          class="dialog-form"
          @submit.prevent="submitLogin"
        >
          <label>
            <span>Username</span>
            <input
              v-model="loginNameInput"
              type="text"
              autocomplete="name"
            >
          </label>
          <label>
            <span>Password</span>
            <input
              v-model="loginPasswordInput"
              type="password"
              autocomplete="current-password"
            >
          </label>
          <p
            v-if="authMessage"
            class="dialog-error"
          >
            {{ authMessage }}
          </p>
          <footer class="dialog-actions">
            <button
              type="button"
              class="dialog-button"
              @click="closeLoginDialog"
            >
              Later
            </button>
            <button
              type="submit"
              class="dialog-button primary"
            >
              Login
            </button>
          </footer>
        </form>
      </section>
    </div>

    <div
      v-if="isResetDialogOpen"
      class="dialog-backdrop"
      @click.self="closeResetDialog"
    >
      <section
        class="app-dialog reset-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-dialog-title"
      >
        <header class="dialog-header">
          <div>
            <h2 id="reset-dialog-title">
              Reset Flowchart
            </h2>
            <p>This will replace the current graph with the seeded workspace.</p>
          </div>
        </header>
        <footer class="dialog-actions">
          <button
            type="button"
            class="dialog-button"
            @click="closeResetDialog"
          >
            Cancel
          </button>
          <button
            type="button"
            class="dialog-button danger"
            @click="confirmResetFlow"
          >
            Reset
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
