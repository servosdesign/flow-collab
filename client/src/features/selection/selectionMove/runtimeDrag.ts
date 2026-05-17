import type { NodeChange, NodeDragItem } from '@vue-flow/core'
import type { SyncNode } from '@vue-flow-sync/shared'
import {
  createGraphCache,
  getAbsolutePosition,
  getNodeSize,
  getOverlapRatio,
  type FlowEdge,
  type FlowNode
} from '../../../domain/graph'
import type { FlowRuntime } from '../../../flowRuntime'
import type {
  SelectionMoveDrag,
  SelectionMoveRuntimeSnapshot
} from '../../../flowTypes'
import {
  sectionDragClass,
  sectionDragOverLargerClass
} from './constants'
import { buildSectionDragCandidatesById } from './metadata'
import type {
  RuntimePositionedFlowNode,
  SelectionMoveDeltaGetter,
  SelectionMoveDragMetadata
} from './types'

const hasClassName = (className: FlowNode['class'] | FlowEdge['class'], name: string) => {
  if (typeof className === 'string') {
    return className.split(/\s+/).includes(name)
  }

  if (Array.isArray(className)) {
    return className.includes(name)
  }

  if (className && typeof className === 'object') {
    return Boolean((className as Record<string, unknown>)[name])
  }

  return false
}

const withClassName = <T extends FlowNode['class'] | FlowEdge['class']>(
  className: T,
  name: string
) : T => {
  if (typeof className === 'string') {
    const classNames = className.split(/\s+/).filter(Boolean)

    if (!classNames.includes(name)) {
      classNames.push(name)
    }

    return classNames.join(' ') as T
  }

  if (Array.isArray(className)) {
    return (className.includes(name) ? className : [...className, name]) as T
  }

  if (className && typeof className === 'object') {
    return (hasClassName(className, name)
      ? className
      : { ...className, [name]: true }) as T
  }

  return name as T
}

const withoutClassNames = <T extends FlowNode['class'] | FlowEdge['class']>(
  className: T,
  names: string[]
) : T => {
  if (typeof className === 'string') {
    return className
      .split(/\s+/)
      .filter((name) => name && !names.includes(name))
      .join(' ') as T
  }

  if (Array.isArray(className)) {
    return className.filter((name) => !names.includes(name)) as T
  }

  if (className && typeof className === 'object') {
    const nextClassName = { ...(className as Record<string, unknown>) }

    names.forEach((name) => {
      delete nextClassName[name]
    })

    return nextClassName as T
  }

  return className
}

export const createSelectionMoveRuntimeDrag = (
  runtime: FlowRuntime,
  getSelectionMoveDelta: SelectionMoveDeltaGetter
) => {
  const getRuntimeNodeAbsolutePosition = (
    node: RuntimePositionedFlowNode,
    seenIds = new Set<string>()
  ) : { x: number, y: number } => {
    if (
      typeof node.computedPosition?.x === 'number' &&
      typeof node.computedPosition.y === 'number'
    ) {
      return {
        x: node.computedPosition.x,
        y: node.computedPosition.y
      }
    }

    if (!node.parentNode || seenIds.has(node.id)) {
      return {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y)
      }
    }

    seenIds.add(node.id)

    const parent = runtime.findNode(node.parentNode) as RuntimePositionedFlowNode | undefined
    const parentPosition = parent
      ? getRuntimeNodeAbsolutePosition(parent, seenIds)
      : { x: 0, y: 0 }

    return {
      x: Math.round(parentPosition.x + node.position.x),
      y: Math.round(parentPosition.y + node.position.y)
    }
  }

  const getRuntimeNodeDimensions = (node: RuntimePositionedFlowNode, syncNode: SyncNode) => {
    const width = node.dimensions?.width
    const height = node.dimensions?.height

    if (
      typeof width === 'number' &&
      Number.isFinite(width) &&
      typeof height === 'number' &&
      Number.isFinite(height)
    ) {
      return { width, height }
    }

    return getNodeSize(
      syncNode,
      syncNode.type === 'section' ? 720 : 240,
      syncNode.type === 'section' ? 620 : 190
    )
  }

  const buildSelectionMoveRuntimeSnapshots = (movingIds: Set<string>) => {
    const snapshotsById = new Map<string, SelectionMoveRuntimeSnapshot>()

    movingIds.forEach((nodeId) => {
      const node = runtime.findNode(nodeId) as RuntimePositionedFlowNode | undefined

      if (!node) {
        return
      }

      const hasComputedPosition = Object.prototype.hasOwnProperty.call(node, 'computedPosition')
      const hasDragging = Object.prototype.hasOwnProperty.call(node, 'dragging')
      const hasClass = Object.prototype.hasOwnProperty.call(node, 'class')

      snapshotsById.set(nodeId, {
        id: nodeId,
        position: { ...node.position },
        hadClass: hasClass,
        className: node.class,
        hadComputedPosition: hasComputedPosition,
        computedPosition: node.computedPosition ? { ...node.computedPosition } : undefined,
        hadDragging: hasDragging,
        dragging: node.dragging
      })
    })

    return snapshotsById
  }

  const buildSelectionMoveDragMetadata = (
    originalSyncNodes: SyncNode[],
    movingIds: Set<string>
  ) => {
    const graph = createGraphCache(originalSyncNodes)
    const dragItems: NodeDragItem[] = []
    const originalPositionsById = new Map<string, { x: number, y: number }>()

    movingIds.forEach((nodeId) => {
      const syncNode = graph.nodeById.get(nodeId)

      if (!syncNode) {
        return
      }

      const flowNode = runtime.findNode(nodeId) as RuntimePositionedFlowNode | undefined
      const absolutePosition = flowNode?.computedPosition
        ? {
          x: flowNode.computedPosition.x,
          y: flowNode.computedPosition.y
        }
        : getAbsolutePosition(syncNode, graph)
      const dimensions = flowNode?.dimensions?.width && flowNode.dimensions.height
        ? {
          width: flowNode.dimensions.width,
          height: flowNode.dimensions.height
        }
        : getNodeSize(syncNode, syncNode.type === 'section' ? 720 : 240, syncNode.type === 'section' ? 620 : 190)

      originalPositionsById.set(nodeId, absolutePosition)
      dragItems.push({
        id: nodeId,
        position: { ...absolutePosition },
        distance: { x: 0, y: 0 },
        dimensions,
        from: { ...absolutePosition },
        extent: flowNode?.extent,
        parentNode: syncNode.parentNode,
        expandParent: syncNode.expandParent ?? flowNode?.expandParent
      })
    })

    const runtimeSnapshotsById = buildSelectionMoveRuntimeSnapshots(movingIds)
    const sectionDragCandidatesById = buildSectionDragCandidatesById(graph, dragItems, movingIds)

    return {
      dragItems,
      originalPositionsById,
      runtimeSnapshotsById,
      sectionDragCandidatesById
    }
  }

  const updateSelectionDragItemPositions = (selectionMoveDrag: SelectionMoveDrag) => {
    const delta = getSelectionMoveDelta(selectionMoveDrag)
    let changed = false

    selectionMoveDrag.dragItems.forEach((dragItem) => {
      const originalPosition = selectionMoveDrag.originalPositionsById.get(dragItem.id) ?? dragItem.from
      const nextPosition = {
        x: Math.round(originalPosition.x + delta.x),
        y: Math.round(originalPosition.y + delta.y)
      }

      if (dragItem.position.x !== nextPosition.x || dragItem.position.y !== nextPosition.y) {
        changed = true
      }

      dragItem.position = nextPosition
    })

    return changed
  }

  const getDragItemRuntimePosition = (dragItem: NodeDragItem) => {
    if (!dragItem.parentNode) {
      return { ...dragItem.position }
    }

    const parentNode = runtime.findNode(dragItem.parentNode) as RuntimePositionedFlowNode | undefined

    return {
      x: Math.round(dragItem.position.x - (parentNode?.computedPosition?.x ?? 0)),
      y: Math.round(dragItem.position.y - (parentNode?.computedPosition?.y ?? 0))
    }
  }

  const getDragItemComputedPosition = (
    dragItem: NodeDragItem,
    node: RuntimePositionedFlowNode
  ) => {
    return {
      ...(node.computedPosition ?? { z: 0 }),
      x: dragItem.position.x,
      y: dragItem.position.y
    }
  }

  const isDragItemOverLargerSection = (
    dragItem: NodeDragItem,
    selectionMoveDrag: SelectionMoveDrag
  ) => {
    const candidates = selectionMoveDrag.sectionDragCandidatesById.get(dragItem.id)

    if (!candidates?.length) {
      return false
    }

    const draggedBounds = {
      x: dragItem.position.x,
      y: dragItem.position.y,
      width: dragItem.dimensions.width,
      height: dragItem.dimensions.height
    }

    return candidates.some((candidate) => getOverlapRatio(draggedBounds, candidate.bounds) >= 0.5)
  }

  const getDragItemClassName = (
    node: RuntimePositionedFlowNode,
    dragItem: NodeDragItem,
    selectionMoveDrag: SelectionMoveDrag,
    dragging: boolean
  ) => {
    const baseClassName = withoutClassNames(node.class, [
      sectionDragClass,
      sectionDragOverLargerClass
    ])

    if (!dragging || node.type !== 'section' || !selectionMoveDrag.movingIds.has(node.id)) {
      return baseClassName
    }

    const draggingClassName = withClassName(baseClassName, sectionDragClass)

    if (isDragItemOverLargerSection(dragItem, selectionMoveDrag)) {
      return withClassName(draggingClassName, sectionDragOverLargerClass)
    }

    return draggingClassName
  }

  const applyRuntimeDragItemPositions = (
    selectionMoveDrag: SelectionMoveDrag,
    dragging: boolean
  ) => {
    const changes: NodeChange[] = []
    const runtimeUpdates: Array<{
      id: string
      position: { x: number, y: number }
      computedPosition: { x: number, y: number, z?: number }
      className: FlowNode['class']
    }> = []

    selectionMoveDrag.dragItems.forEach((dragItem) => {
      const node = runtime.findNode(dragItem.id) as RuntimePositionedFlowNode | undefined

      if (!node) {
        return
      }

      const nextPosition = getDragItemRuntimePosition(dragItem)
      const nextComputedPosition = getDragItemComputedPosition(dragItem, node)
      const positionChanged =
        node.position.x !== nextPosition.x ||
        node.position.y !== nextPosition.y ||
        node.dragging !== dragging
      const computedPositionChanged =
        node.computedPosition?.x !== nextComputedPosition.x ||
        node.computedPosition?.y !== nextComputedPosition.y
      const nextClassName = getDragItemClassName(node, dragItem, selectionMoveDrag, dragging)
      const classChanged = node.class !== nextClassName

      if (!positionChanged && !computedPositionChanged && !classChanged) {
        return
      }

      if (positionChanged) {
        changes.push({
          id: dragItem.id,
          type: 'position',
          position: nextPosition,
          from: dragItem.from,
          dragging
        })
      }

      runtimeUpdates.push({
        id: dragItem.id,
        position: nextPosition,
        computedPosition: nextComputedPosition,
        className: nextClassName
      })
    })

    if (changes.length > 0) {
      runtime.applyNodeChanges(changes)
    }

    runtimeUpdates.forEach((update) => {
      const node = runtime.findNode(update.id) as RuntimePositionedFlowNode | undefined

      if (!node) {
        return
      }

      if (
        node.position.x !== update.position.x ||
        node.position.y !== update.position.y
      ) {
        node.position = update.position
      }

      node.computedPosition = update.computedPosition
      node.dragging = dragging
      node.class = update.className
    })
  }

  const restoreSelectionMoveRuntimeSnapshots = (drag: SelectionMoveDrag) => {
    drag.runtimeSnapshotsById.forEach((snapshot) => {
      const node = runtime.findNode(snapshot.id) as RuntimePositionedFlowNode | undefined

      if (!node) {
        return
      }

      node.position = { ...snapshot.position }

      if (snapshot.hadClass) {
        node.class = snapshot.className
      } else {
        delete node.class
      }

      if (snapshot.hadComputedPosition && snapshot.computedPosition) {
        node.computedPosition = { ...snapshot.computedPosition }
      } else {
        delete node.computedPosition
      }

      if (snapshot.hadDragging) {
        node.dragging = snapshot.dragging
      } else {
        delete node.dragging
      }
    })
  }

  const applyVisibleSelectionMove = (
    selectionMoveDrag: SelectionMoveDrag,
    dragging: boolean
  ) => {
    const changed = updateSelectionDragItemPositions(selectionMoveDrag)

    if (changed || !dragging) {
      applyRuntimeDragItemPositions(selectionMoveDrag, dragging)
    }
  }

  const buildSingleSectionDragMetadata = (
    sectionNode: RuntimePositionedFlowNode,
    syncSection: SyncNode,
    movingIds: Set<string>
  ) : SelectionMoveDragMetadata => {
    const absolutePosition = getRuntimeNodeAbsolutePosition(sectionNode)
    const dimensions = getRuntimeNodeDimensions(sectionNode, syncSection)
    const dragItem: NodeDragItem = {
      id: syncSection.id,
      position: { ...absolutePosition },
      distance: { x: 0, y: 0 },
      dimensions,
      from: { ...absolutePosition },
      extent: sectionNode.extent,
      parentNode: syncSection.parentNode,
      expandParent: syncSection.expandParent ?? sectionNode.expandParent
    }

    return {
      dragItems: [dragItem],
      originalPositionsById: new Map([[syncSection.id, absolutePosition]]),
      runtimeSnapshotsById: buildSelectionMoveRuntimeSnapshots(movingIds),
      sectionDragCandidatesById: new Map()
    }
  }

  return {
    applyVisibleSelectionMove,
    buildSelectionMoveDragMetadata,
    buildSelectionMoveRuntimeSnapshots,
    buildSingleSectionDragMetadata,
    getRuntimeNodeAbsolutePosition,
    getRuntimeNodeDimensions,
    restoreSelectionMoveRuntimeSnapshots
  }
}
