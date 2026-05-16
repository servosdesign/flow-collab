<script setup lang="ts">
import { BaseEdge, Position, getSmoothStepPath, type EdgeProps } from "@vue-flow/core";
import { computed } from "vue";

const props = defineProps<EdgeProps>();

function isInsideSection(
  node: EdgeProps["sourceNode"] | null,
  section: EdgeProps["sourceNode"] | null
) {
  return Boolean(node && section && node.parentNode === section.id);
}

function portEndpointX(
  x: number,
  handleId: string | undefined,
  sectionNode: EdgeProps["sourceNode"],
  otherNode: EdgeProps["sourceNode"]
) {
  const isInside = isInsideSection(otherNode, sectionNode);
  const portGap = 0;

  if (handleId === "section-left") {
    return isInside ? x + portGap : x - portGap;
  }

  if (handleId === "section-right") {
    return isInside ? x - portGap : x + portGap;
  }

  return x;
}

function sectionPortPosition(
  handleId: string | undefined,
  sectionNode: EdgeProps["sourceNode"],
  otherNode: EdgeProps["sourceNode"],
  fallback: Position
) {
  if (handleId === "section-left") {
    return isInsideSection(otherNode, sectionNode) ? Position.Right : Position.Left;
  }

  if (handleId === "section-right") {
    return isInsideSection(otherNode, sectionNode) ? Position.Left : Position.Right;
  }

  return fallback;
}

const edgePath = computed(() => {
  const sourcePosition = sectionPortPosition(
    props.sourceHandleId,
    props.sourceNode,
    props.targetNode,
    props.sourcePosition
  );
  const targetPosition = sectionPortPosition(
    props.targetHandleId,
    props.targetNode,
    props.sourceNode,
    props.targetPosition
  );
  const sourceX = props.sourceNode
    ? portEndpointX(props.sourceX, props.sourceHandleId, props.sourceNode, props.targetNode)
    : props.sourceX;
  const targetX = props.targetNode
    ? portEndpointX(props.targetX, props.targetHandleId, props.targetNode, props.sourceNode)
    : props.targetX;
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY: props.sourceY,
    sourcePosition,
    targetX,
    targetY: props.targetY,
    targetPosition,
    borderRadius: 0,
    offset: 8
  });

  return path;
});
</script>

<template>
  <BaseEdge
    :id="id"
    class="section-through-edge"
    :path="edgePath"
    :marker-start="markerStart"
    :marker-end="markerEnd"
    :interaction-width="interactionWidth"
  />
</template>
