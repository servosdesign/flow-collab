<script setup lang="ts">
import {
  ConnectionLineType,
  ConnectionMode,
  MarkerType,
  VueFlow
} from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { useFlowGraphContext } from '../../app/flowEditorContext'
import CanvasEdgeLayer from '../edges/CanvasEdgeLayer.vue'
import ConnectionPreviewLine from '../edges/ConnectionPreviewLine.vue'
import FlowGridBackground from './FlowGridBackground.vue'
import FlowItemNodeSlot from './FlowItemNodeSlot.vue'
import FlowMiniMap from './FlowMiniMap.vue'
import FlowSectionNodeSlot from './FlowSectionNodeSlot.vue'

const nodeSnapGrid: [number, number] = [1, 1]
const useCanvasEdges = import.meta.env.VITE_FLOW_EDGE_RENDERER !== 'svg'

const {
  edges,
  edgeTypes,
  events,
  isLoggedIn,
  isValidSectionConnection,
  nodes
} = useFlowGraphContext()
</script>

<template>
  <VueFlow
    v-if="isLoggedIn"
    v-model:nodes="nodes"
    v-model:edges="edges"
    class="flow-canvas"
    :class="{ 'canvas-edge-renderer': useCanvasEdges }"
    :connection-line-type="ConnectionLineType.Step"
    :connection-line-options="{
      type: ConnectionLineType.Step,
      markerEnd: MarkerType.ArrowClosed,
      class: 'flow-connection-preview'
    }"
    :connection-mode="ConnectionMode.Strict"
    :default-edge-options="{ type: 'step', markerEnd: MarkerType.ArrowClosed }"
    :edge-types="edgeTypes"
    :edges-updatable="isLoggedIn"
    :elements-selectable="isLoggedIn"
    :is-valid-connection="isValidSectionConnection"
    :max-zoom="1.4"
    :min-zoom="0.15"
    :multi-selection-key-code="null"
    :nodes-connectable="isLoggedIn"
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
    @connect="events.handleConnect"
    @dragover.prevent
    @drop="events.handleCreateDrop"
    @edge-context-menu="events.openEdgeContextMenu"
    @edge-click="events.handleEdgeClick"
    @edge-update="events.handleEdgeUpdate"
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
    @selection-context-menu="events.openSelectionContextMenu"
    @selection-drag="events.handleSelectionDrag"
    @selection-drag-stop="events.handleSelectionDragStop"
  >
    <template #zoom-pane>
      <CanvasEdgeLayer v-if="useCanvasEdges" />
    </template>

    <template #connection-line="connectionLineProps">
      <ConnectionPreviewLine v-bind="connectionLineProps" />
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

    <FlowGridBackground />
    <FlowMiniMap />
  </VueFlow>
</template>
