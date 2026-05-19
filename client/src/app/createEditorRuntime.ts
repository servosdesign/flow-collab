import { useVueFlow } from '@vue-flow/core'
import { createFlowAppState } from '../flowState'
import type { FlowRuntime } from '../flowRuntime'
import { createFlowEditorServices } from './flowEditorServices'

export const createEditorRuntime = () => {
  const state = createFlowAppState()
  const vueFlow = useVueFlow()
  const { addEdges, fitView, screenToFlowCoordinate, setViewport, toObject } = vueFlow
  const runtime: FlowRuntime = {
    ...vueFlow,
    ...state,
    addEdges,
    fitView,
    screenToFlowCoordinate,
    setViewport,
    toObject
  }

  return {
    runtime,
    services: createFlowEditorServices(),
    state
  }
}
