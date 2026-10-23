import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentScale, useBrowserZoom } from "./use-browser-zoom";

let root: Root;
let container: HTMLDivElement;
const setZoom = vi.fn();
function Listener({ zoom = "auto", scale = 0.775819 }: { zoom?: string; scale?: number }) {
  useBrowserZoom(zoom, scale, setZoom);
  return null;
}
function FittedDocument({ fitWidth }: { fitWidth: number }) {
  const [zoom, changeZoom] = useState("auto");
  const scale = documentScale(zoom, fitWidth, fitWidth);
  useBrowserZoom(zoom, scale, changeZoom);
  return <output>{scale}</output>;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  setZoom.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("native browser zoom", () => {
  it.each([3.2, 0.2])("preserves a fitted scale of %s outside the toolbar percentage range", async scale => {
    await act(async () => root.render(<FittedDocument fitWidth={scale} />));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "+", ctrlKey: true }));
    });
    expect(Number(container.textContent)).toBeCloseTo(scale, 6);
    // Browser zoom then reduces CSS viewport width; the document must stay fixed.
    await act(async () => root.render(<FittedDocument fitWidth={scale / 1.1} />));
    expect(Number(container.textContent)).toBeCloseTo(scale, 6);
  });

  it("does not reset fit for Ctrl+Insert on a numpad with NumLock off", async () => {
    await act(async () => root.render(<Listener zoom="125" />));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Insert", code: "Numpad0", ctrlKey: true }));
    expect(setZoom).not.toHaveBeenCalled();
  });

  it.each(["auto", "width", "page"])("keeps the displayed page scale when Ctrl+plus leaves %s fitting", async zoom => {
    await act(async () => root.render(<Listener zoom={zoom} />));
    const event = new KeyboardEvent("keydown", { key: "+", code: "Equal", ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(setZoom).toHaveBeenCalledOnce();
    expect(Number(setZoom.mock.calls[0][0]) / 100).toBeCloseTo(0.775819, 6);
    expect(event.defaultPrevented).toBe(false);
  });

  it("permits Ctrl+wheel native zoom without the next fit-width update cancelling it", async () => {
    await act(async () => root.render(<Listener />));
    const event = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    const fixed = setZoom.mock.calls[0][0];
    // A native zoom-in reduces CSS viewport width and therefore the fit scale.
    await act(async () => root.render(<Listener zoom={fixed} scale={0.64} />));
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, ctrlKey: true }));
    expect(setZoom).toHaveBeenCalledOnce();
    expect(Number(fixed)).toBeCloseTo(77.5819, 4);
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves explicit percentages and ordinary typing or scrolling unchanged", async () => {
    await act(async () => root.render(<Listener zoom="125" />));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "-", ctrlKey: true }));
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, ctrlKey: true }));
    expect(setZoom).not.toHaveBeenCalled();
    await act(async () => root.render(<Listener />));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "+" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "d", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "+", ctrlKey: true, altKey: true }));
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }));
    expect(setZoom).not.toHaveBeenCalled();
  });

  it("supports minus and Command shortcuts, and resets fitting with Ctrl+0", async () => {
    await act(async () => root.render(<Listener zoom="page" />));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "-", metaKey: true }));
    expect(setZoom).toHaveBeenCalledOnce();
    const event = new KeyboardEvent("keydown", { key: "0", ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(setZoom).toHaveBeenLastCalledWith("auto");
    expect(event.defaultPrevented).toBe(false);
  });

  it("removes its global listeners on unmount", async () => {
    await act(async () => root.render(<Listener />));
    await act(async () => root.render(null));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "+", ctrlKey: true }));
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, ctrlKey: true }));
    expect(setZoom).not.toHaveBeenCalled();
  });
});
