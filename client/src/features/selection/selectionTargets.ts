export const nodeInteractiveSelector =
  'input, textarea, button, label, select, [contenteditable], [data-node-interactive]'

export const nodeMoveBlockedSelector =
  `${nodeInteractiveSelector}, .vue-flow__handle, .vue-flow__resize-control, .node-resizer-layer`

export const isNodeInteractiveTarget = (target: EventTarget | null) => {
  return target instanceof Element && Boolean(target.closest(nodeInteractiveSelector))
}

export const isNodeMoveBlockedTarget = (target: EventTarget | null) => {
  return target instanceof Element && Boolean(target.closest(nodeMoveBlockedSelector))
}

export const isCanvasSelectionTarget = (target: EventTarget | null) => {
  if (!(target instanceof Element)) {
    return false
  }

  return !target.closest(
    '.vue-flow__node, .vue-flow__edge, .flowchart-canvas-minimap, .vue-flow__resize-control, .selected-nodes-outline, .selected-bounds-hit, .context-menu, input, textarea, button, label'
  )
}

export const isSelectionOverlayTarget = (target: EventTarget | null) => {
  return target instanceof Element && Boolean(target.closest('.selected-nodes-outline'))
}
