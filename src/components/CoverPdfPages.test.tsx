import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfCanvasPage } from "./CoverPdfPages";

const { links, search } = vi.hoisted(() => ({ links: vi.fn(), search: vi.fn() }));
vi.mock("../lib/pdf-navigation", () => ({ loadPdfPageLinks: links, searchPdfPage: search }));

let root: Root;
let container: HTMLDivElement;
function fakePdf(render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))) {
  return {
    pdf: { numPages: 3, getPage: vi.fn(async () => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render,
    })) } as unknown as PDFDocumentProxy,
    render,
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  links.mockResolvedValue([]);
  search.mockResolvedValue([]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("original PDF page", () => {
  it("forces offscreen pages to finish rendering before reporting print readiness", async () => {
    let finish!: () => void;
    const promise = new Promise<void>(resolve => { finish = resolve; });
    const { pdf, render } = fakePdf(vi.fn(() => ({ promise, cancel: vi.fn() })));
    await act(async () => root.render(<PdfCanvasPage pdf={pdf} index={2} scale={1} />));
    expect(render).not.toHaveBeenCalled();
    expect(container.querySelector("article")?.getAttribute("data-print-ready")).toBe("false");
    await act(async () => root.render(<PdfCanvasPage pdf={pdf} index={2} scale={1} forceRender />));
    expect(render).toHaveBeenCalledOnce();
    expect(container.querySelector("article")?.getAttribute("data-print-ready")).toBe("false");
    await act(async () => finish());
    expect(container.querySelector("article")?.getAttribute("data-print-ready")).toBe("true");
  });

  it("preserves completed canvases when entering print mode instead of clearing them for another render", async () => {
    const { pdf, render } = fakePdf();
    await act(async () => root.render(<PdfCanvasPage pdf={pdf} index={0} scale={1} />));
    expect(container.querySelector("article")?.getAttribute("data-print-ready")).toBe("true");
    await act(async () => root.render(<PdfCanvasPage pdf={pdf} index={0} scale={1} forceRender />));
    expect(render).toHaveBeenCalledOnce();
    expect(container.querySelector("article")?.getAttribute("data-print-ready")).toBe("true");
  });

  it("rerenders the original zoom after an interrupted zoom has overwritten its canvas", async () => {
    let finishRestored!: () => void;
    const restored = new Promise<void>(resolve => { finishRestored = resolve; });
    const render = vi.fn()
      .mockImplementationOnce(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))
      .mockImplementationOnce(() => ({ promise: new Promise<void>(() => {}), cancel: vi.fn() }))
      .mockImplementationOnce(() => ({ promise: restored, cancel: vi.fn() }));
    const { pdf } = fakePdf(render);
    await act(async () => root.render(<PdfCanvasPage pdf={pdf} index={0} scale={1} />));
    const originalWidth = container.querySelector("canvas")!.width;
    expect(container.querySelector("article")?.getAttribute("data-print-ready")).toBe("true");

    await act(async () => root.render(<PdfCanvasPage pdf={pdf} index={0} scale={2} />));
    expect(container.querySelector("canvas")!.width).toBeGreaterThan(originalWidth);
    await act(async () => root.render(<PdfCanvasPage pdf={pdf} index={0} scale={1} />));
    expect(container.querySelector("canvas")!.width).toBe(originalWidth);
    expect(container.querySelector("article")?.getAttribute("data-print-ready")).toBe("false");

    await act(async () => finishRestored());
    expect(container.querySelector("article")?.getAttribute("data-print-ready")).toBe("true");
  });

  it("makes internal annotations clickable and shows the selected original PDF search match", async () => {
    const rect = { left: 20, top: 80, width: 120, height: 20 };
    links.mockResolvedValue([{ id: "note", label: "跳转到第 3 页", rect, destination: { page: 2, top: 0.4 } }]);
    search.mockResolvedValue([{ page: 0, occurrence: 0, rects: [rect] }]);
    const { pdf } = fakePdf();
    const onNavigate = vi.fn();
    await act(async () => root.render(<PdfCanvasPage pdf={pdf} index={0} scale={1} onNavigate={onNavigate} query="paper" activeMatch={0} />));
    await act(async () => container.querySelector<HTMLAnchorElement>("a")!.click());
    expect(onNavigate).toHaveBeenCalledWith({ page: 2, top: 0.4 });
    expect(container.querySelector("[data-search-match='0']")?.classList.contains("active")).toBe(true);
    await act(async () => root.render(<PdfCanvasPage pdf={pdf} index={0} scale={1} onNavigate={onNavigate} query="" />));
    expect(container.querySelector("[data-search-match]")).toBeNull();
  });
});
