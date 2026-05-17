<script setup lang="ts">
import FlowCanvas from '../features/canvas/FlowCanvas.vue'
import TopBar from '../features/topbar/TopBar.vue'
import { provideFlowEditorContexts } from './flowEditorContext'
import { useFlowEditor } from './useFlowEditor'

const editor = useFlowEditor()
provideFlowEditorContexts(editor)
const { closeContextMenu, isLoggedIn } = editor.shell
</script>

<template>
  <div
    class="app-shell"
    :class="{ 'logged-out': !isLoggedIn }"
    @click="closeContextMenu"
  >
    <TopBar />
    <main class="workspace">
      <FlowCanvas />
    </main>
  </div>
</template>
