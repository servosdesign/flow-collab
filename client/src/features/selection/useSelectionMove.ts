import type { NodeChange, NodeDragItem } from '@vue-flow/core'
import type { FlowViewport, SyncNode } from '@vue-flow-sync/shared'
import { computed, nextTick } from 'vue'
import type { JsonOp } from 'sharedb/lib/client'
import type { FlowEditorServices } from '../../app/flowEditorServices'
import {
  applySectionMembershipForMovedNodes,
  createGraphCache,
  getAbsolutePosition,
  getNodeBounds,
  getNodeSize,
  getRenderedNodeBounds,
  getOverlapRatio,
  isAncestorSection,
  normalizeNode,
  sameJson,
  stripParentExtent,
  withDefaultEdges,
  type FlowEdge,
  type FlowNode
} from '../../domain/graph'
import type { FlowRuntime } from '../../flowRuntime'
import type {
  SectionDragCandidateBounds,
  SelectionMoveDrag,
  SelectionMovePreviewCounts,
  SelectionMoveRuntimeSnapshot,
  SelectionMovePreviewShapeKind
} from '../../flowTypes'

type LargeSelectionMovePreviewMode = 'bundle' | 'visible'

const largeSelectionMovePreviewMode: LargeSelectionMovePreviewMode = 'bundle'
const largeSelectionMovePreviewThreshold = 8
const hideSelectedNodesDuringBundleMove = true
const maxSelectionMovePreviewShapes = 36
const nodePointerMoveThreshold = 3
const selectionBoundsPadding = 4
const sectionDragClass = 'section-dragging'
const sectionDragOverLargerClass = 'section-drag-over-larger-section'
const selectionMoveHiddenStyleId = 'vue-flow-sync-selection-move-hidden'
const selectionMoveMinZoom = 0.15
const selectionMoveMaxZoom = 1.4
const selectionMoveWheelZoomStep = 0.002

type UseSelectionMoveOptions = {
  getSelectedNodeIds: () => string[]
  commitPendingNodeSelection?: (nodeId: string, reason: 'click' | 'drop') => void
  cancelPendingNodeSelection?: (nodeId: string) => void
}

type SelectionMovePreviewShape = {
  id: number
  kind: SelectionMovePreviewShapeKind
}

type RuntimePositionedFlowNode = FlowNode & {
  computedPosition?: { x: number, y: number, z?: number }
  dragging?: boolean
}

type VisibleDragElementSnapshot = {
  id: string
  element: HTMLElement
  transform: string
  willChange: string
  zIndex: string
  pointerEvents: string
}

type SelectionMoveStartOptions = {
  startClientX: number
  startClientY: number
  currentClientX: number
  currentClientY: number
  pointerId: number
  target: HTMLElement | null
  previewElement: HTMLElement | null
  movingIds: Set<string>
  selectedFlowBounds: SelectionMoveDrag['selectedFlowBounds']
  normalizedOriginalNodes?: SyncNode[]
  forceVisible?: boolean
  hiddenIds?: Set<string>
  previewCounts?: SelectionMovePreviewCounts
  previewShapeKinds?: SelectionMovePreviewShapeKind[]
  movingIndexes?: number[]
  mode?: SelectionMoveDrag['mode']
  dragMetadata?: SelectionMoveDragMetadata
}

type SelectionMoveDragMetadata = {
  dragItems: NodeDragItem[]
  originalPositionsById: Map<string, { x: number, y: number }>
  runtimeSnapshotsById: Map<string, SelectionMoveRuntimeSnapshot>
  sectionDragCandidatesById: Map<string, SectionDragCandidateBounds[]>
}

type SingleSectionMoveStartMetadata = {
  syncSection: SyncNode
  movingIds: Set<string>
  hiddenIds: Set<string>
  previewCounts: SelectionMovePreviewCounts
  previewShapeKinds: SelectionMovePreviewShapeKind[]
  movingIndexes: number[]
  mode: SelectionMoveDrag['mode']
  selectedFlowBounds: SelectionMoveDrag['selectedFlowBounds']
  dragMetadata: SelectionMoveDragMetadata
}

type PendingNodePointerMove = {
  nodeId: string
  pointerId: number
  startClientX: number
  startClientY: number
  target: HTMLElement | null
  pendingSelectionNodeId?: string
  singleSectionMove?: SingleSectionMoveStartMetadata
}

type BeginNodePointerMoveOptions = {
  pendingSelectionNodeId?: string
}

export const useSelectionMove = (
  runtime: FlowRuntime,
  services: FlowEditorServices,
  options: UseSelectionMoveOptions
) => {
  let selectionMovePointerCaptureTarget: HTMLElement | null = null
  let selectionMovePreviewElement: HTMLElement | null = null
  let selectionMoveHiddenNodeIds = new Set<string>()
  let selectionMoveHiddenEdgeIds = new Set<string>()
  let selectionMovePointerId: number | null = null
  let pendingNodePointerMove: PendingNodePointerMove | null = null
  let activePendingSelectionNodeId: string | null = null
  let visibleDragElementSnapshots = new Map<string, VisibleDragElementSnapshot>()

  const bumpSelectionMovePreviewVersion = () => {
    runtime.selectionMovePreviewVersion.value += 1
  }

  const selectionMovePreview = computed(() => {
    const sectionDragPreview = runtime.sectionNodeDragPreview.value

    if (sectionDragPreview) {
      const showSummary = sectionDragPreview.showSummary

      return {
        active: true,
        coverContents: sectionDragPreview.hideStrategy === 'cover',
        showSummary,
        ...sectionDragPreview.previewCounts,
        shapes: showSummary ? [{ id: 0, kind: 'section' }] as SelectionMovePreviewShape[] : []
      }
    }

    const selectionMoveDrag = runtime.interaction.selectionMoveDrag

    if (
      !runtime.isMovingSelection.value ||
      selectionMoveDrag?.mode !== 'bundle' ||
      selectionMoveDrag.movingIndexes.length === 0
    ) {
      return {
        active: false,
        coverContents: false,
        showSummary: false,
        itemCount: 0,
        sectionCount: 0,
        containedCount: 0,
        containedSectionCount: 0,
        shapes: [] as SelectionMovePreviewShape[]
      }
    }

    const shapes = selectionMoveDrag.previewShapeKinds
      .slice(0, Math.min(selectionMoveDrag.previewShapeKinds.length, maxSelectionMovePreviewShapes))
      .map((kind, index) => ({ id: index, kind }))
    const isSingleSectionBundle =
      selectionMoveDrag.movingIds.size === 1 &&
      selectionMoveDrag.previewCounts.sectionCount === 1

    return {
      active: true,
      coverContents: isSingleSectionBundle,
      showSummary: true,
      ...selectionMoveDrag.previewCounts,
      shapes
    }
  })

  const hasSelectedAncestor = (node: SyncNode, selectedIds: Set<string>, allNodes: SyncNode[]) => {
    let parentId = node.parentNode

    while (parentId) {
      if (selectedIds.has(parentId)) {
        return true
      }

      parentId = allNodes.find((candidate) => candidate.id === parentId)?.parentNode
    }

    return false
  }

  const getMovableSelectedIds = (allNodes: SyncNode[]) => {
    const selectedIds = new Set(options.getSelectedNodeIds())

    return new Set(
      allNodes
        .filter((node) => selectedIds.has(node.id) && !hasSelectedAncestor(node, selectedIds, allNodes))
        .map((node) => node.id)
    )
  }

  const getSingleSelectedTopLevelSectionNode = (selectedIds: string[]) => {
    const selectedIdSet = new Set(selectedIds)
    const runtimeNodes = runtime.nodes.value as RuntimePositionedFlowNode[]
    const nodeById = new Map(runtimeNodes.map((node) => [node.id, node]))
    const topLevelSelectedIds: string[] = []

    selectedIds.forEach((nodeId) => {
      const node = nodeById.get(nodeId)
      let parentId = node?.parentNode
      let hasSelectedAncestor = false

      while (parentId) {
        if (selectedIdSet.has(parentId)) {
          hasSelectedAncestor = true
          break
        }

        parentId = nodeById.get(parentId)?.parentNode
      }

      if (!hasSelectedAncestor) {
        topLevelSelectedIds.push(nodeId)
      }
    })

    if (topLevelSelectedIds.length !== 1) {
      return null
    }

    const sectionNode = nodeById.get(topLevelSelectedIds[0])

    return sectionNode && isSectionFlowNode(sectionNode) ? sectionNode : null
  }

  const addDescendantIds = (nodeId: string, graph: ReturnType<typeof createGraphCache>, ids: Set<string>) => {
    const children = graph.childrenByParentId.get(nodeId) ?? []

    children.forEach((child) => {
      if (ids.has(child.id)) {
        return
      }

      ids.add(child.id)
      addDescendantIds(child.id, graph, ids)
    })
  }

  const countSectionIds = (ids: Set<string>, graph: ReturnType<typeof createGraphCache>) => {
    let count = 0

    ids.forEach((nodeId) => {
      if (graph.nodeById.get(nodeId)?.type === 'section') {
        count += 1
      }
    })

    return count
  }

  const isSectionFlowNode = (node: FlowNode) => node.type === 'section' || node.data?.nodeType === 'section'

  const buildRuntimeChildrenByParentId = () => {
    const childrenByParentId = new Map<string, FlowNode[]>()

    for (const node of runtime.nodes.value as FlowNode[]) {
      if (!node.parentNode) {
        continue
      }

      const children = childrenByParentId.get(node.parentNode) ?? []
      children.push(node)
      childrenByParentId.set(node.parentNode, children)
    }

    return childrenByParentId
  }

  const buildRuntimeSectionHiddenIds = (sectionId: string) => {
    const childrenByParentId = buildRuntimeChildrenByParentId()
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

  const buildSelectionMoveHiddenIds = (allNodes: SyncNode[], movingIds: Set<string>) => {
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

  const buildSelectionMovePreviewMetadata = (
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

  const getSelectionFlowBoundsSnapshot = (nodeIds: Iterable<string>, allNodes: SyncNode[]) => {
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

  const getSelectionOutlineElement = (event: PointerEvent, target: HTMLElement | null) => {
    return (
      (event.target instanceof Element
        ? event.target.closest<HTMLElement>('.selected-nodes-outline')
        : null) ??
      target?.closest<HTMLElement>('.selected-nodes-outline') ??
      runtime.canvasPanel.value?.querySelector<HTMLElement>('.selected-nodes-outline') ??
      null
    )
  }

  const getNodeElementById = (nodeId: string) => {
    const selector = `.vue-flow__node[data-id="${escapeCssAttributeValue(nodeId)}"]`

    return runtime.canvasPanel.value?.querySelector<HTMLElement>(selector) ?? null
  }

  const getClientPointInFlow = (
    clientX: number,
    clientY: number,
    viewport: FlowViewport = runtime.currentViewport.value
  ) => {
    const bounds = runtime.canvasClientBounds.value

    if (!bounds || bounds.width <= 0 || bounds.height <= 0 || viewport.zoom <= 0) {
      return runtime.screenToFlowCoordinate({ x: clientX, y: clientY })
    }

    return {
      x: (clientX - bounds.left - viewport.x) / viewport.zoom,
      y: (clientY - bounds.top - viewport.y) / viewport.zoom
    }
  }

  const getInitialSelectionMoveGraphState = (
    startClientX: number,
    startClientY: number,
    currentClientX: number,
    currentClientY: number
  ) => {
    const startViewport = { ...runtime.currentViewport.value }
    const startPointerGraph = getClientPointInFlow(startClientX, startClientY, startViewport)
    const currentPointerGraph = getClientPointInFlow(currentClientX, currentClientY)
    const currentGraphDelta = {
      x: currentPointerGraph.x - startPointerGraph.x,
      y: currentPointerGraph.y - startPointerGraph.y
    }

    return {
      startViewport,
      startPointerGraph,
      currentPointerGraph,
      currentGraphDelta
    }
  }

  const syncSelectionMoveGraphDelta = (
    selectionMoveDrag: SelectionMoveDrag,
    clientX = selectionMoveDrag.currentClientX,
    clientY = selectionMoveDrag.currentClientY
  ) => {
    const currentPointerGraph = getClientPointInFlow(clientX, clientY)

    selectionMoveDrag.currentClientX = clientX
    selectionMoveDrag.currentClientY = clientY
    selectionMoveDrag.currentPointerGraph = currentPointerGraph
    selectionMoveDrag.currentGraphDelta = {
      x: currentPointerGraph.x - selectionMoveDrag.startPointerGraph.x,
      y: currentPointerGraph.y - selectionMoveDrag.startPointerGraph.y
    }
  }

  const getSelectionMoveDelta = (selectionMoveDrag: SelectionMoveDrag) => {
    return selectionMoveDrag.currentGraphDelta
  }

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
    const measured = node as RuntimePositionedFlowNode & {
      dimensions?: { width?: number, height?: number }
    }
    const width = measured.dimensions?.width
    const height = measured.dimensions?.height

    if (
      typeof width === 'number' &&
      Number.isFinite(width) &&
      typeof height === 'number' &&
      Number.isFinite(height)
    ) {
      return { width, height }
    }

    return getNodeSize(syncNode, syncNode.type === 'section' ? 720 : 240, syncNode.type === 'section' ? 620 : 190)
  }

  const hasTransformOnlyVisiblePreview = (selectionMoveDrag: SelectionMoveDrag) => {
    return selectionMoveDrag.mode === 'visible' && visibleDragElementSnapshots.size > 0
  }

  const markSelectionMovePreviewPainted = (selectionMoveDrag: SelectionMoveDrag) => {
    selectionMoveDrag.lastPaintedClientX = selectionMoveDrag.currentClientX
    selectionMoveDrag.lastPaintedClientY = selectionMoveDrag.currentClientY
    selectionMoveDrag.lastPaintedGraphDelta = { ...selectionMoveDrag.currentGraphDelta }
    selectionMoveDrag.hasPaintedPreview = true
  }

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

  const withClassName = <T extends FlowNode['class'] | FlowEdge['class']>(className: T, name: string) : T => {
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

  const escapeCssAttributeValue = (value: string) => value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\a ')
    .replace(/\r/g, '\\d ')

  const getSelectionMoveHiddenStyleElement = () => {
    if (typeof document === 'undefined') {
      return null
    }

    let element = document.getElementById(selectionMoveHiddenStyleId) as HTMLStyleElement | null

    if (!element) {
      element = document.createElement('style')
      element.id = selectionMoveHiddenStyleId
      document.head.append(element)
    }

    return element
  }

  const buildHiddenSelector = (className: string, ids: Set<string>) => {
    return Array.from(ids, (id) =>
      `.flow-canvas ${className}[data-id="${escapeCssAttributeValue(id)}"]`
    ).join(',\n')
  }

  const syncSelectionMoveHiddenStyle = () => {
    const rules: string[] = []
    const nodeSelector = buildHiddenSelector('.vue-flow__node', selectionMoveHiddenNodeIds)
    const edgeSelector = buildHiddenSelector('.vue-flow__edge', selectionMoveHiddenEdgeIds)

    if (nodeSelector) {
      rules.push(`${nodeSelector} { visibility: hidden !important; pointer-events: none !important; }`)
    }

    if (edgeSelector) {
      rules.push(`${edgeSelector} { visibility: hidden !important; pointer-events: none !important; }`)
    }

    const styleElement = getSelectionMoveHiddenStyleElement()

    if (styleElement) {
      styleElement.textContent = rules.join('\n')
    }

    runtime.selectionMoveHiddenNodeIds.value = new Set(selectionMoveHiddenNodeIds)
    runtime.selectionMoveHiddenEdgeIds.value = new Set(selectionMoveHiddenEdgeIds)
  }

  const clearSelectionMoveHiddenIds = () => {
    if (selectionMoveHiddenNodeIds.size === 0 && selectionMoveHiddenEdgeIds.size === 0) {
      return
    }

    selectionMoveHiddenNodeIds = new Set()
    selectionMoveHiddenEdgeIds = new Set()
    syncSelectionMoveHiddenStyle()
  }

  const getSelectionMoveInternalEdgeIds = (hiddenIds: Set<string>) => {
    const nextHiddenEdgeIds = new Set<string>()

    if (hiddenIds.size >= 2) {
      for (const edge of runtime.edges.value as FlowEdge[]) {
        if (hiddenIds.has(edge.source) && hiddenIds.has(edge.target)) {
          nextHiddenEdgeIds.add(edge.id)
        }
      }
    }

    return nextHiddenEdgeIds
  }

  const hideSelectionMoveIds = (hiddenIds: Set<string>) => {
    selectionMoveHiddenNodeIds = new Set(hiddenIds)
    selectionMoveHiddenEdgeIds = getSelectionMoveInternalEdgeIds(hiddenIds)
    syncSelectionMoveHiddenStyle()
  }

  const hideBundleSelectionNodes = (selectionMoveDrag: SelectionMoveDrag) => {
    if (!hideSelectedNodesDuringBundleMove || selectionMoveDrag.mode !== 'bundle') {
      clearSelectionMoveHiddenIds()
      return
    }

    hideSelectionMoveIds(selectionMoveDrag.hiddenIds)
  }

  const clearVisibleDragElementSnapshots = (restoreTransforms = true) => {
    if (visibleDragElementSnapshots.size === 0) {
      return
    }

    visibleDragElementSnapshots.forEach((snapshot) => {
      if (!snapshot.element.isConnected) {
        return
      }

      if (restoreTransforms) {
        snapshot.element.style.transform = snapshot.transform
      }

      snapshot.element.style.willChange = snapshot.willChange
      snapshot.element.style.zIndex = snapshot.zIndex
      snapshot.element.style.pointerEvents = snapshot.pointerEvents
    })

    visibleDragElementSnapshots = new Map()
  }

  const beginVisibleDragPreview = (selectionMoveDrag: SelectionMoveDrag) => {
    clearVisibleDragElementSnapshots()

    if (selectionMoveDrag.mode !== 'visible') {
      return
    }

    const nextSnapshots = new Map<string, VisibleDragElementSnapshot>()

    selectionMoveDrag.hiddenIds.forEach((nodeId) => {
      const element = getNodeElementById(nodeId)

      if (!element) {
        return
      }

      nextSnapshots.set(nodeId, {
        id: nodeId,
        element,
        transform: element.style.transform,
        willChange: element.style.willChange,
        zIndex: element.style.zIndex,
        pointerEvents: element.style.pointerEvents
      })

      element.style.willChange = 'transform'
      element.style.pointerEvents = 'none'

      const node = runtime.findNode(nodeId) as RuntimePositionedFlowNode | undefined
      if (node?.type !== 'section') {
        element.style.zIndex = '20'
      }
    })

    visibleDragElementSnapshots = nextSnapshots

    if (visibleDragElementSnapshots.size !== selectionMoveDrag.hiddenIds.size) {
      clearVisibleDragElementSnapshots()
    }
  }

  const paintVisibleDragPreview = (selectionMoveDrag: SelectionMoveDrag) => {
    if (selectionMoveDrag.mode !== 'visible' || visibleDragElementSnapshots.size === 0) {
      return
    }

    const delta = getSelectionMoveDelta(selectionMoveDrag)
    const previewTransform = `translate3d(${delta.x}px, ${delta.y}px, 0)`

    visibleDragElementSnapshots.forEach((snapshot) => {
      if (!snapshot.element.isConnected) {
        return
      }

      snapshot.element.style.transform = snapshot.transform
        ? `${snapshot.transform} ${previewTransform}`
        : previewTransform
    })
    markSelectionMovePreviewPainted(selectionMoveDrag)
  }

  const handleSectionNodeDragStart = (sectionId: string) => {
    if (runtime.interaction.selectionMoveDrag) {
      return
    }

    const allNodes = (runtime.nodes.value as FlowNode[]).map(normalizeNode)
    const graph = createGraphCache(allNodes)
    const section = graph.nodeById.get(sectionId)

    if (section?.type !== 'section') {
      return
    }

    const descendantIds = new Set<string>()
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

    const useLargeSectionPreview = descendantIds.size + 1 > largeSelectionMovePreviewThreshold

    if (!useLargeSectionPreview) {
      runtime.sectionNodeDragPreview.value = null
      clearSelectionMoveHiddenIds()
      return
    }

    runtime.sectionNodeDragPreview.value = {
      sectionId,
      previewCounts: {
        itemCount: 0,
        sectionCount: 1,
        containedCount: descendantIds.size,
        containedSectionCount: countSectionIds(descendantIds, graph)
      },
      hiddenIds: descendantIds,
      hideStrategy: 'cover',
      showSummary: true
    }

    hideSelectionMoveIds(descendantIds)
  }

  const clearSectionNodeDragPreview = () => {
    const preview = runtime.sectionNodeDragPreview.value

    if (!preview) {
      return
    }

    runtime.sectionNodeDragPreview.value = null
    clearSelectionMoveHiddenIds()
  }

  const buildSectionDragCandidatesById = (
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

  const buildSelectionMoveDragMetadata = (originalSyncNodes: SyncNode[], movingIds: Set<string>) => {
    const graph = createGraphCache(originalSyncNodes)
    const dragItems: NodeDragItem[] = []
    const originalPositionsById = new Map<string, { x: number, y: number }>()

    movingIds.forEach((nodeId) => {
      const syncNode = graph.nodeById.get(nodeId)

      if (!syncNode) {
        return
      }

      const flowNode = runtime.findNode(nodeId) as
        | (FlowNode & {
          computedPosition?: { x: number, y: number }
          dimensions?: { width?: number, height?: number }
          extent?: NodeDragItem['extent']
          expandParent?: boolean
        })
        | undefined
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

  const getDragItemComputedPosition = (dragItem: NodeDragItem, node: RuntimePositionedFlowNode) => {
    return {
      ...(node.computedPosition ?? { z: 0 }),
      x: dragItem.position.x,
      y: dragItem.position.y
    }
  }

  const isDragItemOverLargerSection = (dragItem: NodeDragItem, selectionMoveDrag: SelectionMoveDrag) => {
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

  const applyRuntimeDragItemPositions = (selectionMoveDrag: SelectionMoveDrag, dragging: boolean) => {
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

  const applyVisibleSelectionMove = (selectionMoveDrag: SelectionMoveDrag, dragging: boolean) => {
    const changed = updateSelectionDragItemPositions(selectionMoveDrag)

    if (changed || !dragging) {
      applyRuntimeDragItemPositions(selectionMoveDrag, dragging)
    }
  }

  const applySelectionMoveFrame = () => {
    const selectionMoveDrag = runtime.interaction.selectionMoveDrag

    if (!selectionMoveDrag) {
      return
    }

    selectionMoveDrag.frame = undefined
    paintSelectionMovePreview(selectionMoveDrag)
    paintVisibleDragPreview(selectionMoveDrag)
    bumpSelectionMovePreviewVersion()

    if (selectionMoveDrag.mode === 'bundle') {
      return
    }

    if (visibleDragElementSnapshots.size > 0) {
      return
    }

    applyVisibleSelectionMove(selectionMoveDrag, true)
  }

  const paintSelectionMovePreview = (selectionMoveDrag: SelectionMoveDrag) => {
    const element = selectionMovePreviewElement
    const viewport = runtime.currentViewport.value
    const delta = getSelectionMoveDelta(selectionMoveDrag)
    const deltaX = delta.x * viewport.zoom
    const deltaY = delta.y * viewport.zoom

    if (element) {
      element.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`
    }
  }

  const clearSelectionMovePreview = (restoreVisibleDragTransforms = true) => {
    if (selectionMovePreviewElement) {
      selectionMovePreviewElement.style.transform = ''
      selectionMovePreviewElement.style.willChange = ''
    }

    selectionMovePreviewElement = null
    clearVisibleDragElementSnapshots(restoreVisibleDragTransforms)
    clearSelectionMoveHiddenIds()
  }

  const buildCommittedSelectionMoveNodes = (
    selectionMoveDrag: SelectionMoveDrag,
    baseNodes = selectionMoveDrag.originalSyncNodes
  ) => {
    const delta = getSelectionMoveDelta(selectionMoveDrag)

    return baseNodes.map((node) => {
      const nextNode = {
        ...node,
        position: { ...node.position }
      }

      if (!selectionMoveDrag.movingIds.has(node.id)) {
        return nextNode
      }

      const originalNode = selectionMoveDrag.originalSyncNodesById.get(node.id)

      if (!originalNode) {
        return nextNode
      }

      return {
        ...nextNode,
        position: {
          x: Math.round(originalNode.position.x + delta.x),
          y: Math.round(originalNode.position.y + delta.y)
        }
      }
    })
  }

  const hasCommittedSelectionMovePositionChange = (selectionMoveDrag: SelectionMoveDrag) => {
    const delta = getSelectionMoveDelta(selectionMoveDrag)

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

    const changes: Array<{ index: number, oldNode: SyncNode, nextNode: SyncNode }> = []

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
    changes: Array<{ index: number, oldNode: SyncNode, nextNode: SyncNode }>
  ) => {
    applyVisibleSelectionMove(drag, false)

    services.submitOperation(
      changes.map(({ index, oldNode, nextNode }) => ({
        p: ['nodes', index],
        ld: oldNode,
        li: nextNode
      }) as JsonOp)
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

  const refreshMovedSectionInternals = (results: ReturnType<typeof getMovedSectionMembershipResults>) => {
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

  const scheduleSelectionMoveFrame = () => {
    const selectionMoveDrag = runtime.interaction.selectionMoveDrag

    if (!selectionMoveDrag) {
      return
    }

    syncSelectionMoveGraphDelta(selectionMoveDrag)

    if (selectionMoveDrag.frame) {
      return
    }

    selectionMoveDrag.frame = window.requestAnimationFrame(applySelectionMoveFrame)
  }

  const flushSelectionMoveFrame = () => {
    const selectionMoveDrag = runtime.interaction.selectionMoveDrag

    if (!selectionMoveDrag) {
      return
    }

    if (selectionMoveDrag.frame) {
      window.cancelAnimationFrame(selectionMoveDrag.frame)
      selectionMoveDrag.frame = undefined
    }

    applySelectionMoveFrame()
  }

  const cancelSelectionMoveFrame = (selectionMoveDrag: SelectionMoveDrag) => {
    if (!selectionMoveDrag.frame) {
      return
    }

    window.cancelAnimationFrame(selectionMoveDrag.frame)
    selectionMoveDrag.frame = undefined
  }

  const clampSelectionMoveZoom = (zoom: number) => {
    return Math.min(selectionMoveMaxZoom, Math.max(selectionMoveMinZoom, zoom))
  }

  const getNormalizedWheelDeltaY = (event: WheelEvent) => {
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      return event.deltaY * 16
    }

    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      return event.deltaY * 800
    }

    return event.deltaY
  }

  const handleSelectionMoveWheel = (event: WheelEvent) => {
    const drag = runtime.interaction.selectionMoveDrag
    const panelBounds = runtime.canvasPanel.value?.getBoundingClientRect()

    if (!drag || !panelBounds || !runtime.isLoggedIn.value) {
      return false
    }

    const pointerInsidePanel =
      event.clientX >= panelBounds.left &&
      event.clientX <= panelBounds.right &&
      event.clientY >= panelBounds.top &&
      event.clientY <= panelBounds.bottom

    if (!pointerInsidePanel) {
      return false
    }

    event.preventDefault()
    event.stopImmediatePropagation()

    const currentViewport = runtime.currentViewport.value
    const currentZoom = Math.max(0.001, currentViewport.zoom)
    const wheelDeltaY = getNormalizedWheelDeltaY(event)
    const nextZoom = clampSelectionMoveZoom(
      currentZoom * 2 ** (-wheelDeltaY * selectionMoveWheelZoomStep)
    )

    if (Math.abs(nextZoom - currentZoom) < 0.0001) {
      return true
    }

    const anchorClientX = drag.currentClientX
    const anchorClientY = drag.currentClientY
    const anchorGraphPoint = getClientPointInFlow(anchorClientX, anchorClientY, currentViewport)
    const localAnchorX = anchorClientX - panelBounds.left
    const localAnchorY = anchorClientY - panelBounds.top
    const nextViewport = {
      x: localAnchorX - anchorGraphPoint.x * nextZoom,
      y: localAnchorY - anchorGraphPoint.y * nextZoom,
      zoom: nextZoom
    }

    runtime.currentViewport.value = nextViewport
    void runtime.setViewport(nextViewport)
    syncSelectionMoveGraphDelta(drag)
    scheduleSelectionMoveFrame()
    services.scheduleSelectionBoundsRefresh()

    return true
  }

  const handleActiveSelectionMoveWheel = (event: WheelEvent) => {
    handleSelectionMoveWheel(event)
  }

  const settleVisibleDragAtLastPaintedPosition = (selectionMoveDrag: SelectionMoveDrag) => {
    if (!hasTransformOnlyVisiblePreview(selectionMoveDrag) || !selectionMoveDrag.hasPaintedPreview) {
      return false
    }

    cancelSelectionMoveFrame(selectionMoveDrag)
    selectionMoveDrag.currentClientX = selectionMoveDrag.lastPaintedClientX
    selectionMoveDrag.currentClientY = selectionMoveDrag.lastPaintedClientY
    selectionMoveDrag.currentGraphDelta = { ...selectionMoveDrag.lastPaintedGraphDelta }
    selectionMoveDrag.currentPointerGraph = {
      x: selectionMoveDrag.startPointerGraph.x + selectionMoveDrag.currentGraphDelta.x,
      y: selectionMoveDrag.startPointerGraph.y + selectionMoveDrag.currentGraphDelta.y
    }
    bumpSelectionMovePreviewVersion()

    return true
  }

  const beginSelectionMove = (options: SelectionMoveStartOptions) => {
    const normalizedOriginalNodes =
      options.normalizedOriginalNodes ?? (runtime.nodes.value as FlowNode[]).map(normalizeNode)
    const movingIds = options.movingIds

    if (movingIds.size === 0) {
      return false
    }

    const hiddenIds = options.hiddenIds ?? buildSelectionMoveHiddenIds(normalizedOriginalNodes, movingIds)
    const previewMetadata = options.previewCounts && options.previewShapeKinds
      ? {
        counts: options.previewCounts,
        shapeKinds: options.previewShapeKinds
      }
      : buildSelectionMovePreviewMetadata(normalizedOriginalNodes, movingIds, hiddenIds)
    const movingIndexes = options.movingIndexes ?? normalizedOriginalNodes
      .map((node, index) => (movingIds.has(node.id) ? index : -1))
      .filter((index) => index >= 0)
    const mode = options.mode ?? (
      !options.forceVisible &&
      largeSelectionMovePreviewMode === 'bundle' &&
      hiddenIds.size > largeSelectionMovePreviewThreshold
        ? 'bundle'
        : 'visible'
    )
    const originalSyncNodesById = new Map(normalizedOriginalNodes.map((node) => [node.id, node]))
    const dragMetadata = options.dragMetadata ?? buildSelectionMoveDragMetadata(normalizedOriginalNodes, movingIds)
    const {
      dragItems,
      originalPositionsById,
      runtimeSnapshotsById,
      sectionDragCandidatesById
    } = dragMetadata
    const graphState = getInitialSelectionMoveGraphState(
      options.startClientX,
      options.startClientY,
      options.currentClientX,
      options.currentClientY
    )

    if (dragItems.length === 0 || movingIndexes.length === 0) {
      return false
    }

    selectionMovePointerCaptureTarget = options.target
    selectionMovePointerId = options.pointerId
    clearSelectionMovePreview()
    selectionMovePreviewElement = options.previewElement
    if (selectionMovePreviewElement) {
      selectionMovePreviewElement.style.willChange = 'transform'
    }
    if (options.target && typeof options.target.setPointerCapture === 'function') {
      try {
        options.target.setPointerCapture(options.pointerId)
      } catch {
        selectionMovePointerCaptureTarget = null
      }
    }
    window.addEventListener('wheel', handleActiveSelectionMoveWheel, { capture: true, passive: false })

    runtime.interaction.selectionMoveDrag = {
      mode,
      startViewport: graphState.startViewport,
      startClientX: options.startClientX,
      startClientY: options.startClientY,
      currentClientX: options.currentClientX,
      currentClientY: options.currentClientY,
      lastPaintedClientX: options.currentClientX,
      lastPaintedClientY: options.currentClientY,
      startPointerGraph: graphState.startPointerGraph,
      currentPointerGraph: graphState.currentPointerGraph,
      currentGraphDelta: graphState.currentGraphDelta,
      lastPaintedGraphDelta: { ...graphState.currentGraphDelta },
      hasPaintedPreview: false,
      originalSyncNodes: normalizedOriginalNodes,
      originalSyncNodesById,
      originalPositionsById,
      runtimeSnapshotsById,
      sectionDragCandidatesById,
      dragItems,
      movingIds,
      movingIndexes,
      hiddenIds,
      previewCounts: previewMetadata.counts,
      previewShapeKinds: previewMetadata.shapeKinds,
      selectedFlowBounds: options.selectedFlowBounds
    }
    hideBundleSelectionNodes(runtime.interaction.selectionMoveDrag)
    beginVisibleDragPreview(runtime.interaction.selectionMoveDrag)
    runtime.isMovingSelection.value = true
    bumpSelectionMovePreviewVersion()

    return true
  }

  const handleSelectedBoundsPointerDown = (event: PointerEvent) => {
    if (!runtime.isLoggedIn.value || event.button !== 0) {
      return
    }

    const selectedIds = options.getSelectedNodeIds()

    if (selectedIds.length === 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    services.closeContextMenu()

    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
    const topLevelSectionNode = getSingleSelectedTopLevelSectionNode(selectedIds)
    const sectionMetadata = topLevelSectionNode
      ? buildSingleSectionMoveStartMetadata(topLevelSectionNode)
      : null

    if (sectionMetadata) {
      const started = beginSelectionMove({
        startClientX: event.clientX,
        startClientY: event.clientY,
        currentClientX: event.clientX,
        currentClientY: event.clientY,
        pointerId: event.pointerId,
        target,
        previewElement: getSelectionOutlineElement(event, target),
        movingIds: sectionMetadata.movingIds,
        selectedFlowBounds: sectionMetadata.selectedFlowBounds,
        normalizedOriginalNodes: [sectionMetadata.syncSection],
        hiddenIds: sectionMetadata.hiddenIds,
        previewCounts: sectionMetadata.previewCounts,
        previewShapeKinds: sectionMetadata.previewShapeKinds,
        movingIndexes: sectionMetadata.movingIndexes,
        mode: sectionMetadata.mode,
        dragMetadata: sectionMetadata.dragMetadata
      })

      if (!started) {
        return
      }

      window.addEventListener('pointermove', handleSelectedBoundsPointerMove, { capture: true })
      window.addEventListener('pointerup', handleSelectedBoundsPointerUp, { capture: true, once: true })
      return
    }

    const normalizedOriginalNodes = (runtime.nodes.value as FlowNode[]).map(normalizeNode)
    const movingIds = getMovableSelectedIds(normalizedOriginalNodes)

    const started = beginSelectionMove({
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      pointerId: event.pointerId,
      target,
      previewElement: getSelectionOutlineElement(event, target),
      movingIds,
      selectedFlowBounds: getSelectionFlowBoundsSnapshot(selectedIds, normalizedOriginalNodes),
      normalizedOriginalNodes
    })

    if (!started) {
      return
    }

    window.addEventListener('pointermove', handleSelectedBoundsPointerMove, { capture: true })
    window.addEventListener('pointerup', handleSelectedBoundsPointerUp, { capture: true, once: true })
  }

  const handleSelectedBoundsPointerMove = (event: PointerEvent) => {
    if (selectionMovePointerId !== null && event.pointerId !== selectionMovePointerId) {
      return
    }

    const selectionMoveDrag = runtime.interaction.selectionMoveDrag

    if (!selectionMoveDrag) {
      return
    }

    event.preventDefault()
    event.stopImmediatePropagation()
    syncSelectionMoveGraphDelta(selectionMoveDrag, event.clientX, event.clientY)
    scheduleSelectionMoveFrame()
  }

  const clearSelectionMovePresentation = (restoreVisibleDragTransforms = true) => {
    clearSelectionMovePreview(restoreVisibleDragTransforms)
    clearSectionNodeDragPreview()
  }

  const removeSelectionMoveWheelListener = () => {
    window.removeEventListener('wheel', handleActiveSelectionMoveWheel, true)
  }

  const finishSelectionMovePointerUp = (event: PointerEvent) => {
    if (selectionMovePointerId !== null && event.pointerId !== selectionMovePointerId) {
      return
    }

    const drag = runtime.interaction.selectionMoveDrag
    if (drag) {
      syncSelectionMoveGraphDelta(drag, event.clientX, event.clientY)
    }
    if (!drag || !settleVisibleDragAtLastPaintedPosition(drag)) {
      flushSelectionMoveFrame()
    }
    if (selectionMovePointerCaptureTarget?.hasPointerCapture(event.pointerId)) {
      selectionMovePointerCaptureTarget.releasePointerCapture(event.pointerId)
    }
    selectionMovePointerCaptureTarget = null
    selectionMovePointerId = null
    removeSelectionMoveWheelListener()

    if (!drag) {
      runtime.interaction.selectionMoveDrag = null
      runtime.isMovingSelection.value = false
      services.scheduleSelectionBoundsRefresh()
      clearSelectionMovePresentation()
      return
    }

    event.preventDefault()
    event.stopImmediatePropagation()
    runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350
    const committed = commitMovedSelectedNodes(drag)
    const pendingSelectionNodeId = activePendingSelectionNodeId
    activePendingSelectionNodeId = null
    runtime.interaction.selectionMoveDrag = null
    runtime.isMovingSelection.value = false
    bumpSelectionMovePreviewVersion()
    services.scheduleSelectionBoundsRefresh()
    if (committed) {
      nextTick(() => clearSelectionMovePresentation(false))
      if (pendingSelectionNodeId) {
        options.commitPendingNodeSelection?.(pendingSelectionNodeId, 'drop')
      }
    } else {
      clearSelectionMovePresentation()
      if (pendingSelectionNodeId) {
        options.cancelPendingNodeSelection?.(pendingSelectionNodeId)
      }
    }
  }

  const handleSelectedBoundsPointerUp = (event: PointerEvent) => {
    if (selectionMovePointerId !== null && event.pointerId !== selectionMovePointerId) {
      return
    }

    window.removeEventListener('pointermove', handleSelectedBoundsPointerMove, true)
    runtime.isResizingNode.value = false
    finishSelectionMovePointerUp(event)
  }

  const attachSelectionMovePreviewElementOnNextTick = () => {
    nextTick(() => {
      const drag = runtime.interaction.selectionMoveDrag

      if (!drag || selectionMovePreviewElement) {
        return
      }

      const element = runtime.canvasPanel.value?.querySelector<HTMLElement>('.selected-nodes-outline') ?? null

      if (!element) {
        return
      }

      selectionMovePreviewElement = element
      selectionMovePreviewElement.style.willChange = 'transform'
      paintSelectionMovePreview(drag)
    })
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

  const buildSingleSectionMoveStartMetadata = (
    sectionNode: RuntimePositionedFlowNode
  ) : SingleSectionMoveStartMetadata | null => {
    const syncSection = normalizeNode(sectionNode)

    if (syncSection.type !== 'section') {
      return null
    }

    const movingIds = new Set([syncSection.id])
    const { hiddenIds, containedSectionCount } = buildRuntimeSectionHiddenIds(syncSection.id)
    const dragMetadata = buildSingleSectionDragMetadata(sectionNode, syncSection, movingIds)
    const sectionPosition = dragMetadata.originalPositionsById.get(syncSection.id) ?? {
      x: Math.round(syncSection.position.x),
      y: Math.round(syncSection.position.y)
    }
    const sectionDimensions = dragMetadata.dragItems[0]?.dimensions ?? getRuntimeNodeDimensions(sectionNode, syncSection)
    const previewCounts: SelectionMovePreviewCounts = {
      itemCount: 0,
      sectionCount: 1,
      containedCount: Math.max(0, hiddenIds.size - movingIds.size),
      containedSectionCount
    }
    const mode: SelectionMoveDrag['mode'] =
      largeSelectionMovePreviewMode === 'bundle' &&
      hiddenIds.size > largeSelectionMovePreviewThreshold
        ? 'bundle'
        : 'visible'

    return {
      syncSection,
      movingIds,
      hiddenIds,
      previewCounts,
      previewShapeKinds: ['section'],
      movingIndexes: [0],
      mode,
      selectedFlowBounds: {
        ...sectionPosition,
        ...sectionDimensions,
        padding: selectionBoundsPadding
      },
      dragMetadata
    }
  }

  const beginSingleSectionMove = (
    event: PointerEvent,
    pending: PendingNodePointerMove,
    sectionNode: RuntimePositionedFlowNode
  ) => {
    const metadata = pending.singleSectionMove ?? buildSingleSectionMoveStartMetadata(sectionNode)

    if (!metadata) {
      return false
    }

    return beginSelectionMove({
      startClientX: pending.startClientX,
      startClientY: pending.startClientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      pointerId: pending.pointerId,
      target: pending.target,
      previewElement: null,
      movingIds: metadata.movingIds,
      selectedFlowBounds: metadata.selectedFlowBounds,
      normalizedOriginalNodes: [metadata.syncSection],
      hiddenIds: metadata.hiddenIds,
      previewCounts: metadata.previewCounts,
      previewShapeKinds: metadata.previewShapeKinds,
      movingIndexes: metadata.movingIndexes,
      mode: metadata.mode,
      dragMetadata: metadata.dragMetadata
    })
  }

  const startPendingNodePointerMove = (event: PointerEvent, pending: PendingNodePointerMove) => {
    const selectedIds = options.getSelectedNodeIds()
    const selectedIdSet = new Set(selectedIds)
    const moveSelection = selectedIds.length > 1 && selectedIdSet.has(pending.nodeId)
    const runtimeNode = runtime.findNode(pending.nodeId) as FlowNode | undefined

    if (!runtimeNode) {
      return false
    }

    if (!moveSelection && isSectionFlowNode(runtimeNode)) {
      const started = beginSingleSectionMove(event, pending, runtimeNode as RuntimePositionedFlowNode)

      if (!started) {
        return false
      }

      activePendingSelectionNodeId = pending.pendingSelectionNodeId ?? null
      attachSelectionMovePreviewElementOnNextTick()
      runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350

      return true
    }

    const pendingNode = normalizeNode(runtimeNode)
    const useSingleItemFastPath = !moveSelection && pendingNode.type !== 'section'
    const normalizedOriginalNodes = useSingleItemFastPath
      ? [pendingNode]
      : (runtime.nodes.value as FlowNode[]).map(normalizeNode)
    const node = useSingleItemFastPath
      ? pendingNode
      : normalizedOriginalNodes.find((candidate) => candidate.id === pending.nodeId)

    if (!node) {
      return false
    }

    const movingIds = moveSelection
      ? getMovableSelectedIds(normalizedOriginalNodes)
      : new Set([pending.nodeId])
    const useSingleSectionPreview = !moveSelection && node.type === 'section'
    const selectedFlowBounds = moveSelection
      ? getSelectionFlowBoundsSnapshot(selectedIds, normalizedOriginalNodes)
      : useSingleSectionPreview
        ? getSelectionFlowBoundsSnapshot([pending.nodeId], normalizedOriginalNodes)
        : null
    const started = beginSelectionMove({
      startClientX: pending.startClientX,
      startClientY: pending.startClientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      pointerId: pending.pointerId,
      target: pending.target,
      previewElement: moveSelection
        ? getSelectionOutlineElement(event, pending.target)
        : null,
      movingIds,
      selectedFlowBounds,
      normalizedOriginalNodes
    })

    if (!started) {
      return false
    }

    activePendingSelectionNodeId = pending.pendingSelectionNodeId ?? null

    if (useSingleSectionPreview) {
      attachSelectionMovePreviewElementOnNextTick()
    }

    runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350
    return true
  }

  const clearPendingNodePointerMove = (event?: PointerEvent) => {
    if (
      event &&
      selectionMovePointerCaptureTarget?.hasPointerCapture(event.pointerId)
    ) {
      selectionMovePointerCaptureTarget.releasePointerCapture(event.pointerId)
    }

    pendingNodePointerMove = null
    selectionMovePointerCaptureTarget = null
    selectionMovePointerId = null
    window.removeEventListener('pointermove', handleNodePointerMove, true)
    window.removeEventListener('pointerup', handleNodePointerUp, true)
    window.removeEventListener('pointercancel', handleNodePointerCancel, true)
  }

  const handleNodePointerMove = (event: PointerEvent) => {
    if (runtime.interaction.selectionMoveDrag) {
      handleSelectedBoundsPointerMove(event)
      return
    }

    const pending = pendingNodePointerMove

    if (!pending || event.pointerId !== pending.pointerId) {
      return
    }

    if (!runtime.interaction.selectionMoveDrag) {
      const movedPastThreshold =
        Math.abs(event.clientX - pending.startClientX) > nodePointerMoveThreshold ||
        Math.abs(event.clientY - pending.startClientY) > nodePointerMoveThreshold

      if (!movedPastThreshold) {
        return
      }

      if (!startPendingNodePointerMove(event, pending)) {
        if (pending.pendingSelectionNodeId) {
          options.cancelPendingNodeSelection?.(pending.pendingSelectionNodeId)
        }
        clearPendingNodePointerMove(event)
        return
      }

      pendingNodePointerMove = null
    }

    handleSelectedBoundsPointerMove(event)
  }

  const handleNodePointerUp = (event: PointerEvent) => {
    const pending = pendingNodePointerMove

    if (
      (pending && event.pointerId !== pending.pointerId) ||
      (selectionMovePointerId !== null && event.pointerId !== selectionMovePointerId)
    ) {
      return
    }

    window.removeEventListener('pointermove', handleNodePointerMove, true)
    window.removeEventListener('pointerup', handleNodePointerUp, true)
    window.removeEventListener('pointercancel', handleNodePointerCancel, true)
    const pendingSelectionNodeId = pending?.pendingSelectionNodeId
    pendingNodePointerMove = null
    runtime.isResizingNode.value = false

    if (!runtime.interaction.selectionMoveDrag) {
      if (selectionMovePointerCaptureTarget?.hasPointerCapture(event.pointerId)) {
        selectionMovePointerCaptureTarget.releasePointerCapture(event.pointerId)
      }
      selectionMovePointerCaptureTarget = null
      selectionMovePointerId = null
      if (pendingSelectionNodeId) {
        options.commitPendingNodeSelection?.(pendingSelectionNodeId, 'click')
      }
      return
    }

    finishSelectionMovePointerUp(event)
  }

  const handleNodePointerCancel = (event: PointerEvent) => {
    const pending = pendingNodePointerMove

    if (
      (pending && event.pointerId !== pending.pointerId) ||
      (selectionMovePointerId !== null && event.pointerId !== selectionMovePointerId)
    ) {
      return
    }

    const pendingSelectionNodeId = pending?.pendingSelectionNodeId ?? activePendingSelectionNodeId
    activePendingSelectionNodeId = null
    clearPendingNodePointerMove(event)
    removeSelectionMoveWheelListener()
    if (runtime.interaction.selectionMoveDrag?.frame) {
      window.cancelAnimationFrame(runtime.interaction.selectionMoveDrag.frame)
      runtime.interaction.selectionMoveDrag.frame = undefined
    }
    if (runtime.interaction.selectionMoveDrag) {
      restoreSelectionMoveRuntimeSnapshots(runtime.interaction.selectionMoveDrag)
    }
    runtime.interaction.selectionMoveDrag = null
    runtime.isMovingSelection.value = false
    runtime.isResizingNode.value = false
    bumpSelectionMovePreviewVersion()
    clearSelectionMovePresentation()
    services.scheduleSelectionBoundsRefresh()
    if (pendingSelectionNodeId) {
      options.cancelPendingNodeSelection?.(pendingSelectionNodeId)
    }
  }

  const beginNodePointerMove = (
    event: PointerEvent,
    nodeId: string,
    optionsOverride: BeginNodePointerMoveOptions = {}
  ) => {
    if (
      !runtime.isLoggedIn.value ||
      event.button !== 0 ||
      runtime.interaction.selectionMoveDrag ||
      pendingNodePointerMove
    ) {
      return false
    }

    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('.vue-flow__node[data-id]')
      : null
    const selectedIds = options.getSelectedNodeIds()
    const selectedIdSet = new Set(selectedIds)
    const moveSelection = selectedIds.length > 1 && selectedIdSet.has(nodeId)
    const runtimeNode = runtime.findNode(nodeId) as RuntimePositionedFlowNode | undefined
    const singleSectionMove = !moveSelection && runtimeNode && isSectionFlowNode(runtimeNode)
      ? buildSingleSectionMoveStartMetadata(runtimeNode)
      : undefined

    pendingNodePointerMove = {
      nodeId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      target,
      pendingSelectionNodeId: optionsOverride.pendingSelectionNodeId,
      singleSectionMove: singleSectionMove ?? undefined
    }
    selectionMovePointerCaptureTarget = target
    selectionMovePointerId = event.pointerId
    if (target && typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(event.pointerId)
      } catch {
        selectionMovePointerCaptureTarget = null
      }
    }

    window.addEventListener('pointermove', handleNodePointerMove, { capture: true })
    window.addEventListener('pointerup', handleNodePointerUp, { capture: true, once: true })
    window.addEventListener('pointercancel', handleNodePointerCancel, { capture: true, once: true })

    return true
  }

  const commitMovedSelectedNodes = (drag: SelectionMoveDrag) => {
    const document = runtime.flowDocument.value
    const movingIds = drag.movingIds

    if (!document || movingIds.size === 0) {
      services.submitGraphSnapshot()
      return false
    }

    if (!hasCommittedSelectionMovePositionChange(drag)) {
      restoreSelectionMoveRuntimeSnapshots(drag)
      return false
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

  const cleanupSelectionMove = () => {
    window.removeEventListener('pointermove', handleSelectedBoundsPointerMove, true)
    window.removeEventListener('pointerup', handleSelectedBoundsPointerUp, true)
    window.removeEventListener('pointermove', handleNodePointerMove, true)
    window.removeEventListener('pointerup', handleNodePointerUp, true)
    window.removeEventListener('pointercancel', handleNodePointerCancel, true)
    removeSelectionMoveWheelListener()
    if (runtime.interaction.selectionMoveDrag?.frame) {
      window.cancelAnimationFrame(runtime.interaction.selectionMoveDrag.frame)
      runtime.interaction.selectionMoveDrag.frame = undefined
    }
    if (runtime.interaction.selectionMoveDrag) {
      restoreSelectionMoveRuntimeSnapshots(runtime.interaction.selectionMoveDrag)
    }
    const pendingSelectionNodeId =
      pendingNodePointerMove?.pendingSelectionNodeId ?? activePendingSelectionNodeId
    clearSelectionMovePresentation()
    runtime.interaction.selectionMoveDrag = null
    bumpSelectionMovePreviewVersion()
    if (runtime.interaction.scheduleSelectionMoveFrame === scheduleSelectionMoveFrame) {
      delete runtime.interaction.scheduleSelectionMoveFrame
    }
    selectionMovePointerCaptureTarget = null
    selectionMovePointerId = null
    pendingNodePointerMove = null
    activePendingSelectionNodeId = null
    if (pendingSelectionNodeId) {
      options.cancelPendingNodeSelection?.(pendingSelectionNodeId)
    }
  }

  runtime.interaction.scheduleSelectionMoveFrame = scheduleSelectionMoveFrame

  return {
    cleanupSelectionMove,
    clearSectionNodeDragPreview,
    beginNodePointerMove,
    handleSelectionMoveWheel,
    handleSelectedBoundsPointerDown,
    handleSectionNodeDragStart,
    selectionMovePreview
  }
}
