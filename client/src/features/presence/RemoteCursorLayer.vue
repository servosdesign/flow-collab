<script setup lang="ts">
import { usePresenceCursorContext } from '../../app/flowEditorContext'

const { currentViewport, getCursorStyle, remoteCursors } = usePresenceCursorContext()
</script>

<template>
  <div
    v-for="user in remoteCursors"
    :key="user.id"
    v-memo="[
      user.id,
      user.name,
      user.color,
      user.cursor?.x,
      user.cursor?.y,
      currentViewport.x,
      currentViewport.y,
      currentViewport.zoom
    ]"
    class="remote-cursor"
    :style="getCursorStyle(user)"
  >
    <span class="cursor-pointer" />
    <span class="cursor-label">{{ user.name }}</span>
  </div>
</template>
