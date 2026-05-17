<script setup lang="ts">
import { BaseEdge, type EdgeProps } from '@vue-flow/core'
import { computed } from 'vue'
import { resolveSectionThroughEdgePath } from './edgeGeometry'

const props = defineProps<EdgeProps>()

const edgePath = computed(() => resolveSectionThroughEdgePath(props))
</script>

<template>
  <BaseEdge
    :id="id"
    class="section-through-edge"
    :path="edgePath"
    :marker-start="markerStart"
    :marker-end="markerEnd"
    :interaction-width="interactionWidth"
  />
</template>
