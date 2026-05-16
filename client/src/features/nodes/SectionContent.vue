<script setup lang="ts">
import { Image, MoreVertical } from "@lucide/vue";
import type { SyncNodeData } from "@vue-flow-sync/shared";

const props = defineProps<{
  data: SyncNodeData;
}>();

const emit = defineEmits<{
  "update-title": [value: string];
  "update-body": [value: string];
  "upload-image": [file: File];
  "open-menu": [event: MouseEvent];
  "add-port": [];
}>();

function titleValue() {
  return props.data.title ?? props.data.text ?? "Section";
}

function bodyValue() {
  return props.data.body ?? props.data.text ?? "";
}

function bodyRows() {
  const body = bodyValue();
  const wrappedRows = body
    .split("\n")
    .reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / 42)), 0);

  return Math.max(1, wrappedRows);
}

function handleTitleInput(event: Event) {
  emit("update-title", (event.target as HTMLInputElement).value);
}

function handleBodyInput(event: Event) {
  emit("update-body", (event.target as HTMLTextAreaElement).value);
}

function handleUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (file) {
    emit("upload-image", file);
  }

  input.value = "";
}
</script>

<template>
  <div class="node-header">
    <span class="section-badge">Section</span>
    <input
      class="node-title-input nodrag nopan"
      :value="titleValue()"
      @input.stop="handleTitleInput"
      @mousedown.stop
      @pointerdown.stop
      @touchstart.stop
      @dragstart.prevent
    />
    <button
      class="node-menu-button"
      type="button"
      title="Section actions"
      @click.stop="emit('open-menu', $event)"
      @pointerdown.stop
    >
      <MoreVertical :size="16" aria-hidden="true" />
    </button>
  </div>
  <div class="node-divider"></div>
  <div class="node-body section-body">
    <textarea
      class="node-input node-textarea section-input nodrag nopan"
      :value="bodyValue()"
      :rows="bodyRows()"
      @input.stop="handleBodyInput"
      @mousedown.stop
      @pointerdown.stop
      @touchstart.stop
      @dragstart.prevent
    />
  </div>
  <div class="node-tools">
    <label class="image-picker" title="Upload image">
      <Image :size="15" aria-hidden="true" />
      <input type="file" accept="image/*" @change="handleUpload" />
    </label>
  </div>
  <img v-if="data.imageUrl" class="node-image section-image" :src="data.imageUrl" alt="" />
</template>
