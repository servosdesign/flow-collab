import type { SyncNode } from '@vue-flow-sync/shared'
import {
  createGraphCache,
  getNodeBounds,
  getRenderedNodeBounds,
  getOverlapRatio,
  isAncestorSection,
  type FlowNode
} from '../../../domain/graph'
import type {
  SectionDragCandidateBounds,
  SelectionMovePreviewCounts,
  SelectionMovePreviewShapeKind
} from '../../../flowTypes'
import { selectionBoundsPadding } from './constants'
import type { RuntimePositionedFlowNode } from './types'
import type { NodeDragItem } from '@vue-flow/core'

const hasSelectedAncestor = (
  node: SyncNode,
  selectedIds: Set<string>,
  allNodes: SyncNode[]
) => {
  let parentId = node.parentNode

  while (parentId) {
    if (selectedIds.has(parentId)) {
      return true
    }

    parentId = allNodes.find((candidate) => candidate.id === parentId)?.parentNode
  }

  return false
}

export const getMovableSelectedIds = (allNodes: SyncNode[], selectedNodeIds: string[]) => {
  const selectedIds = new Set(selectedNodeIds)

  return new Set(
    allNodes
      .filter((node) => selectedIds.has(node.id) && !hasSelectedAncestor(node, selectedIds, allNodes))
      .map((node) => node.id)
  )
}

export const isSectionFlowNode = (node: FlowNode) => {
  return node.type === 'section' || node.data?.nodeType === 'section'
}

export const getSingleSelectedTopLevelSectionNode = (
  selectedIds: string[],
  runtimeNodes: RuntimePositionedFlowNode[]
) => {
  const selectedIdSet = new Set(selectedIds)
  const nodeById = new Map(runtimeNodes.map((node) => [node.id, node]))
  const topLevelSelectedIds: string[] = []

  selectedIds.forEach((nodeId) => {
    const node = nodeById.get(nodeId)
    let parentId = node?.parentNode
    let selectedAncestorFound = false

    while (parentId) {
      if (selectedIdSet.has(parentId)) {
        selectedAncestorFound = true
        break
      }

      parentId = nodeById.get(parentId)?.parentNode
    }

    if (!selectedAncestorFound) {
      topLevelSelectedIds.push(nodeId)
    }
  })

  if (topLevelSelectedIds.length !== 1) {
    return null
  }

  const sectionNode = nodeById.get(topLevelSelectedIds[0])

  return sectionNode && isSectionFlowNode(sectionNode) ? sectionNode : null
}

export const addDescendantIds = (
  nodeId: string,
  graph: ReturnType<typeof createGraphCache>,
  ids: Set<string>
) => {
  const children = graph.childrenByParentId.get(nodeId) ?? []

  children.forEach((child) => {
    if (ids.has(child.id)) {
      return
    }

    ids.add(child.id)
    addDescendantIds(child.id, graph, ids)
  })
}

export const countSectionIds = (
  ids: Set<string>,
  graph: ReturnType<typeof createGraphCache>
) => {
  let count = 0

  ids.forEach((nodeId) => {
    if (graph.nodeById.get(nodeId)?.type === 'section') {
      count += 1
    }
  })

  return count
}

const buildRuntimeChildrenByParentId = (runtimeNodes: FlowNode[]) => {
  const childrenByParentId = new Map<string, FlowNode[]>()

  for (const node of runtimeNodes) {
    if (!node.parentNode) {
      continue
    }

    const children = childrenByParentId.get(node.parentNode) ?? []
    children.push(node)
    childrenByParentId.set(node.parentNode, children)
  }

  return childrenByParentId
}

export const buildRuntimeSectionHiddenIds = (runtimeNodes: FlowNode[], sectionId: string) => {
  const childrenByParentId = buildRuntimeChildrenByParentId(runtimeNodes)
  const hiddenIds = new Set([sectionId])
  let containedSectionCount = 0

  const addDescendants = (nodeId: string) => {
    const children = childrenByParentId.get(nodeId) ?? []

    children.forEach((child) => {
      if (hiddenIds.has(child.id)) {
        return
      }

      hiddenIds.add(child.id)

      if (isSectionFlowNode(child)) {
        containedSectionCount += 1
      }

      addDescendants(child.id)
    })
  }

  addDescendants(sectionId)

  return {
    hiddenIds,
    containedSectionCount
  }
}

export const buildSelectionMoveHiddenIds = (
  allNodes: SyncNode[],
  movingIds: Set<string>
) => {
  const graph = createGraphCache(allNodes)
  const hiddenIds = new Set(movingIds)

  movingIds.forEach((nodeId) => {
    const node = graph.nodeById.get(nodeId)

    if (node?.type === 'section') {
      addDescendantIds(nodeId, graph, hiddenIds)
    }
  })

  return hiddenIds
}

export const buildSelectionMovePreviewMetadata = (
  allNodes: SyncNode[],
  movingIds: Set<string>,
  hiddenIds: Set<string>
) => {
  const counts: SelectionMovePreviewCounts = {
    itemCount: 0,
    sectionCount: 0,
    containedCount: Math.max(0, hiddenIds.size - movingIds.size),
    containedSectionCount: 0
  }
  const shapeKinds: SelectionMovePreviewShapeKind[] = []

  allNodes.forEach((node) => {
    if (hiddenIds.has(node.id) && !movingIds.has(node.id) && node.type === 'section') {
      counts.containedSectionCount += 1
    }

    if (!movingIds.has(node.id)) {
      return
    }

    if (node.type === 'section') {
      counts.sectionCount += 1
      shapeKinds.push('section')
      return
    }

    counts.itemCount += 1
    shapeKinds.push('item')
  })

  return {
    counts,
    shapeKinds
  }
}

export const getSelectionFlowBoundsSnapshot = (
  nodeIds: Iterable<string>,
  allNodes: SyncNode[]
) => {
  const graph = createGraphCache(allNodes)
  const selectedIds = new Set(nodeIds)
  let selectedCount = 0
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const node of allNodes) {
    if (!selectedIds.has(node.id)) {
      continue
    }

    const bounds = getNodeBounds(node, graph)

    selectedCount += 1
    minX = Math.min(minX, bounds.x)
    minY = Math.min(minY, bounds.y)
    maxX = Math.max(maxX, bounds.x + bounds.width)
    maxY = Math.max(maxY, bounds.y + bounds.height)
  }

  if (selectedCount === 0) {
    return null
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    padding: selectionBoundsPadding
  }
}

export const buildSectionDragCandidatesById = (
  graph: ReturnType<typeof createGraphCache>,
  dragItems: NodeDragItem[],
  movingIds: Set<string>
) => {
  const candidatesById = new Map<string, SectionDragCandidateBounds[]>()
  const sectionBounds = graph.sections.map((section) => {
    const bounds = getNodeBounds(section, graph)

    return {
      section,
      bounds,
      area: Math.max(1, bounds.width * bounds.height)
    }
  })

  dragItems.forEach((dragItem) => {
    const draggedNode = graph.nodeById.get(dragItem.id)

    if (draggedNode?.type !== 'section') {
      return
    }

    const draggedArea = Math.max(1, dragItem.dimensions.width * dragItem.dimensions.height)
    const candidates: SectionDragCandidateBounds[] = []

    sectionBounds.forEach((candidate) => {
      if (
        candidate.section.id === dragItem.id ||
        movingIds.has(candidate.section.id) ||
        candidate.area <= draggedArea ||
        isAncestorSection(dragItem.id, candidate.section.id, graph)
      ) {
        return
      }

      candidates.push({
        id: candidate.section.id,
        bounds: candidate.bounds,
        area: candidate.area
      })
    })

    if (candidates.length > 0) {
      candidatesById.set(dragItem.id, candidates)
    }
  })

  return candidatesById
}

export const buildSectionDragDescendantIds = (
  sectionId: string,
  allNodes: SyncNode[],
  graph: ReturnType<typeof createGraphCache>
) => {
  const section = graph.nodeById.get(sectionId)
  const descendantIds = new Set<string>()

  if (section?.type !== 'section') {
    return null
  }

  addDescendantIds(sectionId, graph, descendantIds)
  const sectionBounds = getNodeBounds(section, graph)

  allNodes.forEach((node) => {
    if (
      node.id === sectionId ||
      descendantIds.has(node.id) ||
      isAncestorSection(node.id, sectionId, graph)
    ) {
      return
    }

    if (getOverlapRatio(getRenderedNodeBounds(node, graph), sectionBounds) >= 0.5) {
      descendantIds.add(node.id)

      if (node.type === 'section') {
        addDescendantIds(node.id, graph, descendantIds)
      }
    }
  })

  return descendantIds
}
