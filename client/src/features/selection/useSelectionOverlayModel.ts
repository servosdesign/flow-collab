import { computed } from "vue";
import type { FlowEditorServices } from "../../app/flowEditorServices";
import {
  createGraphCache,
  getNodeBounds
} from "../../domain/graph";
import type { FlowRuntime } from "../../flowRuntime";

export function useSelectionOverlayModel(
  runtime: FlowRuntime,
  services: FlowEditorServices
) {
  const selectedBoundsStyle = computed<Record<string, string> | null>(() => {
    if (
      !runtime.isLoggedIn.value ||
      runtime.rightSelection.value
    ) {
      return null;
    }

    runtime.selectionBoundsVersion.value;
    const graphNodes = services.getCurrentSyncNodes();
    const graph = createGraphCache(graphNodes);
    const viewport = runtime.currentViewport.value;
    const sectionDragPreview = runtime.sectionNodeDragPreview.value;

    if (sectionDragPreview) {
      const section = graph.nodeById.get(sectionDragPreview.sectionId);

      if (!section) {
        return null;
      }

      const bounds = getNodeBounds(section, graph);
      const padding = 4;

      return {
        left: `${bounds.x * viewport.zoom + viewport.x - padding}px`,
        top: `${bounds.y * viewport.zoom + viewport.y - padding}px`,
        width: `${bounds.width * viewport.zoom + padding * 2}px`,
        height: `${bounds.height * viewport.zoom + padding * 2}px`
      };
    }

    if (runtime.selectedNodeIds.value.size < 2) {
      return null;
    }

    const selectionMoveDrag = runtime.interaction.selectionMoveDrag;
    if (selectionMoveDrag?.selectedBounds) {
      return {
        left: `${selectionMoveDrag.selectedBounds.left}px`,
        top: `${selectionMoveDrag.selectedBounds.top}px`,
        width: `${selectionMoveDrag.selectedBounds.width}px`,
        height: `${selectionMoveDrag.selectedBounds.height}px`
      };
    }

    const selectedIds = runtime.selectedNodeIds.value;
    let selectedCount = 0;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const node of graphNodes) {
      if (!selectedIds.has(node.id)) {
        continue;
      }

      const bounds = getNodeBounds(node, graph);
      const x = bounds.x * viewport.zoom + viewport.x;
      const y = bounds.y * viewport.zoom + viewport.y;
      const width = bounds.width * viewport.zoom;
      const height = bounds.height * viewport.zoom;

      selectedCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + height);
    }

    if (selectedCount === 0) {
      return null;
    }

    const padding = 4;

    return {
      left: `${minX - padding}px`,
      top: `${minY - padding}px`,
      width: `${maxX - minX + padding * 2}px`,
      height: `${maxY - minY + padding * 2}px`
    };
  });

  const isSingleNodeSelection = computed(() => runtime.selectedNodeIds.value.size <= 1);

  function getSelectedClientBounds() {
    const style = selectedBoundsStyle.value;
    const panelRect = runtime.canvasPanel.value?.getBoundingClientRect();

    if (!style || !panelRect) {
      return null;
    }

    const left = panelRect.left + Number.parseFloat(style.left);
    const top = panelRect.top + Number.parseFloat(style.top);
    const width = Number.parseFloat(style.width);
    const height = Number.parseFloat(style.height);

    return {
      left,
      top,
      right: left + width,
      bottom: top + height
    };
  }

  function isPointInsideSelectedBounds(event: PointerEvent | MouseEvent) {
    if (runtime.selectedNodeIds.value.size < 2) {
      return false;
    }

    const selectedBounds = getSelectedClientBounds();

    return Boolean(
      selectedBounds &&
        event.clientX >= selectedBounds.left &&
        event.clientX <= selectedBounds.right &&
        event.clientY >= selectedBounds.top &&
        event.clientY <= selectedBounds.bottom
    );
  }

  return {
    getSelectedClientBounds,
    isPointInsideSelectedBounds,
    isSingleNodeSelection,
    selectedBoundsStyle
  };
}
