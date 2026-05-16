<script setup lang="ts">
import { MiniMap } from "@vue-flow/minimap";
import "@vue-flow/minimap/dist/style.css";
import { useMiniMapContext } from "../../app/flowEditorContext";

const {
  getMiniMapNodeColor,
  getMiniMapNodeStroke,
  isLoggedIn
} = useMiniMapContext();
</script>

<template>
  <MiniMap
    :pannable="isLoggedIn"
    :zoomable="isLoggedIn"
    position="bottom-right"
    :node-color="getMiniMapNodeColor"
    :node-stroke-color="getMiniMapNodeStroke"
    :node-stroke-width="4"
  />
</template>
