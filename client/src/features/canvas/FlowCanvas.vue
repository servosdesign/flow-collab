<script setup lang="ts">
import { useCanvasSurfaceContext } from '../../app/flowEditorContext'
import FlowContextMenu from '../context-menu/FlowContextMenu.vue'
import RemoteCursorLayer from '../presence/RemoteCursorLayer.vue'
import SelectionOverlay from '../selection/SelectionOverlay.vue'
import CanvasOverlays from './CanvasOverlays.vue'
import FlowCreateToolbar from './FlowCreateToolbar.vue'
import FlowGraph from './FlowGraph.vue'

const {
  canvasPanel,
  handleCanvasContextMenu,
  handleCanvasPointerDown,
  handleCanvasPointerLeave,
  handleCanvasPointerMove,
  isHoveringSelection,
  isMovingSelection
} = useCanvasSurfaceContext()
</script>

<template>
  <section
    ref="canvasPanel"
    class="canvas-panel"
    :class="{
      'selection-hover': isHoveringSelection || isMovingSelection
    }"
    aria-label="Shared flow canvas"
    @contextmenu.capture="handleCanvasContextMenu"
    @pointerdown.capture="handleCanvasPointerDown"
    @pointerleave="handleCanvasPointerLeave"
    @pointermove.capture="handleCanvasPointerMove"
  >
    <CanvasOverlays />
    <FlowGraph />
    <FlowCreateToolbar />
    <SelectionOverlay />
    <RemoteCursorLayer />
    <FlowContextMenu />
  </section>
</template>
