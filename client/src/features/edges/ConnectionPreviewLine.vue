<script setup lang="ts">
import {
  BaseEdge,
  Position,
  getSmoothStepPath,
  type ConnectionLineProps
} from '@vue-flow/core'
import { computed } from 'vue'

const props = defineProps<ConnectionLineProps>()

const isInsideSection = (
  node: ConnectionLineProps['sourceNode'] | null,
  section: ConnectionLineProps['sourceNode'] | null
) => {
  return Boolean(node && section && node.parentNode === section.id)
}

const portEndpointX = (
  x: number,
  handleId: string | undefined,
  sectionNode: ConnectionLineProps['sourceNode'] | null,
  otherNode: ConnectionLineProps['sourceNode'] | null,
  pointerInsideSection = false
) => {
  if (!sectionNode) {
    return x
  }

  const isInside = pointerInsideSection || isInsideSection(otherNode, sectionNode)
  const portGap = 0

  if (handleId === 'section-left') {
    return isInside ? x + portGap : x - portGap
  }

  if (handleId === 'section-right') {
    return isInside ? x - portGap : x + portGap
  }

  return x
}

const isPointInsideNode = (x: number, y: number, node: ConnectionLineProps['sourceNode']) => {
  return (
    x >= node.computedPosition.x &&
    x <= node.computedPosition.x + node.dimensions.width &&
    y >= node.computedPosition.y &&
    y <= node.computedPosition.y + node.dimensions.height
  )
}

const previewPath = computed(() => {
  const sourcePointerInside =
    Boolean(props.sourceNode) && isPointInsideNode(props.targetX, props.targetY, props.sourceNode)
  const sourcePosition =
    props.sourceHandle?.id === 'section-left'
      ? isInsideSection(props.targetNode, props.sourceNode) || sourcePointerInside
        ? Position.Right
        : Position.Left
      : props.sourceHandle?.id === 'section-right'
        ? isInsideSection(props.targetNode, props.sourceNode) || sourcePointerInside
          ? Position.Left
          : Position.Right
        : props.sourcePosition
  const targetPosition =
    props.targetHandle?.id === 'section-right'
      ? isInsideSection(props.sourceNode, props.targetNode)
        ? Position.Left
        : Position.Right
      : props.targetHandle?.id === 'section-left'
        ? isInsideSection(props.sourceNode, props.targetNode)
          ? Position.Right
          : Position.Left
        : props.targetPosition
  const sourceX = portEndpointX(
    props.sourceX,
    props.sourceHandle?.id ?? undefined,
    props.sourceNode,
    props.targetNode,
    sourcePointerInside
  )
  const targetX = portEndpointX(
    props.targetX,
    props.targetHandle?.id ?? undefined,
    props.targetNode,
    props.sourceNode
  )
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY: props.sourceY,
    sourcePosition,
    targetX,
    targetY: props.targetY,
    targetPosition,
    borderRadius: 0,
    offset: 8
  })

  return path
})
</script>

<template>
  <BaseEdge
    class="connection-preview-edge"
    :path="previewPath"
    :marker-start="markerStart"
    :marker-end="markerEnd"
  />
</template>
