import { useEffect } from "react";

export function documentScale(zoom: string, fitWidth: number, fitPage: number): number {
  if (zoom === "auto" || zoom === "width") return fitWidth;
  if (zoom === "page") return Math.min(fitWidth, fitPage);
  const percentage = Number(zoom) / 100;
  // Fit scales can exceed the toolbar's 25–250% presets. Freezing the current
  // scale for native browser zoom must preserve its exact displayed size.
  return Number.isFinite(percentage) && percentage > 0 ? percentage : fitWidth;
}

/** Let native browser zoom enlarge the page without fit-width cancelling it. */
export function useBrowserZoom(zoom: string, scale: number, setZoom: (zoom: string) => void) {
  useEffect(() => {
    const freezeFit = () => {
      if (["auto", "width", "page"].includes(zoom) && Number.isFinite(scale) && scale > 0) {
        setZoom(String(Number((scale * 100).toFixed(6))));
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.isComposing) return;
      if (event.key === "0") setZoom("auto");
      else if (["+", "=", "-", "_"].includes(event.key) || ["NumpadAdd", "NumpadSubtract"].includes(event.code)) freezeFit();
    };
    const onWheel = (event: WheelEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.deltaY !== 0) freezeFit();
    };
    // Capture the scale before the browser resizes the CSS viewport. Leave
    // default behavior intact so browser controls and document zoom together.
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("wheel", onWheel, true);
    };
  }, [zoom, scale, setZoom]);
}
