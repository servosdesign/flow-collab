<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { NodeResizer, type OnResize, type OnResizeEnd, type OnResizeStart } from '@vue-flow/node-resizer'
import '@vue-flow/node-resizer/dist/style.css'
import type { SyncNodeData, SyncPresenceUser } from '@vue-flow-sync/shared'
import SectionContent from './SectionContent.vue'
import type { NodeBodyUpdate } from './types'
import { useStableResizerStyle } from './useStableResizerStyle'

const props = defineProps<{
  id: string
  data: SyncNodeData
  selected?: boolean
  showResizer?: boolean
  selectedUsers?: SyncPresenceUser[]
  readonlyPreview?: boolean
  viewportZoom?: number
}>()

defineEmits<{
  'update-title': [id: string, value: string]
  'update-body': [id: string, update: NodeBodyUpdate]
  'upload-image': [id: string, file: File]
  'resize-start': [id: string, params: OnResizeStart['params']]
  resize: [id: string, params: OnResize['params']]
  'resize-end': [id: string, params: OnResizeEnd['params']]
  'open-menu': [id: string, event: MouseEvent]
  'add-port': [id: string]
}>()

const resizerStyle = useStableResizerStyle(() => props.viewportZoom)

const userInitials = (name: string) => {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}
</script>

<template>
  <div
    class="sync-node section-node"
    :class="{ selected }"
  >
    <div
      v-if="showResizer"
      class="node-resizer-layer"
      :style="resizerStyle"
      @mousedown.stop
      @pointerdown.stop
      @touchstart.stop
    >
      <NodeResizer
        :node-id="id"
        :is-visible="true"
        :min-width="360"
        :min-height="240"
        :auto-scale="false"
        color="#0f766e"
        @resize-start="$emit('resize-start', id, $event.params)"
        @resize="$emit('resize', id, $event.params)"
        @resize-end="$emit('resize-end', id, $event.params)"
      />
    </div>
    <div
      v-if="selectedUsers?.length"
      class="node-presence"
    >
      <span
        v-for="user in selectedUsers"
        :key="user.id"
        v-memo="[user.id, user.name, user.color]"
        class="node-presence-chip"
        :title="`${user.name} selected this section`"
        :style="{ backgroundColor: user.color }"
      >
        {{ userInitials(user.name) }}
      </span>
    </div>
    <Handle
      id="section-left"
      class="section-port section-port-left section-port-target"
      type="target"
      :position="Position.Left"
      :connectable-start="false"
      :style="{ top: '50%', backgroundColor: '#2563eb' }"
    />
    <Handle
      id="section-left"
      class="section-port section-port-left section-port-source"
      type="source"
      :position="Position.Left"
      :connectable-end="false"
      :style="{ top: '50%', backgroundColor: '#2563eb' }"
    />
    <Handle
      id="section-right"
      class="section-port section-port-right section-port-target"
      type="target"
      :position="Position.Right"
      :connectable-start="false"
      :style="{ top: '50%', backgroundColor: '#9333ea' }"
    />
    <Handle
      id="section-right"
      class="section-port section-port-right section-port-source"
      type="source"
      :position="Position.Right"
      :connectable-end="false"
      :style="{ top: '50%', backgroundColor: '#9333ea' }"
    />
    <template v-if="readonlyPreview">
      <div class="lod-node-preview section-lod-preview">
        <span />
        <span />
      </div>
    </template>
    <template v-else>
      <SectionContent
        :data="data"
        @update-title="$emit('update-title', id, $event)"
        @update-body="$emit('update-body', id, $event)"
        @upload-image="$emit('upload-image', id, $event)"
        @open-menu="$emit('open-menu', id, $event)"
        @add-port="$emit('add-port', id)"
      />
    </template>
  </div>
</template>
