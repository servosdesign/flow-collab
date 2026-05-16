import type { FlowRuntime } from "./flowRuntime";

type ViewportLike = { x: number; y: number; zoom: number };
type MovePayload = { flowTransform?: ViewportLike } | ViewportLike;

export function useViewport(runtime: FlowRuntime) {
  function updateCanvasSize() {
    const bounds = runtime.canvasPanel.value?.getBoundingClientRect();

    if (!bounds) {
      return;
    }

    runtime.canvasSize.value = {
      width: bounds.width,
      height: bounds.height
    };
    scheduleSelectionBoundsRefresh();
  }

  function scheduleSelectionBoundsRefresh() {
    if (runtime.timers.selectionBoundsFrame) {
      return;
    }

    runtime.timers.selectionBoundsFrame = window.requestAnimationFrame(() => {
      runtime.timers.selectionBoundsFrame = undefined;
      runtime.selectionBoundsVersion.value += 1;
    });
  }

  function getViewportFromPayload(payload?: MovePayload) {
    if (!payload) {
      return runtime.toObject().viewport;
    }

    if ("x" in payload && "y" in payload && "zoom" in payload) {
      return payload;
    }

    if ("flowTransform" in payload && payload.flowTransform) {
      return payload.flowTransform;
    }

    return runtime.currentViewport.value;
  }

  function needsViewportSelectionBoundsRefresh() {
    return (
      runtime.selectedNodeIds.value.size > 1 ||
      runtime.isLassoSelecting.value ||
      runtime.lassoPreviewNodeIds.value.size > 0 ||
      runtime.rightSelection.value !== null ||
      runtime.interaction.selectionMoveDrag !== null ||
      runtime.isMovingSelection.value
    );
  }

  function refreshSelectionBounds(payload?: MovePayload) {
    runtime.currentViewport.value = getViewportFromPayload(payload);

    if (needsViewportSelectionBoundsRefresh()) {
      scheduleSelectionBoundsRefresh();
    }
  }

  function handleViewportMove(payload?: MovePayload) {
    refreshSelectionBounds(payload);
  }

  function cleanupViewport() {
    if (runtime.timers.selectionBoundsFrame) {
      window.cancelAnimationFrame(runtime.timers.selectionBoundsFrame);
      runtime.timers.selectionBoundsFrame = undefined;
    }
  }

  return {
    cleanupViewport,
    handleViewportMove,
    refreshSelectionBounds,
    scheduleSelectionBoundsRefresh,
    updateCanvasSize
  };
}
