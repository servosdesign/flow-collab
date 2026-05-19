import { useGraphState } from '../domain/graph/useGraphState'
import { useViewport } from '../features/canvas/useViewport'
import { useContextMenu } from '../features/context-menu/useContextMenu'
import { useCanvasEdges } from '../features/edges/useCanvasEdges'
import { useConnections } from '../features/edges/useConnections'
import { useNodeActions } from '../features/nodes/useNodeActions'
import { useResize } from '../features/nodes/useResize'
import { usePresence } from '../features/presence/usePresence'
import { useRealtimeSync } from '../features/realtime/useRealtimeSync'
import { useSelection } from '../features/selection/useSelection'
import { createEditorRuntime } from './createEditorRuntime'
import { useEditorLifecycle } from './useEditorLifecycle'
import { useEditorViewModels } from './useEditorViewModels'
import { wireEditorServices } from './wireEditorServices'

export const useFlowEditor = () => {
  const { runtime, services, state } = createEditorRuntime()

  const graphState = useGraphState(runtime)
  wireEditorServices(services, { graphState })

  const viewport = useViewport(runtime)
  wireEditorServices(services, { viewport })

  const realtime = useRealtimeSync(runtime, services)
  wireEditorServices(services, { realtime })

  const resize = useResize(runtime, services)
  const nodeActions = useNodeActions(runtime, services)
  wireEditorServices(services, { nodeActions })

  const selection = useSelection(runtime, services)
  wireEditorServices(services, { selection })

  const contextMenu = useContextMenu(runtime, services)
  wireEditorServices(services, { contextMenu })

  const presence = usePresence(runtime, services)
  wireEditorServices(services, { presence })

  const connections = useConnections(runtime, services)
  const canvasEdges = useCanvasEdges(runtime, services, {
    createEdgeConnection: connections.handleConnect,
    openEdgeContextMenuById: contextMenu.openEdgeContextMenuById,
    selectOnlyEdge: selection.commands.selectOnlyEdge,
    updateEdgeConnectionById: connections.updateEdgeConnectionById
  })

  useEditorLifecycle({
    nodeActions,
    presence,
    realtime,
    resize,
    selection,
    state,
    viewport
  })

  return useEditorViewModels({
    contextMenu,
    canvasEdges,
    nodeActions,
    presence,
    realtime,
    resize,
    selection,
    state,
    viewport
  })
}
