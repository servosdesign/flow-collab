import type { FlowRuntime } from "./flowRuntime";

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

  function refreshSelectionBounds() {
    runtime.currentViewport.value = runtime.toObject().viewport;
    scheduleSelectionBoundsRefresh();
  }

  function handleViewportMove() {
    refreshSelectionBounds();
    updateCanvasSize();
  }

  function handleCanvasViewportInteraction() {
    window.requestAnimationFrame(refreshSelectionBounds);
  }

  function cleanupViewport() {
    if (runtime.timers.selectionBoundsFrame) {
      window.cancelAnimationFrame(runtime.timers.selectionBoundsFrame);
      runtime.timers.selectionBoundsFrame = undefined;
    }
  }

  return {
    cleanupViewport,
    handleCanvasViewportInteraction,
    handleViewportMove,
    refreshSelectionBounds,
    scheduleSelectionBoundsRefresh,
    updateCanvasSize
  };
}
