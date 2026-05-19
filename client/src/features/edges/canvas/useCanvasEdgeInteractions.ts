import type {
  Connection as FlowConnection,
  GraphNode,
  HandleElement
} from '@vue-flow/core'
import type { FlowEditorServices } from '../../../app/flowEditorServices'
import type { FlowRuntime } from '../../../flowRuntime'
import { endpointHitRadiusPx } from './constants'
import { getHandleAnchor } from './geometry'
import type {
  CachedEdgeRender,
  CanvasEdgeDependencies,
  CanvasGraphEdge,
  EdgeEndpoint,
  EdgeUpdateDrag,
  HandleCandidate
} from './types'

type CanvasEdgeRendererApi = {
  ensureEdgeRenderCache: () => void
  getCachedGraphEdges: () => CanvasGraphEdge[]
  getGraphPointFromEvent: (event: MouseEvent | PointerEvent) => { x: number, y: number } | null
  hitTestEdge: (event: MouseEvent | PointerEvent) => {
    render: CachedEdgeRender
    point: { x: number, y: number }
  } | null
}

type CanvasEdgePreviewApi = {
  scheduleDraw: () => void
}

type CanvasHandleConnectionApi = {
  events: {
    handlePointerDown: (event: PointerEvent) => boolean
  }
}

export const createCanvasEdgeInteractions = (
  runtime: FlowRuntime,
  services: FlowEditorServices,
  dependencies: CanvasEdgeDependencies,
  renderer: CanvasEdgeRendererApi,
  preview: CanvasEdgePreviewApi,
  handleConnections: CanvasHandleConnectionApi
) => {
  let edgeUpdateDrag: EdgeUpdateDrag | null = null
  let isHoveringEdge = false

  const setEdgeHover = (hovering: boolean) => {
    if (isHoveringEdge === hovering) {
      return
    }

    isHoveringEdge = hovering
    runtime.canvasPanel.value?.classList.toggle('canvas-edge-hover', hovering)
  }

  const getEndpointHit = (render: CachedEdgeRender, point: { x: number, y: number }) => {
    const radius = endpointHitRadiusPx / Math.max(0.001, runtime.viewport.value.zoom)
    const sourceDistance = Math.hypot(
      point.x - render.geometry.sourceX,
      point.y - render.geometry.sourceY
    )
    const targetDistance = Math.hypot(
      point.x - render.geometry.targetX,
      point.y - render.geometry.targetY
    )

    if (sourceDistance <= radius && sourceDistance <= targetDistance) {
      return 'source'
    }

    if (targetDistance <= radius) {
      return 'target'
    }

    return null
  }

  const isBlockedEdgeTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) {
      return false
    }

    const hardBlockSelector = [
      '.vue-flow__node-item',
      '.vue-flow__handle',
      '.vue-flow__resize-control',
      '.node-resizer-layer',
      '.flowchart-canvas-minimap',
      '.selected-nodes-outline',
      '.selected-bounds-hit',
      '.context-menu'
    ].join(', ')

    if (target.closest(hardBlockSelector)) {
      return true
    }

    const sectionNode = target.closest('.vue-flow__node-section')

    if (sectionNode) {
      return Boolean(target.closest('button, label, .image-picker'))
    }

    return Boolean(target.closest(
      [
        '[data-node-interactive]',
        'input',
        'textarea',
        'button',
        'label',
        'select',
        '[contenteditable]'
      ].join(', ')
    ))
  }

  const buildConnectionForCandidate = (
    edge: CanvasGraphEdge,
    endpoint: EdgeEndpoint,
    node: GraphNode,
    handle: HandleElement
  ): FlowConnection => {
    return endpoint === 'source'
      ? {
        source: node.id,
        target: edge.target,
        sourceHandle: handle.id ?? null,
        targetHandle: edge.targetHandle ?? null
      }
      : {
        source: edge.source,
        target: node.id,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: handle.id ?? null
      }
  }

  const findNearestHandleCandidate = (
    edge: CanvasGraphEdge,
    endpoint: EdgeEndpoint,
    point: { x: number, y: number }
  ) => {
    const handleType: 'source' | 'target' = endpoint === 'source' ? 'source' : 'target'
    const radius = Math.max(
      runtime.connectionRadius.value ?? 0,
      endpointHitRadiusPx
    ) / Math.max(0.001, runtime.viewport.value.zoom)
    let nearest: HandleCandidate | null = null

    for (const node of runtime.getNodes.value) {
      if (node.hidden) {
        continue
      }

      const handles = node.handleBounds?.[handleType]

      if (!handles?.length) {
        continue
      }

      for (const handle of handles) {
        const handlePoint = getHandleAnchor(node, handle)
        const distance = Math.hypot(point.x - handlePoint.x, point.y - handlePoint.y)

        if (distance > radius || (nearest && distance >= nearest.distance)) {
          continue
        }

        const connection = buildConnectionForCandidate(edge, endpoint, node, handle)
        nearest = {
          node,
          handle,
          point: handlePoint,
          connection,
          distance,
          valid: services.isValidSectionConnection(connection)
        }
      }
    }

    return nearest
  }

  const syncEdgeUpdateDrag = (event: PointerEvent) => {
    const drag = edgeUpdateDrag
    const point = renderer.getGraphPointFromEvent(event)

    if (!drag || !point) {
      return
    }

    renderer.ensureEdgeRenderCache()

    const edge = renderer.getCachedGraphEdges().find((candidate) => candidate.id === drag.edgeId)

    drag.pointerGraph = point
    drag.candidate = edge ? findNearestHandleCandidate(edge, drag.endpoint, point) : null
    preview.scheduleDraw()
  }

  const clearEdgeUpdateDrag = () => {
    if (!edgeUpdateDrag) {
      return
    }

    edgeUpdateDrag = null
    window.removeEventListener('pointermove', handleEdgeUpdatePointerMove, true)
    window.removeEventListener('pointerup', handleEdgeUpdatePointerUp, true)
    window.removeEventListener('pointercancel', handleEdgeUpdatePointerCancel, true)
    preview.scheduleDraw()
  }

  const handleEdgeUpdatePointerMove = (event: PointerEvent) => {
    if (!edgeUpdateDrag) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    syncEdgeUpdateDrag(event)
  }

  const handleEdgeUpdatePointerUp = (event: PointerEvent) => {
    const drag = edgeUpdateDrag

    if (!drag) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    syncEdgeUpdateDrag(event)

    const connection = drag.candidate?.valid ? drag.candidate.connection : null

    clearEdgeUpdateDrag()

    if (connection) {
      dependencies.updateEdgeConnectionById(drag.edgeId, connection)
    }
  }

  const handleEdgeUpdatePointerCancel = (event: PointerEvent) => {
    if (!edgeUpdateDrag) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    clearEdgeUpdateDrag()
  }

  const beginEdgeUpdateDrag = (
    edgeId: string,
    endpoint: EdgeEndpoint,
    point: { x: number, y: number },
    event: PointerEvent
  ) => {
    clearEdgeUpdateDrag()
    edgeUpdateDrag = {
      edgeId,
      endpoint,
      pointerGraph: point,
      candidate: null
    }
    syncEdgeUpdateDrag(event)
    window.addEventListener('pointermove', handleEdgeUpdatePointerMove, { capture: true })
    window.addEventListener('pointerup', handleEdgeUpdatePointerUp, { capture: true, once: true })
    window.addEventListener('pointercancel', handleEdgeUpdatePointerCancel, { capture: true, once: true })
  }

  const handleCanvasPointerDown = (event: PointerEvent) => {
    if (handleConnections.events.handlePointerDown(event)) {
      setEdgeHover(false)
      return true
    }

    if (!runtime.isLoggedIn.value || event.button !== 0 || isBlockedEdgeTarget(event.target)) {
      setEdgeHover(false)
      return false
    }

    const hit = renderer.hitTestEdge(event)

    if (!hit) {
      setEdgeHover(false)
      return false
    }

    setEdgeHover(true)
    runtime.interaction.ignoreVueFlowSelectionUntil = Date.now() + 350
    const graphEdge = renderer.getCachedGraphEdges().find((edge) => edge.id === hit.render.id)
    const selected = Boolean(graphEdge?.selected)
    const endpoint = selected ? getEndpointHit(hit.render, hit.point) : null
    event.preventDefault()
    event.stopPropagation()

    if (endpoint) {
      beginEdgeUpdateDrag(hit.render.id, endpoint, hit.point, event)
      return true
    }

    dependencies.selectOnlyEdge(hit.render.id)
    return true
  }

  const handleCanvasPointerMove = (event: PointerEvent) => {
    if (edgeUpdateDrag) {
      event.preventDefault()
      event.stopPropagation()
      syncEdgeUpdateDrag(event)
      return true
    }

    if (!runtime.isLoggedIn.value || isBlockedEdgeTarget(event.target)) {
      setEdgeHover(false)
      return false
    }

    setEdgeHover(Boolean(renderer.hitTestEdge(event)))
    return false
  }

  const handleCanvasPointerLeave = () => {
    setEdgeHover(false)
  }

  const handleCanvasContextMenu = (event: MouseEvent) => {
    if (!runtime.isLoggedIn.value || isBlockedEdgeTarget(event.target)) {
      setEdgeHover(false)
      return false
    }

    const hit = renderer.hitTestEdge(event)

    if (!hit) {
      setEdgeHover(false)
      return false
    }

    setEdgeHover(true)
    event.preventDefault()
    event.stopPropagation()
    dependencies.selectOnlyEdge(hit.render.id)
    dependencies.openEdgeContextMenuById(hit.render.id, event)
    return true
  }

  const handleA11ySelectEdge = (edgeId: string) => {
    if (!runtime.isLoggedIn.value) {
      return
    }

    dependencies.selectOnlyEdge(edgeId)
  }

  return {
    accessibility: {
      selectEdge: handleA11ySelectEdge
    },
    cleanup: () => {
      clearEdgeUpdateDrag()
      setEdgeHover(false)
    },
    events: {
      handleContextMenu: handleCanvasContextMenu,
      handlePointerDown: handleCanvasPointerDown,
      handlePointerLeave: handleCanvasPointerLeave,
      handlePointerMove: handleCanvasPointerMove
    },
    getEdgeUpdateDrag: () => edgeUpdateDrag
  }
}
