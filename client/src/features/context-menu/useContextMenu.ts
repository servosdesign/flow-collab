import type { EdgeMouseEvent, NodeMouseEvent } from "@vue-flow/core";
import { computed } from "vue";
import type { SyncEdge } from "@vue-flow-sync/shared";
import type { FlowEditorServices } from "../../app/flowEditorServices";
import type { FlowEdge } from "../../domain/graph";
import type { FlowRuntime } from "../../flowRuntime";

export function useContextMenu(runtime: FlowRuntime, services: FlowEditorServices) {
  const selectedLabel = computed(() => {
    const target = runtime.contextTarget.value;

    if (!target) {
      return "Selection";
    }

    if (target.kind === "selection") {
      return `${target.ids.length} nodes`;
    }

    return target.kind === "node" ? "Node" : "Edge";
  });

  const duplicateCountValue = computed(() =>
    Math.max(1, Math.min(20, Math.floor(Number(runtime.duplicateCount.value) || 1)))
  );

  function getSelectedNodeIds() {
    return services.getSelectedNodeIds();
  }

  function selectOnlyNode(nodeId: string) {
    services.selectOnlyNode(nodeId);
  }

  function closeContextMenu() {
    runtime.contextTarget.value = null;
    runtime.duplicateCount.value = 1;
  }

  function openNodeContextMenu(payload: NodeMouseEvent) {
    if (!runtime.isLoggedIn.value || !(payload.event instanceof MouseEvent)) {
      return;
    }

    payload.event.preventDefault();
    payload.event.stopPropagation();

    if (!getSelectedNodeIds().includes(payload.node.id)) {
      selectOnlyNode(payload.node.id);
    }

    const selectedIds = getSelectedNodeIds();

    if (selectedIds.length > 1 && selectedIds.includes(payload.node.id)) {
      runtime.duplicateCount.value = 1;
      runtime.contextTarget.value = {
        kind: "selection",
        ids: selectedIds,
        x: payload.event.clientX,
        y: payload.event.clientY
      };
      return;
    }

    runtime.duplicateCount.value = 1;
    runtime.contextTarget.value = {
      kind: "node",
      id: payload.node.id,
      x: payload.event.clientX,
      y: payload.event.clientY
    };
  }

  function openNodeMenuButton(nodeId: string, event: MouseEvent) {
    if (!runtime.isLoggedIn.value) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const selectedIds = getSelectedNodeIds();

    if (selectedIds.length > 1 && selectedIds.includes(nodeId)) {
      runtime.duplicateCount.value = 1;
      runtime.contextTarget.value = {
        kind: "selection",
        ids: selectedIds,
        x: event.clientX,
        y: event.clientY
      };
      return;
    }

    selectOnlyNode(nodeId);
    runtime.duplicateCount.value = 1;
    runtime.contextTarget.value = {
      kind: "node",
      id: nodeId,
      x: event.clientX,
      y: event.clientY
    };
  }

  function openSelectionContextMenu(payload: { event: MouseEvent; nodes: Array<{ id: string }> }) {
    if (!runtime.isLoggedIn.value) {
      return;
    }

    payload.event.preventDefault();
    payload.event.stopPropagation();

    runtime.duplicateCount.value = 1;
    runtime.contextTarget.value = {
      kind: "selection",
      ids: payload.nodes.map((node) => node.id),
      x: payload.event.clientX,
      y: payload.event.clientY
    };
  }

  function openEdgeContextMenu(payload: EdgeMouseEvent) {
    if (!runtime.isLoggedIn.value || !(payload.event instanceof MouseEvent)) {
      return;
    }

    payload.event.preventDefault();
    payload.event.stopPropagation();
    runtime.duplicateCount.value = 1;
    runtime.contextTarget.value = {
      kind: "edge",
      id: payload.edge.id,
      x: payload.event.clientX,
      y: payload.event.clientY
    };
  }

  function openSelectedBoundsContextMenu(event: MouseEvent) {
    const selectedIds = getSelectedNodeIds();

    if (!runtime.isLoggedIn.value || selectedIds.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    runtime.duplicateCount.value = 1;
    runtime.contextTarget.value = {
      kind: "selection",
      ids: selectedIds,
      x: event.clientX,
      y: event.clientY
    };
  }

  function deleteContextTarget() {
    const target = runtime.contextTarget.value;
    const document = runtime.flowDocument.value;

    if (!target || !document) {
      return;
    }

    if (target.kind === "selection") {
      services.deleteNodesById(target.ids);
      return;
    }

    if (target.kind === "edge") {
      const nextEdges = document.data.edges.filter((edge) => edge.id !== target.id);
      runtime.edges.value = nextEdges as FlowEdge[];
      services.submitOperation([
        {
          p: ["edges"],
          od: document.data.edges,
          oi: nextEdges
        }
      ]);
      closeContextMenu();
      return;
    }

    services.deleteNodesById([target.id]);
  }

  function duplicateContextTarget() {
    const target = runtime.contextTarget.value;
    const document = runtime.flowDocument.value;

    if (!target || !document) {
      return;
    }

    const suffix = Date.now();

    if (target.kind === "selection") {
      services.duplicateNodesById(target.ids, duplicateCountValue.value);
      return;
    }

    if (target.kind === "edge") {
      const edge = document.data.edges.find((candidate) => candidate.id === target.id);

      if (!edge) {
        return;
      }

      const duplicateEdges: SyncEdge[] = Array.from(
        { length: duplicateCountValue.value },
        (_, index) => ({
          ...edge,
          id: `${edge.id}-copy-${suffix}-${index + 1}`
        })
      );
      const nextEdges = [...document.data.edges, ...duplicateEdges];
      runtime.edges.value = nextEdges as FlowEdge[];
      services.submitOperation([
        {
          p: ["edges"],
          od: document.data.edges,
          oi: nextEdges
        }
      ]);
      closeContextMenu();
      return;
    }

    services.duplicateNodesById([target.id], duplicateCountValue.value);
  }

  function handleCanvasContextMenu(event: MouseEvent) {
    event.preventDefault();

    if (runtime.interaction.suppressNextContextMenu) {
      runtime.interaction.suppressNextContextMenu = false;
      return;
    }

    const selectedBounds = services.getSelectedClientBounds();

    if (
      selectedBounds &&
      getSelectedNodeIds().length > 0 &&
      event.clientX >= selectedBounds.left &&
      event.clientX <= selectedBounds.right &&
      event.clientY >= selectedBounds.top &&
      event.clientY <= selectedBounds.bottom
    ) {
      event.stopPropagation();
      runtime.duplicateCount.value = 1;
      runtime.contextTarget.value = {
        kind: "selection",
        ids: getSelectedNodeIds(),
        x: event.clientX,
        y: event.clientY
      };
      return;
    }

    if (services.isCanvasSelectionTarget(event.target)) {
      closeContextMenu();
    }
  }

  return {
    closeContextMenu,
    deleteContextTarget,
    duplicateContextTarget,
    duplicateCountValue,
    handleCanvasContextMenu,
    openEdgeContextMenu,
    openNodeContextMenu,
    openNodeMenuButton,
    openSelectedBoundsContextMenu,
    openSelectionContextMenu,
    selectedLabel
  };
}
