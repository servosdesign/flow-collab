import type { SyncNode } from '@vue-flow-sync/shared'
import { nextTick } from 'vue'
import type { JsonOp } from 'sharedb/lib/client'
import type { FlowEditorServices } from '../../../app/flowEditorServices'
import {
  applySectionMembershipForMovedNodes,
  createGraphCache,
  findContainingSectionForBounds,
  getNodeSize,
  getRenderedNodeBounds,
  getOverlapRatio,
  isAncestorSection,
  isNodeInsideSection,
  sameJson,
  stripParentExtent,
  withDefaultEdges,
  type FlowNode
} from '../../../domain/graph'
import type { FlowRuntime } from '../../../flowRuntime'
import type { SelectionMoveDrag } from '../../../flowTypes'
import type { SelectionMoveDeltaGetter } from './types'

type PositionOnlyNodeChange = {
  index: number
  oldNode: SyncNode
  nextNode: SyncNode
}

type SelectionMoveCommitOptions = {
  applyVisibleSelectionMove: (selectionMoveDrag: SelectionMoveDrag, dragging: boolean) => void
  bumpMiniMapGeometryVersion: () => void
  getSelectionMoveDelta: SelectionMoveDeltaGetter
  restoreSelectionMoveRuntimeSnapshots: (drag: SelectionMoveDrag) => void
}

const getNodeIndexById = (nodes: SyncNode[]) => {
  return new Map(nodes.map((node, index) => [node.id, index]))
}

export const createSelectionMoveCommit = (
  runtime: FlowRuntime,
  services: FlowEditorServices,
  options: SelectionMoveCommitOptions
) => {
  const buildCommittedSelectionMoveNodes = (
    selectionMoveDrag: SelectionMoveDrag,
    baseNodes = selectionMoveDrag.originalSyncNodes
  ) => {
    const delta = options.getSelectionMoveDelta(selectionMoveDrag)

    return baseNodes.map((node) => {
      if (!selectionMoveDrag.movingIds.has(node.id)) {
        return node
      }

      const originalNode = selectionMoveDrag.originalSyncNodesById.get(node.id)

      if (!originalNode) {
        return node
      }

      const nextPosition = {
        x: Math.round(originalNode.position.x + delta.x),
        y: Math.round(originalNode.position.y + delta.y)
      }

      if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) {
        return node
      }

      return {
        ...node,
        position: nextPosition
      }
    })
  }

  const hasCommittedSelectionMovePositionChange = (selectionMoveDrag: SelectionMoveDrag) => {
    const delta = options.getSelectionMoveDelta(selectionMoveDrag)

    for (const nodeId of selectionMoveDrag.movingIds) {
      const node = selectionMoveDrag.originalSyncNodesById.get(nodeId)

      if (!node) {
        continue
      }

      if (
        Math.round(node.position.x + delta.x) !== node.position.x ||
        Math.round(node.position.y + delta.y) !== node.position.y
      ) {
        return true
      }
    }

    return false
  }

  const getStableNodeChanges = (documentNodes: SyncNode[], nextNodes: SyncNode[]) => {
    if (documentNodes.length !== nextNodes.length) {
      return null
    }

    const changes: PositionOnlyNodeChange[] = []

    for (let index = 0; index < documentNodes.length; index += 1) {
      const oldNode = documentNodes[index]
      const nextNode = nextNodes[index]

      if (oldNode.id !== nextNode.id) {
        return null
      }

      if (!sameJson(oldNode, nextNode)) {
        changes.push({ index, oldNode, nextNode })
      }
    }

    return changes
  }

  const isPositionOnlyNodeChange = (oldNode: SyncNode, nextNode: SyncNode) => {
    if (oldNode.id !== nextNode.id) {
      return false
    }

    return sameJson(oldNode, {
      ...nextNode,
      position: oldNode.position
    })
  }

  const submitPositionOnlySelectionMove = (
    drag: SelectionMoveDrag,
    changes: PositionOnlyNodeChange[]
  ) => {
    options.applyVisibleSelectionMove(drag, false)
    options.bumpMiniMapGeometryVersion()

    services.submitOperation(
      changes.map(({ index, oldNode, nextNode }) => ({
        p: ['nodes', index],
        ld: oldNode,
        li: nextNode
      }) as JsonOp)
    )
  }

  const getDragItemById = (drag: SelectionMoveDrag) => {
    return new Map(drag.dragItems.map((dragItem) => [dragItem.id, dragItem]))
  }

  const getSafeItemPositionOnlySelectionMoveChanges = (
    drag: SelectionMoveDrag,
    documentNodes: SyncNode[]
  ) => {
    const graph = createGraphCache(documentNodes)
    const dragItemsById = getDragItemById(drag)
    const nodeIndexById = getNodeIndexById(documentNodes)
    const delta = options.getSelectionMoveDelta(drag)
    const changes: PositionOnlyNodeChange[] = []

    for (const nodeId of drag.movingIds) {
      const oldNode = graph.nodeById.get(nodeId)

      if (!oldNode || oldNode.type === 'section') {
        return null
      }

      const originalAbsolutePosition = drag.originalPositionsById.get(nodeId)

      if (!originalAbsolutePosition) {
        return null
      }

      const dragItem = dragItemsById.get(nodeId)
      const dimensions = dragItem?.dimensions ?? getNodeSize(oldNode, 240, 190)
      const nextAbsolutePosition = {
        x: Math.round(originalAbsolutePosition.x + delta.x),
        y: Math.round(originalAbsolutePosition.y + delta.y)
      }
      const containingSection = findContainingSectionForBounds(
        nodeId,
        {
          ...nextAbsolutePosition,
          width: dimensions.width,
          height: dimensions.height
        },
        graph
      )
      const previousParentId = oldNode.parentNode ?? null

      if ((containingSection?.id ?? null) !== previousParentId) {
        return null
      }

      const nextPosition = previousParentId
        ? {
          x: Math.round(oldNode.position.x + delta.x),
          y: Math.round(oldNode.position.y + delta.y)
        }
        : nextAbsolutePosition

      if (oldNode.position.x === nextPosition.x && oldNode.position.y === nextPosition.y) {
        continue
      }

      const index = nodeIndexById.get(nodeId)

      if (index == null) {
        return null
      }

      changes.push({
        index,
        oldNode,
        nextNode: {
          ...oldNode,
          position: nextPosition
        }
      })
    }

    return changes
  }

  const getSafeSameParentSectionPositionOnlySelectionMoveChanges = (
    drag: SelectionMoveDrag,
    documentNodes: SyncNode[]
  ) => {
    if (drag.movingIds.size !== 1) {
      return null
    }

    const [sectionId] = Array.from(drag.movingIds)
    const graph = createGraphCache(documentNodes)
    const nodeIndexById = getNodeIndexById(documentNodes)
    const section = graph.nodeById.get(sectionId)

    if (!section || section.type !== 'section') {
      return null
    }

    const originalAbsolutePosition = drag.originalPositionsById.get(sectionId)

    if (!originalAbsolutePosition) {
      return null
    }

    const dragItem = getDragItemById(drag).get(sectionId)
    const dimensions = dragItem?.dimensions ?? getNodeSize(section, 720, 620)
    const delta = options.getSelectionMoveDelta(drag)
    const nextAbsolutePosition = {
      x: Math.round(originalAbsolutePosition.x + delta.x),
      y: Math.round(originalAbsolutePosition.y + delta.y)
    }
    const nextSectionBounds = {
      ...nextAbsolutePosition,
      width: dimensions.width,
      height: dimensions.height
    }
    const containingSection = findContainingSectionForBounds(sectionId, nextSectionBounds, graph)
    const previousParentId = section.parentNode ?? null

    if ((containingSection?.id ?? null) !== previousParentId) {
      return null
    }

    for (const node of graph.nodes) {
      if (
        node.id === sectionId ||
        isNodeInsideSection(node.id, sectionId, graph) ||
        isAncestorSection(node.id, sectionId, graph)
      ) {
        continue
      }

      if (getOverlapRatio(getRenderedNodeBounds(node, graph), nextSectionBounds) >= 0.5) {
        return null
      }
    }

    const nextPosition = previousParentId
      ? {
        x: Math.round(section.position.x + delta.x),
        y: Math.round(section.position.y + delta.y)
      }
      : nextAbsolutePosition

    if (section.position.x === nextPosition.x && section.position.y === nextPosition.y) {
      return []
    }

    const index = nodeIndexById.get(sectionId)

    if (index == null) {
      return null
    }

    return [{
      index,
      oldNode: section,
      nextNode: {
        ...section,
        position: nextPosition
      }
    }]
  }

  const getSafePositionOnlySelectionMoveChanges = (
    drag: SelectionMoveDrag,
    documentNodes: SyncNode[]
  ) => {
    return (
      getSafeItemPositionOnlySelectionMoveChanges(drag, documentNodes) ??
      getSafeSameParentSectionPositionOnlySelectionMoveChanges(drag, documentNodes)
    )
  }

  const getMovedSectionMembershipResults = (
    movingIds: Set<string>,
    previousNodes: SyncNode[],
    nextNodes: SyncNode[]
  ) => {
    const previousNodesById = new Map(previousNodes.map((node) => [node.id, node]))
    const nextNodesById = new Map(nextNodes.map((node) => [node.id, node]))

    return Array.from(movingIds)
      .map((nodeId) => {
        const previousNode = previousNodesById.get(nodeId)
        const nextNode = nextNodesById.get(nodeId)

        if (nextNode?.type !== 'section') {
          return null
        }

        const parentIndex = nextNode.parentNode
          ? nextNodes.findIndex((node) => node.id === nextNode.parentNode)
          : -1
        const childIndex = nextNodes.findIndex((node) => node.id === nextNode.id)

        return {
          sectionId: nextNode.id,
          previousParent: previousNode?.parentNode ?? null,
          nextParent: nextNode.parentNode ?? null,
          parentIndex,
          childIndex,
          parentBeforeChild: parentIndex >= 0 && childIndex >= 0 ? parentIndex < childIndex : null
        }
      })
      .filter(Boolean) as Array<{
      sectionId: string
      previousParent: string | null
      nextParent: string | null
      parentIndex: number
      childIndex: number
      parentBeforeChild: boolean | null
    }>
  }

  const refreshMovedSectionInternals = (
    results: ReturnType<typeof getMovedSectionMembershipResults>
  ) => {
    const nodeIds = Array.from(
      new Set(
        results.flatMap((result) =>
          result.nextParent ? [result.sectionId, result.nextParent] : [result.sectionId]
        )
      )
    )

    if (nodeIds.length === 0) {
      return
    }

    nextTick(() => {
      runtime.updateNodeInternals?.(nodeIds)
      window.requestAnimationFrame(() => runtime.updateNodeInternals?.(nodeIds))
    })
  }

  const commitMovedSelectedNodes = (drag: SelectionMoveDrag) => {
    const document = runtime.flowDocument.value
    const movingIds = drag.movingIds

    if (!document || movingIds.size === 0) {
      services.submitGraphSnapshot()
      return false
    }

    if (!hasCommittedSelectionMovePositionChange(drag)) {
      options.restoreSelectionMoveRuntimeSnapshots(drag)
      return false
    }

    const positionOnlyChanges = getSafePositionOnlySelectionMoveChanges(drag, document.data.nodes)

    if (positionOnlyChanges && positionOnlyChanges.length > 0) {
      submitPositionOnlySelectionMove(drag, positionOnlyChanges)
      return true
    }

    const nextNodes = buildCommittedSelectionMoveNodes(drag, document.data.nodes)
    const nextEdges = services.getCurrentSyncEdges(nextNodes)
    applySectionMembershipForMovedNodes(
      Array.from(movingIds, (nodeId) => ({ nodeId })),
      nextNodes,
      nextEdges,
      document.data.nodes
    )

    const membershipResults = getMovedSectionMembershipResults(
      movingIds,
      document.data.nodes,
      nextNodes
    )
    const nodeChanges = getStableNodeChanges(document.data.nodes, nextNodes)
    const edgesChanged = !sameJson(document.data.edges, nextEdges)
    const canSubmitPositionOnly =
      nodeChanges !== null &&
      !edgesChanged &&
      nodeChanges.length > 0 &&
      nodeChanges.every(({ oldNode, nextNode }) =>
        movingIds.has(nextNode.id) && isPositionOnlyNodeChange(oldNode, nextNode)
      )

    if (canSubmitPositionOnly) {
      submitPositionOnlySelectionMove(drag, nodeChanges)
      return true
    }

    runtime.nodes.value = services.withSelectionState(nextNodes.map(stripParentExtent) as FlowNode[])
    options.bumpMiniMapGeometryVersion()

    if (edgesChanged) {
      runtime.edges.value = withDefaultEdges(nextEdges, createGraphCache(nextNodes, nextEdges))
    }

    refreshMovedSectionInternals(membershipResults)
    services.submitOperation(
      [
        !sameJson(document.data.nodes, nextNodes) && {
          p: ['nodes'],
          od: document.data.nodes,
          oi: nextNodes
        },
        edgesChanged && {
          p: ['edges'],
          od: document.data.edges,
          oi: nextEdges
        }
      ].filter(Boolean) as JsonOp[]
    )
    return true
  }

  return {
    commitMovedSelectedNodes
  }
}
