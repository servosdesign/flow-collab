import type {
  Connection as FlowConnection,
  GraphNode,
  HandleElement,
  HandleType
} from '@vue-flow/core'
import type { FlowEditorServices } from '../../../app/flowEditorServices'
import type { FlowRuntime } from '../../../flowRuntime'
import { endpointHitRadiusPx } from './constants'
import {
  getHandleAnchor,
  getNodeLookup,
  getRelevantHandle
} from './geometry'
import type { CanvasConnectionPreview, CanvasEdgeDependencies } from './types'

type CanvasEdgePreviewApi = {
  scheduleDraw: () => void
}

type HandleDragStart = {
  node: GraphNode
  handle: HandleElement
  type: HandleType
}

type HandleConnectionCandidate = HandleDragStart & {
  point: { x: number, y: number }
  connection: FlowConnection
  distance: number
  valid: boolean
}

type HandleConnectionDrag = {
  pointerId: number
  start: HandleDragStart
  candidate: HandleConnectionCandidate | null
}

const handleSelector = '.vue-flow__handle'

export const createCanvasHandleConnections = (
  runtime: FlowRuntime,
  services: FlowEditorServices,
  dependencies: CanvasEdgeDependencies,
  preview: CanvasEdgePreviewApi
) => {
  let drag: HandleConnectionDrag | null = null
  let connectionPreview: CanvasConnectionPreview | null = null

  const getViewportPointFromEvent = (event: MouseEvent | PointerEvent) => {
    const bounds =
      runtime.vueFlowRef.value?.getBoundingClientRect() ??
      runtime.canvasPanel.value?.getBoundingClientRect()

    if (!bounds) {
      return null
    }

    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top
    }
  }

  const getGraphPointFromEvent = (event: MouseEvent | PointerEvent) => {
    const flowPoint = runtime.screenToFlowCoordinate({
      x: event.clientX,
      y: event.clientY
    })

    if (Number.isFinite(flowPoint.x) && Number.isFinite(flowPoint.y)) {
      return flowPoint
    }

    const viewportPoint = getViewportPointFromEvent(event)
    const viewport = runtime.viewport.value

    if (!viewportPoint || viewport.zoom <= 0) {
      return null
    }

    return {
      x: (viewportPoint.x - viewport.x) / viewport.zoom,
      y: (viewportPoint.y - viewport.y) / viewport.zoom
    }
  }

  const getHandleElementFromTarget = (target: EventTarget | null) => {
    return target instanceof Element
      ? target.closest<HTMLElement>(handleSelector)
      : null
  }

  const getHandleTypeFromElement = (element: HTMLElement): HandleType | null => {
    if (element.classList.contains('source')) {
      return 'source'
    }

    if (element.classList.contains('target')) {
      return 'target'
    }

    return null
  }

  const getHandleStartFromElement = (element: HTMLElement) : HandleDragStart | null => {
    const type = getHandleTypeFromElement(element)
    const nodeId = element.dataset.nodeid

    if (!type || !nodeId) {
      return null
    }

    const node = getNodeLookup(runtime).get(nodeId)
    const handle = getRelevantHandle(node, type, element.dataset.handleid ?? null)

    if (!node || !handle) {
      return null
    }

    return { node, handle, type }
  }

  const buildConnection = (
    start: HandleDragStart,
    candidate: HandleDragStart
  ) : FlowConnection => {
    return start.type === 'source'
      ? {
        source: start.node.id,
        target: candidate.node.id,
        sourceHandle: start.handle.id ?? null,
        targetHandle: candidate.handle.id ?? null
      }
      : {
        source: candidate.node.id,
        target: start.node.id,
        sourceHandle: candidate.handle.id ?? null,
        targetHandle: start.handle.id ?? null
      }
  }

  const findNearestHandleCandidate = (
    start: HandleDragStart,
    point: { x: number, y: number }
  ) => {
    const targetType: HandleType = start.type === 'source' ? 'target' : 'source'
    const radius = Math.max(
      runtime.connectionRadius.value ?? 0,
      endpointHitRadiusPx
    ) / Math.max(0.001, runtime.viewport.value.zoom)
    let nearest: HandleConnectionCandidate | null = null

    for (const node of runtime.getNodes.value) {
      if (node.hidden) {
        continue
      }

      const handles = node.handleBounds?.[targetType]

      if (!handles?.length) {
        continue
      }

      for (const handle of handles) {
        const handlePoint = getHandleAnchor(node, handle)
        const distance = Math.hypot(point.x - handlePoint.x, point.y - handlePoint.y)

        if (distance > radius || (nearest && distance >= nearest.distance)) {
          continue
        }

        const candidate = { node, handle, type: targetType }
        const connection = buildConnection(start, candidate)

        nearest = {
          ...candidate,
          point: handlePoint,
          connection,
          distance,
          valid: services.isValidSectionConnection(connection)
        }
      }
    }

    return nearest
  }

  const syncHandleConnectionDrag = (event: PointerEvent) => {
    const currentDrag = drag
    const graphPoint = getGraphPointFromEvent(event)

    if (!currentDrag || !graphPoint) {
      return
    }

    const candidate = findNearestHandleCandidate(currentDrag.start, graphPoint)

    currentDrag.candidate = candidate
    connectionPreview = {
      sourceNodeId: currentDrag.start.node.id,
      sourceHandleId: currentDrag.start.handle.id ?? null,
      targetNodeId: candidate?.node.id ?? null,
      targetHandleId: candidate?.handle.id ?? null,
      pointerGraph: candidate?.point ?? graphPoint,
      status: candidate
        ? candidate.valid ? 'valid' : 'invalid'
        : null
    }
    preview.scheduleDraw()
  }

  const clearHandleConnectionDrag = () => {
    if (!drag) {
      return
    }

    drag = null
    connectionPreview = null
    window.removeEventListener('pointermove', handleWindowPointerMove, true)
    window.removeEventListener('pointerup', handleWindowPointerUp, true)
    window.removeEventListener('pointercancel', handleWindowPointerCancel, true)
    preview.scheduleDraw()
  }

  const handleWindowPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    syncHandleConnectionDrag(event)
  }

  const handleWindowPointerUp = (event: PointerEvent) => {
    const currentDrag = drag

    if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    syncHandleConnectionDrag(event)

    const connection = currentDrag.candidate?.valid
      ? currentDrag.candidate.connection
      : null

    clearHandleConnectionDrag()

    if (connection) {
      dependencies.createEdgeConnection(connection)
    }
  }

  const handleWindowPointerCancel = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    clearHandleConnectionDrag()
  }

  const handlePointerDown = (event: PointerEvent) => {
    if (!runtime.isLoggedIn.value || event.button !== 0 || drag) {
      return false
    }

    const element = getHandleElementFromTarget(event.target)
    const start = element ? getHandleStartFromElement(element) : null

    if (!element || !start || start.type !== 'source') {
      return false
    }

    event.preventDefault()
    event.stopPropagation()

    if (element.setPointerCapture) {
      element.setPointerCapture(event.pointerId)
    }

    drag = {
      pointerId: event.pointerId,
      start,
      candidate: null
    }
    connectionPreview = {
      sourceNodeId: start.node.id,
      sourceHandleId: start.handle.id ?? null,
      targetNodeId: null,
      targetHandleId: null,
      pointerGraph: getGraphPointFromEvent(event) ?? getHandleAnchor(start.node, start.handle),
      status: null
    }
    syncHandleConnectionDrag(event)
    window.addEventListener('pointermove', handleWindowPointerMove, { capture: true })
    window.addEventListener('pointerup', handleWindowPointerUp, { capture: true, once: true })
    window.addEventListener('pointercancel', handleWindowPointerCancel, { capture: true, once: true })

    return true
  }

  return {
    cleanup: clearHandleConnectionDrag,
    events: {
      handlePointerDown
    },
    getConnectionPreview: () => connectionPreview
  }
}
