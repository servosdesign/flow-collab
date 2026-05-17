import type { useVueFlow } from '@vue-flow/core'
import type { Component } from 'vue'
import type { FlowAppState } from './flowTypes'

export type VueFlowRuntime = ReturnType<typeof useVueFlow>

export type FlowRuntime = FlowAppState &
  Omit<VueFlowRuntime, keyof FlowAppState | 'edgeTypes'> & {
    edgeTypes: Record<string, Component>
  }
