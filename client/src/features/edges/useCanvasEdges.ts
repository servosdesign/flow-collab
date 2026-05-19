import { nextTick, onBeforeUnmount, watch } from 'vue'
import type { FlowEditorServices } from '../../app/flowEditorServices'
import type { FlowRuntime } from '../../flowRuntime'
import type { CanvasEdgeDependencies } from './canvas/types'
import { createCanvasEdgeInteractions } from './canvas/useCanvasEdgeInteractions'
import { createCanvasHandleConnections } from './canvas/useCanvasHandleConnections'
import { createCanvasEdgePreview } from './canvas/useCanvasEdgePreview'
import { createCanvasEdgeRenderer } from './canvas/useCanvasEdgeRenderer'

export const useCanvasEdges = (
  runtime: FlowRuntime,
  services: FlowEditorServices,
  dependencies: CanvasEdgeDependencies
) => {
  const previewRef: { current?: ReturnType<typeof createCanvasEdgePreview> } = {}
  const interactionsRef: { current?: ReturnType<typeof createCanvasEdgeInteractions> } = {}
  const handleConnectionsRef: {
    current?: ReturnType<typeof createCanvasHandleConnections>
  } = {}

  const renderer = createCanvasEdgeRenderer(runtime, {
    schedulePreviewDraw: () => previewRef.current?.scheduleDraw()
  })

  const preview = createCanvasEdgePreview(runtime, services, {
    getCachedGraphEdges: renderer.getCachedGraphEdges,
    getConnectionPreview: () => handleConnectionsRef.current?.getConnectionPreview() ?? null,
    getEdgeUpdateDrag: () => interactionsRef.current?.getEdgeUpdateDrag() ?? null
  })
  previewRef.current = preview
  const handleConnections = createCanvasHandleConnections(
    runtime,
    services,
    dependencies,
    preview
  )
  handleConnectionsRef.current = handleConnections

  const interactions = createCanvasEdgeInteractions(
    runtime,
    services,
    dependencies,
    renderer,
    preview,
    handleConnections
  )
  interactionsRef.current = interactions

  const cleanupCanvasEdges = () => {
    handleConnections.cleanup()
    interactions.cleanup()
    renderer.cleanup()
    preview.cleanup()
  }

  watch(
    () => [
      runtime.viewport.value.x,
      runtime.viewport.value.y,
      runtime.viewport.value.zoom,
      runtime.dimensions.value.width,
      runtime.dimensions.value.height
    ],
    () => {
      if (renderer.needsCanvasDrawWindowRefresh()) {
        renderer.scheduleDraw()
      }
      preview.scheduleDraw()
    },
    { flush: 'post', immediate: true }
  )

  watch(runtime.edges, renderer.markEdgesDirty, { deep: true, flush: 'post' })
  watch(runtime.getNodes, renderer.markGeometryDirty, { deep: true, flush: 'post' })
  watch(runtime.selectionMoveHiddenEdgeIds, renderer.markGeometryDirty, { flush: 'post' })
  watch(runtime.selectionMovePreviewVersion, renderer.scheduleDraw, { flush: 'post' })

  nextTick(() => {
    renderer.scheduleDraw()
    preview.scheduleDraw()
  })

  onBeforeUnmount(cleanupCanvasEdges)

  return {
    accessibility: interactions.accessibility,
    elements: {
      setMainCanvas: renderer.setCanvasElement,
      setPreviewCanvas: preview.setCanvasElement
    },
    events: interactions.events,
    lifecycle: {
      cleanup: cleanupCanvasEdges
    }
  }
}
