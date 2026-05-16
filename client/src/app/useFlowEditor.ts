import { useGraphState } from "../domain/graph/useGraphState";
import { useViewport } from "../features/canvas/useViewport";
import { useContextMenu } from "../features/context-menu/useContextMenu";
import { useConnections } from "../features/edges/useConnections";
import { useNodeActions } from "../features/nodes/useNodeActions";
import { useResize } from "../features/nodes/useResize";
import { usePresence } from "../features/presence/usePresence";
import { useRealtimeSync } from "../features/realtime/useRealtimeSync";
import { useSelection } from "../features/selection/useSelection";
import { createEditorRuntime } from "./createEditorRuntime";
import { useEditorLifecycle } from "./useEditorLifecycle";
import { useEditorViewModels } from "./useEditorViewModels";
import { wireEditorServices } from "./wireEditorServices";

export function useFlowEditor() {
  const { edgeTypes, runtime, services, state } = createEditorRuntime();

  const graphState = useGraphState(runtime);
  wireEditorServices(services, { graphState });

  const viewport = useViewport(runtime);
  wireEditorServices(services, { viewport });

  const realtime = useRealtimeSync(runtime, services);
  wireEditorServices(services, { realtime });

  const resize = useResize(runtime, services);
  const nodeActions = useNodeActions(runtime, services);
  wireEditorServices(services, { nodeActions });

  const selection = useSelection(runtime, services);
  wireEditorServices(services, { selection });

  const contextMenu = useContextMenu(runtime, services);
  wireEditorServices(services, { contextMenu });

  const presence = usePresence(runtime, services);
  wireEditorServices(services, { presence });

  const connections = useConnections(runtime, services);

  useEditorLifecycle({
    nodeActions,
    presence,
    realtime,
    resize,
    selection,
    state,
    viewport
  });

  return useEditorViewModels({
    connections,
    contextMenu,
    edgeTypes,
    graphState,
    nodeActions,
    presence,
    realtime,
    resize,
    selection,
    state,
    viewport
  });
}
