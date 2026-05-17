<script setup lang="ts">
import { Image, MoreVertical } from '@lucide/vue'
import { nextTick, onMounted, ref, watch } from 'vue'
import type { SyncNodeData } from '@vue-flow-sync/shared'
import type { NodeBodyUpdate } from './types'

const props = defineProps<{
  data: SyncNodeData
}>()

const emit = defineEmits<{
  'update-title': [value: string]
  'update-body': [update: NodeBodyUpdate]
  'upload-image': [file: File]
  'open-menu': [event: MouseEvent]
  'add-port': []
}>()

const bodyInput = ref<HTMLTextAreaElement | null>(null)

const titleValue = () => {
  return props.data.title ?? props.data.text ?? 'Section'
}

const bodyValue = () => {
  return props.data.body ?? props.data.text ?? ''
}

const measureBodyHeight = (textarea = bodyInput.value) => {
  if (!textarea) {
    return undefined
  }

  textarea.style.height = 'auto'
  const style = window.getComputedStyle(textarea)
  const borderHeight =
    Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth)
  const height = Math.max(30, Math.ceil(textarea.scrollHeight + borderHeight))
  textarea.style.height = `${height}px`

  return height
}

const handleTitleInput = (event: Event) => {
  emit('update-title', (event.target as HTMLInputElement).value)
}

const handleBodyInput = (event: Event) => {
  const textarea = event.target as HTMLTextAreaElement

  emit('update-body', {
    value: textarea.value,
    measuredBodyHeight: measureBodyHeight(textarea)
  })
}

const handleUpload = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  if (file) {
    emit('upload-image', file)
  }

  input.value = ''
}

onMounted(() => {
  measureBodyHeight()
})

watch(
  () => bodyValue(),
  () => {
    nextTick(() => measureBodyHeight())
  }
)
</script>

<template>
  <div class="node-header">
    <span class="section-badge">Section</span>
    <input
      class="node-title-input nodrag nopan"
      data-node-interactive
      :value="titleValue()"
      @input.stop="handleTitleInput"
      @click.stop
      @mousedown.stop
      @pointerdown.stop
      @touchstart.stop
      @dragstart.prevent
    >
    <button
      class="node-menu-button"
      data-node-interactive
      type="button"
      title="Section actions"
      @click.stop="emit('open-menu', $event)"
      @pointerdown.stop
    >
      <MoreVertical
        :size="16"
        aria-hidden="true"
      />
    </button>
  </div>
  <div class="node-divider" />
  <div class="node-body section-body">
    <textarea
      ref="bodyInput"
      class="node-input node-textarea section-input nodrag nopan"
      data-node-interactive
      :value="bodyValue()"
      rows="1"
      @input.stop="handleBodyInput"
      @click.stop
      @mousedown.stop
      @pointerdown.stop
      @touchstart.stop
      @dragstart.prevent
    />
  </div>
  <div class="node-tools">
    <label
      class="image-picker"
      data-node-interactive
      title="Upload image"
      @click.stop
      @mousedown.stop
      @pointerdown.stop
      @touchstart.stop
    >
      <Image
        :size="15"
        aria-hidden="true"
      />
      <input
        data-node-interactive
        type="file"
        accept="image/*"
        @click.stop
        @change="handleUpload"
      >
    </label>
  </div>
  <img
    v-if="data.imageUrl"
    class="node-image section-image"
    :src="data.imageUrl"
    alt=""
    draggable="false"
    @dragstart.prevent
  >
</template>
