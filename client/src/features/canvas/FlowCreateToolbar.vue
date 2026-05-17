<script setup lang="ts">
import { FolderPlus, PlusSquare } from '@lucide/vue'
import { useTopBarContext } from '../../app/flowEditorContext'

const {
  handleCreateDragStart,
  isFlowLoading,
  isLoggedIn,
  isResettingFlow,
  pendingCreate,
  setCreateMode
} = useTopBarContext()
</script>

<template>
  <div
    v-if="isLoggedIn && !isFlowLoading && !isResettingFlow"
    class="create-toolbar"
    aria-label="Create nodes"
  >
    <button
      type="button"
      class="create-toolbar-button"
      :class="{ active: pendingCreate === 'section' }"
      draggable="true"
      title="Create section"
      @click.stop="setCreateMode('section')"
      @dragstart="handleCreateDragStart('section', $event)"
    >
      <FolderPlus
        :size="18"
        aria-hidden="true"
      />
      <span>Section</span>
    </button>
    <button
      type="button"
      class="create-toolbar-button"
      :class="{ active: pendingCreate === 'item' }"
      draggable="true"
      title="Create node"
      @click.stop="setCreateMode('item')"
      @dragstart="handleCreateDragStart('item', $event)"
    >
      <PlusSquare
        :size="18"
        aria-hidden="true"
      />
      <span>Node</span>
    </button>
  </div>
</template>
