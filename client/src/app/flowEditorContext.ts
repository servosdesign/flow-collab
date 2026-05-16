import { inject, provide, type InjectionKey } from "vue";
import type { useFlowEditor } from "./useFlowEditor";

type FlowEditorViewModels = ReturnType<typeof useFlowEditor>;

export type CanvasContext = FlowEditorViewModels["canvas"];
export type CanvasOverlayContext = FlowEditorViewModels["canvasOverlay"];
export type ContextMenuContext = FlowEditorViewModels["contextMenu"];
export type NodeRendererContext = FlowEditorViewModels["nodeRenderer"];
export type PresenceCursorContext = FlowEditorViewModels["presenceCursors"];
export type SelectionOverlayContext = FlowEditorViewModels["selectionOverlay"];
export type ShellContext = FlowEditorViewModels["shell"];
export type TopBarContext = FlowEditorViewModels["topbar"];

const canvasKey: InjectionKey<CanvasContext> = Symbol("CanvasContext");
const canvasOverlayKey: InjectionKey<CanvasOverlayContext> = Symbol("CanvasOverlayContext");
const contextMenuKey: InjectionKey<ContextMenuContext> = Symbol("ContextMenuContext");
const nodeRendererKey: InjectionKey<NodeRendererContext> = Symbol("NodeRendererContext");
const presenceCursorKey: InjectionKey<PresenceCursorContext> = Symbol("PresenceCursorContext");
const selectionOverlayKey: InjectionKey<SelectionOverlayContext> = Symbol("SelectionOverlayContext");
const shellKey: InjectionKey<ShellContext> = Symbol("ShellContext");
const topBarKey: InjectionKey<TopBarContext> = Symbol("TopBarContext");

function useRequiredContext<T>(key: InjectionKey<T>, name: string) {
  const context = inject(key);

  if (!context) {
    throw new Error(`${name} is not available.`);
  }

  return context;
}

export function provideFlowEditorContexts(editor: FlowEditorViewModels) {
  provide(canvasKey, editor.canvas);
  provide(canvasOverlayKey, editor.canvasOverlay);
  provide(contextMenuKey, editor.contextMenu);
  provide(nodeRendererKey, editor.nodeRenderer);
  provide(presenceCursorKey, editor.presenceCursors);
  provide(selectionOverlayKey, editor.selectionOverlay);
  provide(shellKey, editor.shell);
  provide(topBarKey, editor.topbar);
}

export function useCanvasContext() {
  return useRequiredContext(canvasKey, "Canvas context");
}

export function useCanvasOverlayContext() {
  return useRequiredContext(canvasOverlayKey, "Canvas overlay context");
}

export function useContextMenuContext() {
  return useRequiredContext(contextMenuKey, "Context menu context");
}

export function useNodeRendererContext() {
  return useRequiredContext(nodeRendererKey, "Node renderer context");
}

export function usePresenceCursorContext() {
  return useRequiredContext(presenceCursorKey, "Presence cursor context");
}

export function useSelectionOverlayContext() {
  return useRequiredContext(selectionOverlayKey, "Selection overlay context");
}

export function useShellContext() {
  return useRequiredContext(shellKey, "Shell context");
}

export function useTopBarContext() {
  return useRequiredContext(topBarKey, "Top bar context");
}
