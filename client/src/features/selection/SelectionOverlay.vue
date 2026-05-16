<script setup lang="ts">
import { useSelectionOverlayContext } from "../../app/flowEditorContext";

const {
  handleSelectedBoundsPointerDown,
  lassoPreviewRects,
  openSelectedBoundsContextMenu,
  selectedBoundsStyle,
  selectionMovePreview
} = useSelectionOverlayContext();
</script>

<template>
  <div v-if="lassoPreviewRects.length" class="lasso-preview-layer" aria-hidden="true">
    <span
      v-for="rect in lassoPreviewRects"
      :key="rect.id"
      class="lasso-preview-node"
      :style="rect.style"
    ></span>
  </div>

  <div
    v-if="selectedBoundsStyle"
    class="selected-nodes-outline"
    :class="{ 'selection-preview-active': selectionMovePreview.active }"
    :style="selectedBoundsStyle"
    @pointerdown="handleSelectedBoundsPointerDown"
    @contextmenu="openSelectedBoundsContextMenu"
  >
    <div
      v-if="selectionMovePreview.active"
      class="selection-move-preview-content"
      aria-hidden="true"
    >
      <span
        v-for="shape in selectionMovePreview.shapes"
        :key="shape"
        class="selection-move-preview-shape"
      ></span>
      <strong class="selection-move-preview-count">
        <span>{{ selectionMovePreview.count }}</span>
        <small>nodes</small>
      </strong>
    </div>
    <span
      class="selected-bounds-hit selected-bounds-hit-top"
      @pointerdown="handleSelectedBoundsPointerDown"
      @contextmenu="openSelectedBoundsContextMenu"
    ></span>
    <span
      class="selected-bounds-hit selected-bounds-hit-right"
      @pointerdown="handleSelectedBoundsPointerDown"
      @contextmenu="openSelectedBoundsContextMenu"
    ></span>
    <span
      class="selected-bounds-hit selected-bounds-hit-bottom"
      @pointerdown="handleSelectedBoundsPointerDown"
      @contextmenu="openSelectedBoundsContextMenu"
    ></span>
    <span
      class="selected-bounds-hit selected-bounds-hit-left"
      @pointerdown="handleSelectedBoundsPointerDown"
      @contextmenu="openSelectedBoundsContextMenu"
    ></span>
  </div>
</template>
