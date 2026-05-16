import type { useVueFlow } from "@vue-flow/core";
import type { Component } from "vue";
import type { FlowAppState } from "./flowTypes";

export type VueFlowRuntime = ReturnType<typeof useVueFlow>;

export type FlowRuntime = FlowAppState &
  Omit<VueFlowRuntime, keyof FlowAppState | "edgeTypes"> & {
    edgeTypes: Record<string, Component>;
    actions: Record<string, unknown>;
  };

export function installActions<T extends Record<string, unknown>>(
  runtime: FlowRuntime,
  actions: T
) {
  Object.assign(runtime.actions, actions);

  return actions;
}
