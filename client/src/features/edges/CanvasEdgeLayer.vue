<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useFlowGraphContext } from '../../app/flowEditorContext'
import type { FlowEdge } from '../../domain/graph'

defineProps<{
  edges: FlowEdge[]
}>()

const mainCanvas = ref<HTMLCanvasElement | null>(null)
const previewCanvas = ref<HTMLCanvasElement | null>(null)

const { canvasEdges } = useFlowGraphContext()

watch(
  mainCanvas,
  (canvas) => canvasEdges.elements.setMainCanvas(canvas),
  { flush: 'post', immediate: true }
)

watch(
  previewCanvas,
  (canvas) => canvasEdges.elements.setPreviewCanvas(canvas),
  { flush: 'post', immediate: true }
)

onBeforeUnmount(() => {
  canvasEdges.elements.setMainCanvas(null)
  canvasEdges.elements.setPreviewCanvas(null)
})
</script>

<template>
  <canvas
    ref="mainCanvas"
    class="canvas-edge-layer"
    aria-hidden="true"
  />
  <canvas
    ref="previewCanvas"
    class="canvas-edge-preview-layer"
    aria-hidden="true"
  />
  <div class="canvas-edge-a11y-list">
    <button
      v-for="edge in edges"
      :key="edge.id"
      type="button"
      :aria-label="`Edge from ${edge.source} to ${edge.target}`"
      @click="canvasEdges.accessibility.selectEdge(edge.id)"
      @focus="canvasEdges.accessibility.selectEdge(edge.id)"
    />
  </div>
</template>
