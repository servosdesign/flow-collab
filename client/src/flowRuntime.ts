import type { useVueFlow } from '@vue-flow/core'
import type { FlowAppState } from './flowTypes'

export type VueFlowRuntime = ReturnType<typeof useVueFlow>

export type FlowRuntime = FlowAppState &
  Omit<VueFlowRuntime, keyof FlowAppState>
