<script setup lang="ts">
import { Background } from "@vue-flow/background";
import { MiniMap } from "@vue-flow/minimap";
import "@vue-flow/minimap/dist/style.css";
import { VueFlow } from "@vue-flow/core";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import { BoxSelect, Copy, FolderPlus, LoaderCircle, LogOut, PlusSquare, Trash2 } from "@lucide/vue";
import ConnectionPreviewLine from "./components/ConnectionPreviewLine.vue";
import RegularNode from "./components/RegularNode.vue";
import SectionNode from "./components/SectionNode.vue";
import { useFlowSyncApp } from "./useFlowSyncApp";

const {
  addNodePort,
  authMessage,
  canvasPanel,
  closeContextMenu,
  ConnectionLineType,
  ConnectionMode,
  contextTarget,
  deleteContextTarget,
  duplicateContextTarget,
  duplicateCount,
  duplicateCountValue,
  edgeCount,
  edges,
  edgeTypes,
  errorMessage,
  getCursorStyle,
  getMiniMapNodeColor,
  getMiniMapNodeStroke,
  getNodeResizerZoom,
  getSelectedUsersForNode,
  handleCanvasContextMenu,
  handleCanvasPointerDown,
  handleCanvasPointerLeave,
  handleCanvasPointerMove,
  handleConnect,
  handleCreateDragStart,
  handleCreateDrop,
  handleEdgeClick,
  handleEdgeUpdate,
  handleNodeClick,
  handleNodeDragStart,
  handleNodeDrag,
  handleNodeDragStop,
  handleNodesChange,
  handlePaneClick,
  handleSelectedBoundsPointerDown,
  handleSelectionDrag,
  handleSelectionDragStop,
  handleViewportMove,
  handleViewportMoveEnd,
  hasError,
  isValidSectionConnection,
  isFlowLoading,
  isLoggedIn,
  isMovingSelection,
  isHoveringSelection,
  isLassoSelecting,
  isResizingNode,
  isNodeSelected,
  lassoPreviewRects,
  joinPresence,
  loginNameInput,
  loginPasswordInput,
  logoutUser,
  MarkerType,
  nodeCount,
  nodes,
  openEdgeContextMenu,
  openNodeContextMenu,
  openNodeMenuButton,
  openSelectedBoundsContextMenu,
  openSelectionContextMenu,
  pendingCreate,
  remoteCursors,
  resizeNode,
  resizeNodePreview,
  selectedBoundsStyle,
  selectedLabel,
  selectionMovePreview,
  setCreateMode,
  shouldShowNodeResizer,
  startNodeResize,
  status,
  submitNodeData,
  uploadImage,
  userInitials,
  visibleCollaborators,
} = useFlowSyncApp();
</script>

<template>
  <div class="app-shell" :class="{ 'logged-out': !isLoggedIn }" @click="closeContextMenu">
    <header class="topbar">
      <div class="brand">
        <BoxSelect :size="20" aria-hidden="true" />
        <span>Vue Flow Sync</span>
        <span class="status-pill" :class="{ error: hasError }">{{ status }}</span>
      </div>

      <div class="metrics" aria-label="Flow counts">
        <span>{{ nodeCount }} nodes</span>
        <span>{{ edgeCount }} edges</span>
      </div>

      <form v-if="!isLoggedIn" class="login-tools" @submit.prevent="joinPresence">
        <input
          v-model="loginNameInput"
          class="login-input"
          type="text"
          autocomplete="name"
          placeholder="Username"
        />
        <input
          v-model="loginPasswordInput"
          class="login-input password-input"
          type="password"
          autocomplete="current-password"
          placeholder="Password"
        />
        <button type="submit" class="login-button">Login</button>
        <span v-if="authMessage" class="auth-message">{{ authMessage }}</span>
      </form>

      <div v-else class="presence-tools" aria-label="Connected users">
        <span
          v-for="user in visibleCollaborators"
          :key="user.id"
          class="user-chip"
          :title="user.name"
          :style="{ backgroundColor: user.color }"
        >
          {{ userInitials(user.name) }}
        </span>
        <button type="button" class="logout-button" title="Logout" @click.stop="logoutUser">
          <LogOut :size="15" aria-hidden="true" />
          <span>Logout</span>
        </button>
      </div>

      <div v-if="isLoggedIn" class="create-tools" aria-label="Create nodes">
        <button
          type="button"
          class="create-button"
          :class="{ active: pendingCreate === 'section' }"
          draggable="true"
          title="Create section"
          @click.stop="setCreateMode('section')"
          @dragstart="handleCreateDragStart('section', $event)"
        >
          <FolderPlus :size="18" aria-hidden="true" />
          <span>Section</span>
        </button>
        <button
          type="button"
          class="create-button"
          :class="{ active: pendingCreate === 'item' }"
          draggable="true"
          title="Create node"
          @click.stop="setCreateMode('item')"
          @dragstart="handleCreateDragStart('item', $event)"
        >
          <PlusSquare :size="18" aria-hidden="true" />
          <span>Node</span>
        </button>
      </div>
    </header>

    <main class="workspace">
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
        <div v-if="hasError" class="error-bar">{{ errorMessage }}</div>
        <div v-if="isFlowLoading" class="loading-mask">
          <LoaderCircle class="spin" :size="22" aria-hidden="true" />
        </div>

        <div v-if="!isLoggedIn" class="logged-out-cover">
          <div class="lod-overview">
            <LoaderCircle v-if="isFlowLoading" class="spin" :size="22" aria-hidden="true" />
            <div class="lod-grid" aria-hidden="true">
              <span v-for="index in 42" :key="index"></span>
            </div>
          </div>
        </div>

        <VueFlow
          v-else
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
          :nodes-draggable="isLoggedIn && !isResizingNode"
          :pan-on-drag="isLoggedIn ? [2] : false"
          :select-nodes-on-drag="false"
          :selection-key-code="null"
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

        <div
          v-for="user in remoteCursors"
          :key="user.id"
          class="remote-cursor"
          :style="getCursorStyle(user)"
        >
          <span class="cursor-pointer"></span>
          <span class="cursor-label">{{ user.name }}</span>
        </div>

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
      </section>
    </main>
  </div>
</template>
