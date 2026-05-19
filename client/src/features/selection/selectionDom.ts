import type { FlowRuntime } from '../../flowRuntime'

export const escapeCssAttributeValue = (value: string) => value
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/\n/g, '\\a ')
  .replace(/\r/g, '\\d ')

export const getNodeElementById = (runtime: FlowRuntime, nodeId: string) => {
  const selector = `.vue-flow__node[data-id="${escapeCssAttributeValue(nodeId)}"]`

  return runtime.canvasPanel.value?.querySelector<HTMLElement>(selector) ?? null
}

export const getNodeElementFromTarget = (target: EventTarget | null) => {
  return target instanceof Element
    ? target.closest<HTMLElement>('.vue-flow__node[data-id]')
    : null
}

export const getSelectionOutlineElement = (
  runtime: FlowRuntime,
  event: PointerEvent,
  target: HTMLElement | null
) => {
  return (
    (event.target instanceof Element
      ? event.target.closest<HTMLElement>('.selected-nodes-outline')
      : null) ??
    target?.closest<HTMLElement>('.selected-nodes-outline') ??
    runtime.canvasPanel.value?.querySelector<HTMLElement>('.selected-nodes-outline') ??
    null
  )
}
