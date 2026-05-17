<script setup lang="ts">
import type { SyncNodeData } from "@vue-flow-sync/shared";
import { useNodeRendererContext } from "../../app/flowEditorContext";
import SectionNode from "../nodes/SectionNode.vue";

defineProps<{
  id: string;
  data: SyncNodeData;
}>();

const {
  addNodePort,
  getNodeResizerZoom,
  getSelectedUsersForNode,
  isLassoSelecting,
  isLoggedIn,
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
  <SectionNode
    v-memo="[
      id,
      data,
      !isLassoSelecting && isNodeSelected(id),
      shouldShowNodeResizer(id),
      getSelectedUsersForNode(id),
      getNodeResizerZoom(id),
      !isLoggedIn
    ]"
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
