<script setup lang="ts">
import { Background } from "@vue-flow/background";
import { MiniMap } from "@vue-flow/minimap";
import "@vue-flow/minimap/dist/style.css";
import { VueFlow } from "@vue-flow/core";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import {
  useCanvasContext,
  useNodeRendererContext
} from "../../app/flowEditorContext";
import ConnectionPreviewLine from "../edges/ConnectionPreviewLine.vue";
import RegularNode from "../nodes/RegularNode.vue";
import SectionNode from "../nodes/SectionNode.vue";
import FlowContextMenu from "../context-menu/FlowContextMenu.vue";
import RemoteCursorLayer from "../presence/RemoteCursorLayer.vue";
import SelectionOverlay from "../selection/SelectionOverlay.vue";
import CanvasOverlays from "./CanvasOverlays.vue";

const nodeSnapGrid: [number, number] = [1, 1];

const {
  canvasPanel,
  closeContextMenu,
  ConnectionLineType,
  ConnectionMode,
  edges,
  edgeTypes,
  getMiniMapNodeColor,
  getMiniMapNodeStroke,
  handleCanvasContextMenu,
  handleCanvasPointerDown,
  handleCanvasPointerLeave,
  handleCanvasPointerMove,
  handleConnect,
  handleCreateDrop,
  handleEdgeClick,
  handleEdgeUpdate,
  handleNodeClick,
  handleNodeDragStart,
  handleNodeDrag,
  handleNodeDragStop,
  handleNodesChange,
  handlePaneClick,
  handleSelectionDrag,
  handleSelectionDragStop,
  handleViewportMove,
  handleViewportMoveEnd,
  isLoggedIn,
  isMovingSelection,
  isHoveringSelection,
  isValidSectionConnection,
  MarkerType,
  nodes,
  openEdgeContextMenu,
  openNodeContextMenu,
  openSelectionContextMenu
} = useCanvasContext();

const {
  addNodePort,
  getNodeResizerZoom,
  getSelectedUsersForNode,
  isLassoSelecting,
  isNodeSelected,
  openNodeMenuButton,
  resizeNode,
  resizeNodePreview,
  shouldShowNodeResizer,
  startNodeResize,
  submitNodeData,
  uploadImage
} = useNodeRendererContext();
</script>

<template>
  <section
    ref="canvasPanel"
    class="canvas-panel"
    :class="{ 'selection-hover': isHoveringSelection || isMovingSelection }"
    aria-label="Shared flow canvas"
    @contextmenu="handleCanvasContextMenu"
    @pointerdown.capture="handleCanvasPointerDown"
    @pointerleave="handleCanvasPointerLeave"
    @pointermove="handleCanvasPointerMove"
  >
    <CanvasOverlays />

    <VueFlow
      v-if="isLoggedIn"
      v-model:nodes="nodes"
      v-model:edges="edges"
      class="flow-canvas"
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
      @connect="handleConnect"
      @dragover.prevent
      @drop="handleCreateDrop"
      @edge-context-menu="openEdgeContextMenu"
      @edge-click="handleEdgeClick"
      @edge-update="handleEdgeUpdate"
      @move="handleViewportMove"
      @move-end="handleViewportMoveEnd"
      @node-context-menu="openNodeContextMenu"
      @node-click="handleNodeClick"
      @node-drag-start="handleNodeDragStart"
      @node-drag="handleNodeDrag"
      @node-drag-stop="handleNodeDragStop"
      @nodes-change="handleNodesChange"
      @pane-click="handlePaneClick"
      @pane-context-menu="closeContextMenu"
      @selection-context-menu="openSelectionContextMenu"
      @selection-drag="handleSelectionDrag"
      @selection-drag-stop="handleSelectionDragStop"
    >
      <template #connection-line="connectionLineProps">
        <ConnectionPreviewLine v-bind="connectionLineProps" />
      </template>

      <template #node-section="{ id, data }">
        <SectionNode
          :id="id"
          :data="data"
          :selected="!isLassoSelecting && isNodeSelected(id)"
          :show-resizer="shouldShowNodeResizer(id)"
          :selected-users="getSelectedUsersForNode(id)"
          :viewport-zoom="getNodeResizerZoom(id)"
          :readonly-preview="!isLoggedIn"
          @update-title="(nodeId, value) => submitNodeData(nodeId, 'title', value)"
          @update-body="(nodeId, value) => submitNodeData(nodeId, 'body', value)"
          @upload-image="uploadImage"
          @resize-start="startNodeResize"
          @resize="resizeNodePreview"
          @resize-end="resizeNode"
          @open-menu="openNodeMenuButton"
          @add-port="addNodePort"
        />
      </template>

      <template #node-item="{ id, data }">
        <RegularNode
          :id="id"
          :data="data"
          :selected="!isLassoSelecting && isNodeSelected(id)"
          :show-resizer="shouldShowNodeResizer(id)"
          :selected-users="getSelectedUsersForNode(id)"
          :viewport-zoom="getNodeResizerZoom(id)"
          :readonly-preview="!isLoggedIn"
          @update-title="(nodeId, value) => submitNodeData(nodeId, 'title', value)"
          @update-body="(nodeId, value) => submitNodeData(nodeId, 'body', value)"
          @upload-image="uploadImage"
          @resize-start="startNodeResize"
          @resize="resizeNodePreview"
          @resize-end="resizeNode"
          @open-menu="openNodeMenuButton"
          @add-port="addNodePort"
        />
      </template>

      <Background pattern-color="#d6dde6" :gap="18" />
      <MiniMap
        :pannable="isLoggedIn"
        :zoomable="isLoggedIn"
        position="bottom-right"
        :node-color="getMiniMapNodeColor"
        :node-stroke-color="getMiniMapNodeStroke"
        :node-stroke-width="4"
      />
    </VueFlow>

    <SelectionOverlay />
    <RemoteCursorLayer />
    <FlowContextMenu />
  </section>
</template>
