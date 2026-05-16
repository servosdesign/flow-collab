import { nextTick } from "vue";
import type { SyncEdge, SyncNode } from "@vue-flow-sync/shared";
import type { JsonOp } from "sharedb/lib/client";
import {
  createReplaceOp,
  getMinimumNodeHeight,
  getMinimumNodeWidth,
  recalculateSectionMembershipInGraph,
  toNodeSizeStyle,
  type ResizeParams
} from "./graph";
import type { FlowRuntime } from "./flowRuntime";

function getAction<T>(runtime: FlowRuntime, name: string) {
  return runtime.actions[name] as T;
}

export function useResize(runtime: FlowRuntime) {
  function clampResizeParams(node: SyncNode, params: ResizeParams): ResizeParams {
    const minimumWidth = node.type === "section" ? 360 : getMinimumNodeWidth(node);
    const minimumHeight = node.type === "section" ? 240 : getMinimumNodeHeight(node);

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

    const submitGraphReplacement = getAction<(nodes: SyncNode[], edges: SyncEdge[]) => void>(
      runtime,
      "submitGraphReplacement"
    );
    const submitOperation = getAction<(operation: JsonOp[]) => void>(runtime, "submitOperation");
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
      submitGraphReplacement(nextNodes, nextEdges);
      return;
    }

    const operation = [
      createReplaceOp(["nodes", nodeIndex, "style"], sourceNode.style, resizedStyle),
      createReplaceOp(["nodes", nodeIndex, "width"], sourceNode.width, resizedWidth),
      createReplaceOp(["nodes", nodeIndex, "height"], sourceNode.height, resizedHeight),
      createReplaceOp(["nodes", nodeIndex, "position"], sourceNode.position, resizedPosition)
    ].filter((resizeOperation): resizeOperation is JsonOp => Boolean(resizeOperation));

    submitOperation(operation);
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
    getAction<() => void>(runtime, "scheduleSelectionBoundsRefresh")();
  }

  function resizeNodePreview(nodeId: string, params: ResizeParams, syncResize = true) {
    const getSyncNodeById = getAction<(nodeId: string) => SyncNode | undefined>(
      runtime,
      "getSyncNodeById"
    );
    let committedParams: ResizeParams | undefined;
    const node = getSyncNodeById(nodeId);

    if (node) {
      committedParams = clampResizeParams(node, params);
    }

    nextTick(() => {
      getAction<() => void>(runtime, "scheduleSelectionBoundsRefresh")();
    });

    if (syncResize && committedParams) {
      scheduleResizeCommit(nodeId, committedParams);
    }
  }

  function resizeNode(nodeId: string, params: ResizeParams) {
    runtime.isResizingNode.value = false;

    flushResizeCommit(nodeId, params);
    nextTick(getAction<() => void>(runtime, "scheduleSelectionBoundsRefresh"));
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
