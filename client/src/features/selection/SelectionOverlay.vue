<script setup lang="ts">
import { useSelectionOverlayContext } from "../../app/flowEditorContext";

const {
  handleSelectedBoundsPointerDown,
  lassoPreviewRects,
  openSelectedBoundsContextMenu,
  selectedBoundsStyle,
  selectionMovePreview
} = useSelectionOverlayContext();

function createForwardedWheelEvent(event: WheelEvent) {
  return new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaZ: event.deltaZ,
    deltaMode: event.deltaMode,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    button: event.button,
    buttons: event.buttons,
    relatedTarget: event.relatedTarget,
    view: window
  });
}

function handleSelectedBoundsWheel(event: WheelEvent) {
  const overlay = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;

  if (!overlay) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const previousPointerEvents = overlay.style.pointerEvents;
  overlay.style.pointerEvents = "none";
  const target =
    document.elementFromPoint(event.clientX, event.clientY) ??
    overlay.parentElement?.querySelector(".flow-canvas");
  overlay.style.pointerEvents = previousPointerEvents;

  if (!target || target === overlay || overlay.contains(target)) {
    return;
  }

  target.dispatchEvent(createForwardedWheelEvent(event));
}
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
    @wheel="handleSelectedBoundsWheel"
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
