<script setup lang="ts">
import { Copy, Trash2 } from "@lucide/vue";
import { useContextMenuContext } from "../../app/flowEditorContext";

const {
  contextTarget,
  deleteContextTarget,
  duplicateContextTarget,
  duplicateCount,
  duplicateCountValue,
  selectedLabel
} = useContextMenuContext();
</script>

<template>
  <div
    v-if="contextTarget"
    class="context-menu"
    :style="{ left: `${contextTarget.x}px`, top: `${contextTarget.y}px` }"
    @click.stop
  >
    <div class="context-title">{{ selectedLabel }}</div>
    <label class="context-count">
      <span>Copies</span>
      <input
        v-model.number="duplicateCount"
        type="number"
        min="1"
        max="20"
        step="1"
        @click.stop
      />
    </label>
    <button type="button" @click="duplicateContextTarget">
      <Copy :size="16" aria-hidden="true" />
      <span>Duplicate {{ duplicateCountValue }}x</span>
    </button>
    <button type="button" class="danger" @click="deleteContextTarget">
      <Trash2 :size="16" aria-hidden="true" />
      <span>Delete</span>
    </button>
  </div>
</template>
