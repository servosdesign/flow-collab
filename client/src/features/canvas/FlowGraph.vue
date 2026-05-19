<script setup lang="ts">
import { VueFlow } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { useFlowGraphContext } from '../../app/flowEditorContext'
import CanvasEdgeLayer from '../edges/CanvasEdgeLayer.vue'
import FlowItemNodeSlot from './FlowItemNodeSlot.vue'
import FlowMiniMap from './FlowMiniMap.vue'
import FlowSectionNodeSlot from './FlowSectionNodeSlot.vue'

const nodeSnapGrid: [number, number] = [1, 1]

const {
  edges,
  events,
  isLoggedIn,
  nodes
} = useFlowGraphContext()
</script>

<template>
  <VueFlow
    v-if="isLoggedIn"
    v-model:nodes="nodes"
    class="flow-canvas canvas-edge-renderer"
    :elements-selectable="false"
    :max-zoom="1.4"
    :min-zoom="0.15"
    :multi-selection-key-code="null"
    :nodes-connectable="false"
    :nodes-draggable="false"
    :pan-on-drag="isLoggedIn ? [2] : false"
    :select-nodes-on-drag="false"
    :selection-key-code="null"
    :snap-grid="nodeSnapGrid"
    snap-to-grid
    :zoom-on-double-click="isLoggedIn"
    :zoom-on-pinch="isLoggedIn"
    :zoom-on-scroll="isLoggedIn"
    fit-view-on-init
    @dragover.prevent
    @drop="events.handleCreateDrop"
    @move="events.handleViewportMove"
    @move-end="events.handleViewportMoveEnd"
    @node-context-menu="events.openNodeContextMenu"
    @node-click="events.handleNodeClick"
    @node-drag-start="events.handleNodeDragStart"
    @node-drag="events.handleNodeDrag"
    @node-drag-stop="events.handleNodeDragStop"
    @nodes-change="events.handleNodesChange"
    @pane-click="events.handlePaneClick"
    @pane-context-menu="events.closeContextMenu"
  >
    <template #zoom-pane>
      <CanvasEdgeLayer :edges="edges" />
    </template>

    <template #node-section="{ id, data }">
      <FlowSectionNodeSlot
        :id="id"
        :data="data"
      />
    </template>

    <template #node-item="{ id, data }">
      <FlowItemNodeSlot
        :id="id"
        :data="data"
      />
    </template>

    <FlowMiniMap />
  </VueFlow>
</template>
