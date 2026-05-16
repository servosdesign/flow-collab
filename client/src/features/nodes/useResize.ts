import { nextTick } from "vue";
import type { SyncEdge, SyncNode } from "@vue-flow-sync/shared";
import type { JsonOp } from "sharedb/lib/client";
import {
  createReplaceOp,
  getMeasuredItemNodeHeight,
  getMinimumNodeWidth,
  recalculateSectionMembershipInGraph,
  toNodeSizeStyle,
  type ResizeParams
} from "../../domain/graph";
import type { FlowEditorServices } from "../../app/flowEditorServices";
import type { FlowRuntime } from "../../flowRuntime";

export function useResize(runtime: FlowRuntime, services: FlowEditorServices) {
  function clampResizeParams(node: SyncNode, params: ResizeParams): ResizeParams {
    const minimumWidth = node.type === "section" ? 360 : getMinimumNodeWidth(node);
    const minimumHeight =
      node.type === "section" ? 240 : getMeasuredItemNodeHeight(node);

    return {
      ...params,
      width: Math.max(Math.round(params.width), minimumWidth),
      height: Math.max(Math.round(params.height), minimumHeight)
    };
  }

  function submitResizeCommit(
    nodeId: string,
    params: ResizeParams,
    recalculateSectionMembership = false
  ) {
    const document = runtime.flowDocument.value;

    if (!document) {
      return;
    }

    const nodeIndex = document.data.nodes.findIndex((node) => node.id === nodeId);

    if (nodeIndex < 0) {
      return;
    }

    const sourceNode = document.data.nodes[nodeIndex];
    const nextParams = clampResizeParams(sourceNode, params);
    const resizedWidth = Math.round(nextParams.width);
    const resizedHeight = Math.round(nextParams.height);
    const resizedPosition = {
      x: typeof nextParams.x === "number" ? Math.round(nextParams.x) : sourceNode.position.x,
      y: typeof nextParams.y === "number" ? Math.round(nextParams.y) : sourceNode.position.y
    };
    const resizedStyle = {
      ...(sourceNode.style ?? {}),
      ...toNodeSizeStyle(resizedWidth, resizedHeight)
    };
    const nextNodes = document.data.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            width: resizedWidth,
            height: resizedHeight,
            position: resizedPosition,
            style: resizedStyle
          }
        : node
    );
    let nextEdges = document.data.edges.map((edge) => ({ ...edge }));
    const resizedNode = nextNodes.find((node) => node.id === nodeId);

    if (recalculateSectionMembership && resizedNode?.type === "section") {
      nextEdges = recalculateSectionMembershipInGraph(
        nodeId,
        nextNodes,
        nextEdges,
        document.data.nodes
      );
      services.submitGraphReplacement(nextNodes, nextEdges);
      return;
    }

    const operation = [
      createReplaceOp(["nodes", nodeIndex, "style"], sourceNode.style, resizedStyle),
      createReplaceOp(["nodes", nodeIndex, "width"], sourceNode.width, resizedWidth),
      createReplaceOp(["nodes", nodeIndex, "height"], sourceNode.height, resizedHeight),
      createReplaceOp(["nodes", nodeIndex, "position"], sourceNode.position, resizedPosition)
    ].filter((resizeOperation): resizeOperation is JsonOp => Boolean(resizeOperation));

    services.submitOperation(operation);
  }

  function scheduleResizeCommit(nodeId: string, params: ResizeParams) {
    runtime.timers.pendingResizeCommit = {
      nodeId,
      params: { ...params }
    };

    if (runtime.timers.resizeCommitTimer) {
      return;
    }

    runtime.timers.resizeCommitTimer = window.setTimeout(() => {
      runtime.timers.resizeCommitTimer = undefined;
      const nextCommit = runtime.timers.pendingResizeCommit;
      runtime.timers.pendingResizeCommit = undefined;

      if (nextCommit) {
        submitResizeCommit(nextCommit.nodeId, nextCommit.params);
      }
    }, 80);
  }

  function flushResizeCommit(nodeId: string, params: ResizeParams) {
    if (runtime.timers.resizeCommitTimer) {
      window.clearTimeout(runtime.timers.resizeCommitTimer);
      runtime.timers.resizeCommitTimer = undefined;
    }

    runtime.timers.pendingResizeCommit = undefined;
    submitResizeCommit(nodeId, params, true);
  }

  function startNodeResize() {
    runtime.isResizingNode.value = true;
    services.scheduleSelectionBoundsRefresh();
  }

  function resizeNodePreview(nodeId: string, params: ResizeParams, syncResize = true) {
    let committedParams: ResizeParams | undefined;
    const node = services.getSyncNodeById(nodeId);

    if (node) {
      committedParams = clampResizeParams(node, params);
    }

    nextTick(() => {
      services.scheduleSelectionBoundsRefresh();
    });

    if (syncResize && committedParams) {
      scheduleResizeCommit(nodeId, committedParams);
    }
  }

  function resizeNode(nodeId: string, params: ResizeParams) {
    runtime.isResizingNode.value = false;

    flushResizeCommit(nodeId, params);
    nextTick(services.scheduleSelectionBoundsRefresh);
  }

  function cleanupResize() {
    window.clearTimeout(runtime.timers.resizeCommitTimer);
  }

  return {
    cleanupResize,
    resizeNode,
    resizeNodePreview,
    startNodeResize
  };
}
