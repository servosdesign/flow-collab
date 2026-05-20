import type { FlowViewport } from '@vue-flow-sync/shared'
import { computed, nextTick } from 'vue'
import type { FlowEditorServices } from '../../app/flowEditorServices'
import {
  createGraphCache,
  normalizeNode,
  type FlowNode
} from '../../domain/graph'
import type { FlowRuntime } from '../../flowRuntime'
import type {
  SelectionMoveDrag,
  SelectionOverlayGeometrySnapshot,
  SelectionMovePresentationStrategy,
  SelectionMovePreviewCounts
} from '../../flowTypes'
import { getSelectionOutlineElement } from './selectionDom'
import {
  createSelectionOverlayGeometrySnapshot,
  getSelectionIdsKey,
  translateSelectionOverlayGeometry
} from './selectionOverlayGeometry'
import { createSelectionMoveCommit } from './selectionMove/commit'
import {
  largeSelectionMovePreviewMode,
  largeSelectionMovePreviewThreshold,
  maxSelectionMovePreviewShapes,
  nodePointerMoveThreshold,
  selectionBoundsPadding,
  selectionMoveMaxZoom,
  selectionMoveMinZoom,
  selectionMoveWheelZoomStep
} from './selectionMove/constants'
import {
  buildRuntimeSectionHiddenIds,
  buildSectionDragDescendantIds,
  buildSelectionMoveHiddenIds,
  buildSelectionMovePreviewMetadata,
  countSectionIds,
  getMovableSelectedIds,
  getSelectionFlowBoundsSnapshot,
  getSingleSelectedTopLevelSectionNode,
  isSectionFlowNode
} from './selectionMove/metadata'
import { createSelectionMovePresentation } from './selectionMove/presentation'
import { createSelectionMoveRuntimeDrag } from './selectionMove/runtimeDrag'
import type {
  BeginNodePointerMoveOptions,
  PendingNodePointerMove,
  PendingSelectionMoveCommit,
  RuntimePositionedFlowNode,
  SelectionMovePreviewShape,
  SelectionMoveStartOptions,
  SingleSectionMoveStartMetadata,
  UseSelectionMoveOptions
} from './selectionMove/types'

export const useSelectionMove = (
  runtime: FlowRuntime,
  services: FlowEditorServices,
  options: UseSelectionMoveOptions
) => {
  let selectionMovePointerCaptureTarget: HTMLElement | null = null
  let selectionMovePointerId: number | null = null
  let pendingNodePointerMove: PendingNodePointerMove | null = null
  let pendingSelectionMoveCommit: PendingSelectionMoveCommit | null = null
  let activePendingSelectionNodeId: string | null = null
  let activeSelectionOverlayGeometrySnapshot: SelectionOverlayGeometrySnapshot | null = null

  const bumpSelectionMovePreviewVersion = () => {
    runtime.selectionMovePreviewVersion.value += 1
  }

  const bumpMiniMapGeometryVersion = () => {
    runtime.miniMapGeometryVersion.value += 1
  }

  const selectionMovePreview = computed(() => {
    const sectionDragPreview = runtime.sectionNodeDragPreview.value

    if (sectionDragPreview) {
      const showSummary = sectionDragPreview.showSummary
      const prearmed = Boolean(sectionDragPreview.prearmed)

      return {
        active: true,
        interactionShield: false,
        coverContents: sectionDragPreview.hideStrategy === 'cover',
        showOriginMask: prearmed,
        showSummary,
        prearmed,
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
        interactionShield: Boolean(runtime.isMovingSelection.value || selectionMoveDrag),
        coverContents: false,
        showOriginMask: false,
        showSummary: false,
        prearmed: false,
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
      interactionShield: true,
      coverContents: isSingleSectionBundle,
      showOriginMask: selectionMoveDrag.presentationStrategy === 'origin-mask',
      showSummary: true,
      prearmed: false,
      ...selectionMoveDrag.previewCounts,
      shapes
    }
  })

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

  const captureSelectionOverlayGeometrySnapshot = () => {
    activeSelectionOverlayGeometrySnapshot =
      options.getCurrentSelectionOverlayGeometrySnapshot?.() ?? null
  }

  const getCapturedSelectionMoveBounds = (
    selectedIds: string[]
  ) : SelectionMoveDrag['selectedFlowBounds'] => {
    const snapshot = activeSelectionOverlayGeometrySnapshot

    if (!snapshot?.selectedBounds || snapshot.selectedIdsKey !== getSelectionIdsKey(selectedIds)) {
      return null
    }

    return {
      ...snapshot.selectedBounds,
      padding: snapshot.selectedBounds.padding ?? selectionBoundsPadding
    }
  }

  const clearSelectionOverlayGeometrySnapshots = () => {
    activeSelectionOverlayGeometrySnapshot = null
    runtime.selectionOverlayGeometrySnapshot.value = null
  }

  const seedCommittedSelectionOverlayGeometrySnapshot = (drag: SelectionMoveDrag) => {
    const snapshot = activeSelectionOverlayGeometrySnapshot
    activeSelectionOverlayGeometrySnapshot = null

    if (!snapshot) {
      runtime.selectionOverlayGeometrySnapshot.value = null
      return
    }

    const selectedIds = options.getSelectedNodeIds()

    if (snapshot.selectedIdsKey !== getSelectionIdsKey(selectedIds)) {
      runtime.selectionOverlayGeometrySnapshot.value = null
      return
    }

    const delta = getSelectionMoveDelta(drag)

    runtime.selectionOverlayGeometrySnapshot.value = createSelectionOverlayGeometrySnapshot(
      selectedIds,
      runtime.selectionBoundsVersion.value,
      translateSelectionOverlayGeometry(snapshot, {
        x: Math.round(delta.x),
        y: Math.round(delta.y)
      })
    )
  }

  const selectionMovePresentation = createSelectionMovePresentation(
    runtime,
    getSelectionMoveDelta
  )
  const selectionMoveRuntimeDrag = createSelectionMoveRuntimeDrag(
    runtime,
    getSelectionMoveDelta
  )
  const selectionMoveCommit = createSelectionMoveCommit(runtime, services, {
    applyVisibleSelectionMove: selectionMoveRuntimeDrag.applyVisibleSelectionMove,
    bumpMiniMapGeometryVersion,
    getSelectionMoveDelta,
    restoreSelectionMoveRuntimeSnapshots:
      selectionMoveRuntimeDrag.restoreSelectionMoveRuntimeSnapshots
  })

  const handleSectionNodeDragStart = (sectionId: string) => {
    if (runtime.interaction.selectionMoveDrag) {
      return
    }

    const allNodes = (runtime.nodes.value as FlowNode[]).map(normalizeNode)
    const graph = createGraphCache(allNodes)
    const descendantIds = buildSectionDragDescendantIds(sectionId, allNodes, graph)

    if (!descendantIds) {
      return
    }

    const useLargeSectionPreview = descendantIds.size + 1 > largeSelectionMovePreviewThreshold

    if (!useLargeSectionPreview) {
      runtime.sectionNodeDragPreview.value = null
      selectionMovePresentation.clearSelectionMoveHiddenIds()
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

    selectionMovePresentation.hideSelectionMoveIds(descendantIds)
  }

  const clearSectionNodeDragPreview = () => {
    const preview = runtime.sectionNodeDragPreview.value

    if (!preview) {
      return
    }

    runtime.sectionNodeDragPreview.value = null
    selectionMovePresentation.clearSelectionMoveHiddenIds()
  }

  const clearPrearmedSectionNodeDragPreview = () => {
    if (!runtime.sectionNodeDragPreview.value?.prearmed) {
      return
    }

    runtime.sectionNodeDragPreview.value = null
  }

  const applySelectionMoveFrame = () => {
    const selectionMoveDrag = runtime.interaction.selectionMoveDrag

    if (!selectionMoveDrag) {
      return
    }

    selectionMoveDrag.frame = undefined
    selectionMovePresentation.paintSelectionMovePreview(selectionMoveDrag)
    selectionMovePresentation.paintVisibleDragPreview(selectionMoveDrag)
    bumpSelectionMovePreviewVersion()

    if (selectionMoveDrag.mode === 'bundle') {
      return
    }

    if (selectionMovePresentation.hasVisibleDragElementSnapshots()) {
      return
    }

    selectionMoveRuntimeDrag.applyVisibleSelectionMove(selectionMoveDrag, true)
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

    return true
  }

  const handleActiveSelectionMoveWheel = (event: WheelEvent) => {
    handleSelectionMoveWheel(event)
  }

  const settleVisibleDragAtLastPaintedPosition = (selectionMoveDrag: SelectionMoveDrag) => {
    if (
      !selectionMovePresentation.hasTransformOnlyVisiblePreview(selectionMoveDrag) ||
      !selectionMoveDrag.hasPaintedPreview
    ) {
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
    const presentationStrategy: SelectionMovePresentationStrategy =
      mode === 'bundle'
        ? 'origin-mask'
        : 'element-classes'
    const originalSyncNodesById = new Map(normalizedOriginalNodes.map((node) => [node.id, node]))
    const dragMetadata = options.dragMetadata ??
      selectionMoveRuntimeDrag.buildSelectionMoveDragMetadata(normalizedOriginalNodes, movingIds)
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
    selectionMovePresentation.clearSelectionMovePreview()
    selectionMovePresentation.setSelectionMovePreviewElement(options.previewElement)
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
      presentationStrategy,
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
    selectionMovePresentation.hideBundleSelectionNodes(runtime.interaction.selectionMoveDrag)
    selectionMovePresentation.beginVisibleDragPreview(runtime.interaction.selectionMoveDrag)
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
    const topLevelSectionNode = getSingleSelectedTopLevelSectionNode(
      selectedIds,
      runtime.nodes.value as RuntimePositionedFlowNode[]
    )
    const sectionMetadata = topLevelSectionNode
      ? buildSingleSectionMoveStartMetadata(topLevelSectionNode)
      : null

    if (sectionMetadata) {
      captureSelectionOverlayGeometrySnapshot()
      const started = beginSelectionMove({
        startClientX: event.clientX,
        startClientY: event.clientY,
        currentClientX: event.clientX,
        currentClientY: event.clientY,
        pointerId: event.pointerId,
        target,
        previewElement: getSelectionOutlineElement(runtime, event, target),
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
        activeSelectionOverlayGeometrySnapshot = null
        return
      }

      window.addEventListener('pointermove', handleSelectedBoundsPointerMove, { capture: true })
      window.addEventListener('pointerup', handleSelectedBoundsPointerUp, { capture: true, once: true })
      return
    }

    const normalizedOriginalNodes = (runtime.nodes.value as FlowNode[]).map(normalizeNode)
    const movingIds = getMovableSelectedIds(normalizedOriginalNodes, options.getSelectedNodeIds())

    captureSelectionOverlayGeometrySnapshot()
    const selectedFlowBounds =
      getCapturedSelectionMoveBounds(selectedIds) ??
      getSelectionFlowBoundsSnapshot(selectedIds, normalizedOriginalNodes)
    const started = beginSelectionMove({
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      pointerId: event.pointerId,
      target,
      previewElement: getSelectionOutlineElement(runtime, event, target),
      movingIds,
      selectedFlowBounds,
      normalizedOriginalNodes
    })

    if (!started) {
      activeSelectionOverlayGeometrySnapshot = null
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
    selectionMovePresentation.clearSelectionMovePreview(restoreVisibleDragTransforms)
    clearSectionNodeDragPreview()
  }

  const removeSelectionMoveWheelListener = () => {
    window.removeEventListener('wheel', handleActiveSelectionMoveWheel, true)
  }

  const clearSelectionMoveCommitSchedule = () => {
    if (runtime.timers.selectionMoveCommitFrame) {
      window.cancelAnimationFrame(runtime.timers.selectionMoveCommitFrame)
      runtime.timers.selectionMoveCommitFrame = undefined
    }

    if (runtime.timers.selectionMoveCommitTimer) {
      window.clearTimeout(runtime.timers.selectionMoveCommitTimer)
      runtime.timers.selectionMoveCommitTimer = undefined
    }

    if (runtime.timers.selectionMoveCommitFallbackTimer) {
      window.clearTimeout(runtime.timers.selectionMoveCommitFallbackTimer)
      runtime.timers.selectionMoveCommitFallbackTimer = undefined
    }
  }

  const finishDropSettle = () => {
    if (runtime.isDropSettling.value) {
      runtime.isDropSettling.value = false
      runtime.dropSettleVersion.value += 1
    }
  }

  const clearSelectionMovePresentationAfterPaint = (
    restoreVisibleDragTransforms: boolean,
    afterClear?: () => void
  ) => {
    nextTick(() => {
      window.requestAnimationFrame(() => {
        clearSelectionMovePresentation(restoreVisibleDragTransforms)
        afterClear?.()
      })
    })
  }

  const runDeferredSelectionMoveCommit = (pending: PendingSelectionMoveCommit) => {
    if (pendingSelectionMoveCommit !== pending) {
      return
    }

    clearSelectionMoveCommitSchedule()
    pendingSelectionMoveCommit = null

    const { drag, pendingSelectionNodeId } = pending
    const committed = selectionMoveCommit.commitMovedSelectedNodes(drag)

    if (committed) {
      seedCommittedSelectionOverlayGeometrySnapshot(drag)
    } else {
      clearSelectionOverlayGeometrySnapshots()
    }

    activePendingSelectionNodeId = null
    runtime.interaction.selectionMoveDrag = null
    runtime.isMovingSelection.value = false
    bumpSelectionMovePreviewVersion()

    if (committed) {
      clearSelectionMovePresentationAfterPaint(false, () => {
        if (!pendingSelectionNodeId) {
          finishDropSettle()
        }
      })
      if (pendingSelectionNodeId) {
        options.commitPendingNodeSelection?.(pendingSelectionNodeId, 'drop')
      }
      return
    }

    clearSelectionMovePresentation()
    finishDropSettle()
    if (pendingSelectionNodeId) {
      options.cancelPendingNodeSelection?.(pendingSelectionNodeId)
    }
  }

  const scheduleDeferredSelectionMoveCommit = (
    drag: SelectionMoveDrag,
    pendingSelectionNodeId: string | null
  ) => {
    clearSelectionMoveCommitSchedule()
    pendingSelectionMoveCommit = { drag, pendingSelectionNodeId }
    runtime.isDropSettling.value = true

    const runCommit = () => {
      const pending = pendingSelectionMoveCommit

      if (pending) {
        runDeferredSelectionMoveCommit(pending)
      }
    }

    runtime.timers.selectionMoveCommitFrame = window.requestAnimationFrame(() => {
      runtime.timers.selectionMoveCommitFrame = undefined
      runtime.timers.selectionMoveCommitTimer = window.setTimeout(runCommit, 0)
    })
    runtime.timers.selectionMoveCommitFallbackTimer = window.setTimeout(runCommit, 180)
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
      clearSelectionOverlayGeometrySnapshots()
      runtime.interaction.selectionMoveDrag = null
      runtime.isMovingSelection.value = false
      clearSelectionMovePresentation()
      return
    }

    event.preventDefault()
    event.stopImmediatePropagation()
    runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350
    const pendingSelectionNodeId = activePendingSelectionNodeId
    activePendingSelectionNodeId = null
    scheduleDeferredSelectionMoveCommit(drag, pendingSelectionNodeId)
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

      if (!drag || selectionMovePresentation.getSelectionMovePreviewElement()) {
        return
      }

      const element = runtime.canvasPanel.value?.querySelector<HTMLElement>('.selected-nodes-outline') ?? null

      if (!element) {
        return
      }

      selectionMovePresentation.setSelectionMovePreviewElement(element)
      selectionMovePresentation.paintSelectionMovePreview(drag)
    })
  }

  const buildSingleSectionMoveStartMetadata = (
    sectionNode: RuntimePositionedFlowNode
  ) : SingleSectionMoveStartMetadata | null => {
    const syncSection = normalizeNode(sectionNode)

    if (syncSection.type !== 'section') {
      return null
    }

    const movingIds = new Set([syncSection.id])
    const { hiddenIds, containedSectionCount } = buildRuntimeSectionHiddenIds(
      runtime.nodes.value as FlowNode[],
      syncSection.id
    )
    const dragMetadata = selectionMoveRuntimeDrag.buildSingleSectionDragMetadata(
      sectionNode,
      syncSection,
      movingIds
    )
    const sectionPosition = dragMetadata.originalPositionsById.get(syncSection.id) ?? {
      x: Math.round(syncSection.position.x),
      y: Math.round(syncSection.position.y)
    }
    const sectionDimensions = dragMetadata.dragItems[0]?.dimensions ??
      selectionMoveRuntimeDrag.getRuntimeNodeDimensions(sectionNode, syncSection)
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

  const prearmSingleSectionMovePreview = (
    metadata: SingleSectionMoveStartMetadata
  ) => {
    if (metadata.mode !== 'bundle') {
      return
    }

    runtime.sectionNodeDragPreview.value = {
      sectionId: metadata.syncSection.id,
      previewCounts: metadata.previewCounts,
      hiddenIds: metadata.hiddenIds,
      hideStrategy: 'cover',
      showSummary: true,
      prearmed: true,
      selectedFlowBounds: metadata.selectedFlowBounds
    }
  }

  const cachePrearmedSectionMovePreviewElement = (
    pending: PendingNodePointerMove
  ) => {
    nextTick(() => {
      if (
        pendingNodePointerMove !== pending ||
        runtime.interaction.selectionMoveDrag ||
        !runtime.sectionNodeDragPreview.value?.prearmed
      ) {
        return
      }

      pending.prearmedPreviewElement =
        runtime.canvasPanel.value?.querySelector<HTMLElement>('.selected-nodes-outline') ?? null
    })
  }

  const beginSingleSectionMove = (
    event: PointerEvent,
    pending: PendingNodePointerMove,
    sectionNode: RuntimePositionedFlowNode
  ) => {
    const metadata = pending.singleSectionMove ?? buildSingleSectionMoveStartMetadata(sectionNode)

    if (!metadata) {
      clearPrearmedSectionNodeDragPreview()
      return false
    }

    const started = beginSelectionMove({
      startClientX: pending.startClientX,
      startClientY: pending.startClientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      pointerId: pending.pointerId,
      target: pending.target,
      previewElement: pending.prearmedPreviewElement ?? null,
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

    clearPrearmedSectionNodeDragPreview()

    return started
  }

  const startPendingNodePointerMove = (event: PointerEvent, pending: PendingNodePointerMove) => {
    const selectedIds = options.getSelectedNodeIds()
    const selectedIdSet = new Set(selectedIds)
    const moveSelection = selectedIds.length > 1 && selectedIdSet.has(pending.nodeId)
    const runtimeNode = runtime.findNode(pending.nodeId) as FlowNode | undefined

    if (!runtimeNode) {
      return false
    }

    if (!moveSelection) {
      activeSelectionOverlayGeometrySnapshot = null
    }

    if (!moveSelection && isSectionFlowNode(runtimeNode)) {
      const started = beginSingleSectionMove(event, pending, runtimeNode as RuntimePositionedFlowNode)

      if (!started) {
        return false
      }

      activePendingSelectionNodeId = pending.pendingSelectionNodeId ?? null
      if (!selectionMovePresentation.getSelectionMovePreviewElement()) {
        attachSelectionMovePreviewElementOnNextTick()
      }
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
      ? getMovableSelectedIds(normalizedOriginalNodes, selectedIds)
      : new Set([pending.nodeId])
    const useSingleSectionPreview = !moveSelection && node.type === 'section'
    let selectedFlowBounds: SelectionMoveDrag['selectedFlowBounds'] = null

    if (moveSelection) {
      captureSelectionOverlayGeometrySnapshot()
      selectedFlowBounds =
        getCapturedSelectionMoveBounds(selectedIds) ??
        getSelectionFlowBoundsSnapshot(selectedIds, normalizedOriginalNodes)
    } else {
      activeSelectionOverlayGeometrySnapshot = null
      selectedFlowBounds = useSingleSectionPreview
        ? getSelectionFlowBoundsSnapshot([pending.nodeId], normalizedOriginalNodes)
        : null
    }

    const started = beginSelectionMove({
      startClientX: pending.startClientX,
      startClientY: pending.startClientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      pointerId: pending.pointerId,
      target: pending.target,
      previewElement: moveSelection
        ? getSelectionOutlineElement(runtime, event, pending.target)
        : null,
      movingIds,
      selectedFlowBounds,
      normalizedOriginalNodes
    })

    if (!started) {
      activeSelectionOverlayGeometrySnapshot = null
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
    clearPrearmedSectionNodeDragPreview()

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
      clearPrearmedSectionNodeDragPreview()
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
      selectionMoveRuntimeDrag.restoreSelectionMoveRuntimeSnapshots(
        runtime.interaction.selectionMoveDrag
      )
    }
    clearSelectionOverlayGeometrySnapshots()
    runtime.interaction.selectionMoveDrag = null
    runtime.isMovingSelection.value = false
    runtime.isResizingNode.value = false
    bumpSelectionMovePreviewVersion()
    clearSelectionMovePresentation()
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

    if (singleSectionMove?.mode === 'bundle' && pendingNodePointerMove) {
      prearmSingleSectionMovePreview(singleSectionMove)
      cachePrearmedSectionMovePreviewElement(pendingNodePointerMove)
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

  const cleanupSelectionMove = () => {
    window.removeEventListener('pointermove', handleSelectedBoundsPointerMove, true)
    window.removeEventListener('pointerup', handleSelectedBoundsPointerUp, true)
    window.removeEventListener('pointermove', handleNodePointerMove, true)
    window.removeEventListener('pointerup', handleNodePointerUp, true)
    window.removeEventListener('pointercancel', handleNodePointerCancel, true)
    removeSelectionMoveWheelListener()
    clearSelectionMoveCommitSchedule()
    pendingSelectionMoveCommit = null
    if (runtime.interaction.selectionMoveDrag?.frame) {
      window.cancelAnimationFrame(runtime.interaction.selectionMoveDrag.frame)
      runtime.interaction.selectionMoveDrag.frame = undefined
    }
    if (runtime.interaction.selectionMoveDrag) {
      selectionMoveRuntimeDrag.restoreSelectionMoveRuntimeSnapshots(
        runtime.interaction.selectionMoveDrag
      )
    }
    const pendingSelectionNodeId =
      pendingNodePointerMove?.pendingSelectionNodeId ?? activePendingSelectionNodeId
    clearSelectionOverlayGeometrySnapshots()
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
