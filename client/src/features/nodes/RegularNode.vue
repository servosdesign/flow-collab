<script setup lang="ts">
import { Handle, Position } from "@vue-flow/core";
import { NodeResizer, type OnResize, type OnResizeEnd, type OnResizeStart } from "@vue-flow/node-resizer";
import "@vue-flow/node-resizer/dist/style.css";
import { computed, defineComponent, h, type PropType } from "vue";
import type { SyncNodeData, SyncPort, SyncPresenceUser } from "@vue-flow-sync/shared";
import NodeContent from "./NodeContent.vue";
import { useStableResizerStyle } from "./useStableResizerStyle";

const props = defineProps<{
  id: string;
  data: SyncNodeData;
  selected?: boolean;
  showResizer?: boolean;
  selectedUsers?: SyncPresenceUser[];
  readonlyPreview?: boolean;
  viewportZoom?: number;
}>();

defineEmits<{
  "update-title": [id: string, value: string];
  "update-body": [id: string, value: string];
  "upload-image": [id: string, file: File];
  "resize-start": [id: string, params: OnResizeStart["params"]];
  resize: [id: string, params: OnResize["params"]];
  "resize-end": [id: string, params: OnResizeEnd["params"]];
  "open-menu": [id: string, event: MouseEvent];
  "add-port": [id: string];
}>();

const ports = computed<SyncPort[]>(() =>
  props.data.ports?.length ? props.data.ports : [{ id: "main", color: "#0f766e" }]
);
const workloadSeed = computed(() =>
  Array.from(props.id).reduce((total, character) => total + character.charCodeAt(0), 0)
);
const visibleWidget = computed(() => workloadSeed.value % 4);
const widgetBars = computed(() =>
  Array.from({ length: 14 }, (_, index) => ((workloadSeed.value + index * 17) % 82) + 12)
);
const hiddenTiles = computed(() =>
  Array.from({ length: 42 }, (_, index) => ({
    id: index,
    tone: (workloadSeed.value + index) % 7,
    value: ((workloadSeed.value * (index + 3)) % 91) + 9
  }))
);
const minimumNodeWidth = computed(() => 320 + Math.max(0, ports.value.length - 8) * 14);
const minimumNodeHeight = computed(() => {
  const body = props.data.body ?? props.data.text ?? "";
  const rows = body
    ? body
        .split("\n")
        .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 34)), 0)
    : 4;
  const bodyHeight = Math.max(98, rows * 17 + 28);
  const imageHeight = props.data.imageUrl ? 144 : 0;
  const widgetHeight = 72;
  const portHeight = Math.max(0, ports.value.length - 6) * 22;

  return 150 + bodyHeight + imageHeight + widgetHeight + portHeight;
});
const resizerStyle = useStableResizerStyle(() => props.viewportZoom);

function portTop(index: number) {
  return `${((index + 1) / (ports.value.length + 1)) * 100}%`;
}

function userInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

const DenseBars = defineComponent({
  name: "DenseBars",
  props: {
    bars: {
      type: Array as PropType<number[]>,
      required: true
    }
  },
  setup(componentProps) {
    return () =>
      h(
        "div",
        { class: "node-widget bars-widget", "aria-hidden": "true" },
        componentProps.bars.map((bar, index) =>
          h("span", { key: index, style: { height: `${bar}%` } })
        )
      );
  }
});

const StatusMatrix = defineComponent({
  name: "StatusMatrix",
  props: {
    tiles: {
      type: Array as PropType<Array<{ id: number; tone: number; value: number }>>,
      required: true
    }
  },
  setup(componentProps) {
    return () =>
      h(
        "div",
        { class: "node-widget matrix-widget", "aria-hidden": "true" },
        componentProps.tiles
          .slice(0, 18)
          .map((tile) => h("span", { key: tile.id, class: `tone-${tile.tone}` }))
      );
  }
});

const MiniGauge = defineComponent({
  name: "MiniGauge",
  props: {
    seed: {
      type: Number,
      required: true
    }
  },
  setup(componentProps) {
    return () =>
      h("div", { class: "node-widget gauge-widget", "aria-hidden": "true" }, [
        h("span", {
          style: { transform: `rotate(${(componentProps.seed % 130) - 65}deg)` }
        })
      ]);
  }
});

const HiddenWorkload = defineComponent({
  name: "HiddenWorkload",
  props: {
    tiles: {
      type: Array as PropType<Array<{ id: number; tone: number; value: number }>>,
      required: true
    }
  },
  setup(componentProps) {
    return () =>
      h(
        "div",
        { class: "hidden-node-workload", "aria-hidden": "true" },
        componentProps.tiles.map((tile) =>
          h("span", {
            key: tile.id,
            class: `tone-${tile.tone}`,
            style: { opacity: tile.value / 100 }
          })
        )
      );
  }
});
</script>

<template>
  <div
    class="sync-node item-node"
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
        :min-width="minimumNodeWidth"
        :min-height="minimumNodeHeight"
        :auto-scale="false"
        color="#0f766e"
        @resize-start="$emit('resize-start', id, $event.params)"
        @resize="$emit('resize', id, $event.params)"
        @resize-end="$emit('resize-end', id, $event.params)"
      />
    </div>
    <div v-if="selectedUsers?.length" class="node-presence">
      <span
        v-for="user in selectedUsers"
        :key="user.id"
        class="node-presence-chip"
        :title="`${user.name} selected this node`"
        :style="{ backgroundColor: user.color }"
      >
        {{ userInitials(user.name) }}
      </span>
    </div>
    <Handle
      id="main"
      type="target"
      :position="Position.Left"
      :connectable-start="false"
      :style="{ top: '50%', backgroundColor: '#2563eb' }"
    />
    <template v-if="readonlyPreview">
      <div class="lod-node-preview">
        <img v-if="data.imageUrl" :src="data.imageUrl" alt="" />
        <span></span>
        <span></span>
        <span></span>
      </div>
    </template>
    <template v-else>
      <NodeContent
        :data="data"
        @update-title="$emit('update-title', id, $event)"
        @update-body="$emit('update-body', id, $event)"
        @upload-image="$emit('upload-image', id, $event)"
        @open-menu="$emit('open-menu', id, $event)"
        @add-port="$emit('add-port', id)"
      />
      <DenseBars v-if="visibleWidget === 0" :bars="widgetBars" />
      <StatusMatrix v-else-if="visibleWidget === 1" :tiles="hiddenTiles" />
      <MiniGauge v-else-if="visibleWidget === 2" :seed="workloadSeed" />
      <HiddenWorkload :tiles="hiddenTiles" />
    </template>
    <template v-for="(port, index) in ports" :key="`source-${port.id}`">
      <Handle
        :id="port.id"
        type="source"
        :position="Position.Right"
        :connectable-end="false"
        :style="{ top: portTop(index), backgroundColor: port.color }"
      />
    </template>
  </div>
</template>
