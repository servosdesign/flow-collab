<script setup lang="ts">
import { usePresenceCursorContext } from "../../app/flowEditorContext";

const { getCursorStyle, remoteCursors } = usePresenceCursorContext();
</script>

<template>
  <div
    v-for="user in remoteCursors"
    :key="user.id"
    class="remote-cursor"
    :style="getCursorStyle(user)"
  >
    <span class="cursor-pointer"></span>
    <span class="cursor-label">{{ user.name }}</span>
  </div>
</template>
