import { useVueFlow } from '@vue-flow/core'
import { markRaw } from 'vue'
import SectionThroughEdge from '../features/edges/SectionThroughEdge.vue'
import { createFlowAppState } from '../flowState'
import type { FlowRuntime } from '../flowRuntime'
import { createFlowEditorServices } from './flowEditorServices'

export const createEditorRuntime = () => {
  const state = createFlowAppState()
  const vueFlow = useVueFlow()
  const { addEdges, fitView, screenToFlowCoordinate, setViewport, toObject } = vueFlow
  const edgeTypes = {
    'section-through': markRaw(SectionThroughEdge)
  }
  const runtime: FlowRuntime = {
    ...vueFlow,
    ...state,
    addEdges,
    fitView,
    screenToFlowCoordinate,
    setViewport,
    toObject,
    edgeTypes
  }

  return {
    edgeTypes,
    runtime,
    services: createFlowEditorServices(),
    state
  }
}
