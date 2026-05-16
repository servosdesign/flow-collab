import { computed } from "vue";

export function useStableResizerStyle(getViewportZoom: () => number | undefined) {
  return computed<Record<string, string>>(() => {
    const viewportZoom = getViewportZoom() ?? 1;
    const zoom = Number.isFinite(viewportZoom) && viewportZoom > 0 ? viewportZoom : 1;
    const inverseZoom = zoom > 1 ? 1 / zoom : 1;
    const lineWidth = Math.max(inverseZoom, 0.5);

    return {
      "--node-resizer-handle-size": `${9 * inverseZoom}px`,
      "--node-resizer-handle-border-width": `${lineWidth}px`,
      "--node-resizer-line-width": `${lineWidth}px`
    };
  });
}
