import { MarkerType, Position } from '@vue-flow/core'
import {
  createGraphCache,
  getEdgeRenderType
} from '../../../domain/graph'
import type { FlowEditorServices } from '../../../app/flowEditorServices'
import type { FlowRuntime } from '../../../flowRuntime'
import {
  resolveEdgeGeometry,
  type ResolvedEdgeGeometry
} from '../edgeGeometry'
import {
  connectionPreviewStyle,
  invalidPreviewStyle
} from './constants'
import { drawEdgeRender } from './drawing'
import {
  getHandleAnchor,
  getNodeLookup,
  getOppositePosition,
  getRelevantHandle,
  isInsideSection,
  isPointInsideNode,
  portEndpointX
} from './geometry'
import {
  applyCanvasDrawWindow,
  createCanvasDrawWindow,
  createCanvasLayoutState,
  doesViewportFitDrawWindow
} from './layout'
import type {
  CanvasConnectionPreview,
  CanvasDrawWindow,
  CanvasGraphEdge,
  EdgeUpdateDrag
} from './types'

type CanvasEdgePreviewOptions = {
  getCachedGraphEdges: () => CanvasGraphEdge[]
  getConnectionPreview: () => CanvasConnectionPreview | null
  getEdgeUpdateDrag: () => EdgeUpdateDrag | null
}

export const createCanvasEdgePreview = (
  runtime: FlowRuntime,
  services: FlowEditorServices,
  options: CanvasEdgePreviewOptions
) => {
  let previewCanvasElement: HTMLCanvasElement | null = null
  let previewFrame: number | undefined
  let previewDrawWindow: CanvasDrawWindow | null = null

  const previewCanvasLayoutState = createCanvasLayoutState()

  const scheduleDraw = () => {
    if (previewFrame) {
      return
    }

    previewFrame = window.requestAnimationFrame(drawPreviewCanvas)
  }

  const syncPreviewCanvas = (canvas: HTMLCanvasElement) => {
    if (!previewDrawWindow || !doesViewportFitDrawWindow(runtime, previewDrawWindow)) {
      previewDrawWindow = createCanvasDrawWindow(runtime)
    }

    applyCanvasDrawWindow(canvas, previewDrawWindow, previewCanvasLayoutState)

    return previewDrawWindow
  }

  const getConnectionPreviewGeometry = () : ResolvedEdgeGeometry | null => {
    const previewState = options.getConnectionPreview()

    if (!previewState) {
      return null
    }

    const nodeLookup = getNodeLookup(runtime)
    const sourceNode = nodeLookup.get(previewState.sourceNodeId)

    if (!sourceNode) {
      return null
    }

    const sourceHandle = getRelevantHandle(sourceNode, 'source', previewState.sourceHandleId)

    if (!sourceHandle) {
      return null
    }

    const targetNode = previewState.targetNodeId
      ? nodeLookup.get(previewState.targetNodeId) ?? null
      : null
    const targetBounds = targetNode
      ? getRelevantHandle(targetNode, 'target', previewState.targetHandleId)
      : null
    const sourcePoint = getHandleAnchor(sourceNode, sourceHandle)
    const targetPoint = targetBounds && targetNode
      ? getHandleAnchor(targetNode, targetBounds)
      : previewState.pointerGraph
    const sourcePointerInside = isPointInsideNode(targetPoint.x, targetPoint.y, sourceNode)
    const sourcePosition =
      sourceHandle.id === 'section-left'
        ? isInsideSection(targetNode, sourceNode) || sourcePointerInside
          ? Position.Right
          : Position.Left
        : sourceHandle.id === 'section-right'
          ? isInsideSection(targetNode, sourceNode) || sourcePointerInside
            ? Position.Left
            : Position.Right
          : sourceHandle.position
    const targetPosition =
      targetBounds?.id === 'section-right'
        ? isInsideSection(sourceNode, targetNode)
          ? Position.Left
          : Position.Right
        : targetBounds?.id === 'section-left'
          ? isInsideSection(sourceNode, targetNode)
            ? Position.Right
            : Position.Left
          : targetBounds?.position ?? getOppositePosition(sourcePosition)

    return resolveEdgeGeometry({
      sourceNode,
      targetNode,
      sourceHandleId: sourceHandle.id,
      targetHandleId: targetBounds?.id,
      type: sourceHandle.id?.startsWith('section-') || targetBounds?.id?.startsWith('section-')
        ? 'section-through'
        : 'step',
      sourceX: portEndpointX(
        sourcePoint.x,
        sourceHandle.id,
        sourceNode,
        targetNode,
        sourcePointerInside
      ),
      sourceY: sourcePoint.y,
      sourcePosition,
      targetX: portEndpointX(
        targetPoint.x,
        targetBounds?.id,
        targetNode,
        sourceNode
      ),
      targetY: targetPoint.y,
      targetPosition,
      pathOptions: { borderRadius: 0, offset: 8 }
    })
  }

  const getEdgeUpdatePreviewGeometry = () : {
    geometry: ResolvedEdgeGeometry
    valid: boolean
  } | null => {
    const drag = options.getEdgeUpdateDrag()

    if (!drag) {
      return null
    }

    const edge = options.getCachedGraphEdges().find((candidate) => candidate.id === drag.edgeId)

    if (!edge) {
      return null
    }

    const sourceHandle = getRelevantHandle(edge.sourceNode, 'source', edge.sourceHandle)
    const targetHandle = getRelevantHandle(edge.targetNode, 'target', edge.targetHandle)

    if (!sourceHandle || !targetHandle) {
      return null
    }

    const sourcePoint = drag.endpoint === 'source' && drag.candidate
      ? drag.candidate.point
      : drag.endpoint === 'source'
        ? drag.pointerGraph
        : getHandleAnchor(edge.sourceNode, sourceHandle)
    const targetPoint = drag.endpoint === 'target' && drag.candidate
      ? drag.candidate.point
      : drag.endpoint === 'target'
        ? drag.pointerGraph
        : getHandleAnchor(edge.targetNode, targetHandle)
    const sourceNode = drag.endpoint === 'source'
      ? drag.candidate?.node ?? null
      : edge.sourceNode
    const targetNode = drag.endpoint === 'target'
      ? drag.candidate?.node ?? null
      : edge.targetNode
    const sourcePosition = drag.endpoint === 'source'
      ? drag.candidate?.handle.position ?? getOppositePosition(targetHandle.position)
      : sourceHandle.position
    const targetPosition = drag.endpoint === 'target'
      ? drag.candidate?.handle.position ?? getOppositePosition(sourceHandle.position)
      : targetHandle.position
    const connectionType = drag.candidate?.valid
      ? getEdgeRenderType(drag.candidate.connection, createGraphCache(services.getCurrentSyncNodes()))
      : edge.type

    return {
      valid: Boolean(drag.candidate?.valid),
      geometry: resolveEdgeGeometry({
        type: connectionType,
        sourceNode,
        targetNode,
        sourceHandleId: drag.endpoint === 'source'
          ? drag.candidate?.handle.id
          : edge.sourceHandle,
        targetHandleId: drag.endpoint === 'target'
          ? drag.candidate?.handle.id
          : edge.targetHandle,
        sourceX: sourcePoint.x,
        sourceY: sourcePoint.y,
        sourcePosition,
        targetX: targetPoint.x,
        targetY: targetPoint.y,
        targetPosition,
        pathOptions: { borderRadius: 0, offset: 8 }
      })
    }
  }

  const drawPreviewCanvas = () => {
    previewFrame = undefined

    const canvas = previewCanvasElement
    const context = canvas?.getContext('2d')

    if (!canvas || !context) {
      return
    }

    const { left, top, renderScale } = syncPreviewCanvas(canvas)
    const edgeUpdatePreview = getEdgeUpdatePreviewGeometry()
    const connectionPreview = edgeUpdatePreview ? null : getConnectionPreviewGeometry()
    const geometry = edgeUpdatePreview?.geometry ?? connectionPreview
    const connectionPreviewState = options.getConnectionPreview()
    const connectionPreviewInvalid =
      Boolean(connectionPreview) && connectionPreviewState?.status === 'invalid'

    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, canvas.width, canvas.height)

    if (!geometry) {
      return
    }

    context.setTransform(
      renderScale,
      0,
      0,
      renderScale,
      -left * renderScale,
      -top * renderScale
    )
    context.lineCap = 'round'
    context.lineJoin = 'round'
    drawEdgeRender(
      context,
      geometry,
      new Path2D(geometry.path),
      (edgeUpdatePreview && !edgeUpdatePreview.valid) || connectionPreviewInvalid
        ? invalidPreviewStyle
        : connectionPreviewStyle,
      MarkerType.ArrowClosed
    )
  }

  const setCanvasElement = (canvas: HTMLCanvasElement | null) => {
    previewCanvasElement = canvas

    if (previewCanvasElement) {
      scheduleDraw()
    }
  }

  const cleanup = () => {
    if (previewFrame) {
      window.cancelAnimationFrame(previewFrame)
      previewFrame = undefined
    }

    previewCanvasElement = null
    previewDrawWindow = null
  }

  return {
    cleanup,
    scheduleDraw,
    setCanvasElement
  }
}
