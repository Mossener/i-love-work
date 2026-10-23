import type { PDFDocumentProxy } from "pdfjs-dist";
import { describe, expect, it, vi } from "vitest";
import { PAGE_HEIGHT, PAGE_WIDTH } from "./pagination";
import { loadPdfOutline, loadPdfPageLinks, resolvePdfDestination, searchPdfDocument, searchPdfPage } from "./pdf-navigation";

function text(str: string, x = 20, y = 700, width = str.length * 6, hasEOL = false) {
  return { str, transform: [12, 0, 0, 12, x, y], width, height: 12, dir: "ltr", fontName: "font", hasEOL };
}

function fakePdf({ outline = [], annotations = [], texts = [[text("A searchable paper")]], pages = texts.length }: { outline?: unknown[]; annotations?: unknown[]; texts?: unknown[][]; pages?: number } = {}) {
  const content = texts.map(items => vi.fn(async () => ({ items, styles: {} })));
  const viewport = {
    width: 600, height: 800,
    convertToViewportPoint: (x: number, y: number) => [x, 800 - y],
    convertToViewportRectangle: ([x1, y1, x2, y2]: number[]) => [x1, 800 - y1, x2, 800 - y2],
  };
  const pdf = {
    numPages: pages,
    getOutline: vi.fn(async () => outline),
    getDestination: vi.fn(async (id: string) => id === "methods" ? [{ num: 12, gen: 0 }, { name: "XYZ" }, 0, 600, null] : null),
    getPageIndex: vi.fn(async (ref: { num: number }) => ref.num === 12 ? 1 : -1),
    getPage: vi.fn(async (index: number) => ({
      getViewport: () => viewport,
      getAnnotations: async () => annotations,
      getTextContent: content[index - 1] ?? (async () => ({ items: [], styles: {} })),
    })),
  };
  return { pdf: pdf as unknown as PDFDocumentProxy, content, raw: pdf };
}

describe("PDF cover navigation", () => {
  it("loads the actual PDF outline, resolves named destinations and preserves nested titles", async () => {
    const { pdf } = fakePdf({ pages: 3, outline: [
      { title: "Introduction", dest: [0, { name: "Fit" }], items: [] },
      { title: "Part II", dest: null, items: [{ title: "Methods", dest: "methods", items: [] }] },
      { title: "Broken link", dest: "missing", items: [] },
    ] });
    const result = await loadPdfOutline(pdf);
    expect(result.map(({ title, page, depth }) => ({ title, page, depth }))).toEqual([
      { title: "Introduction", page: 0, depth: 0 },
      { title: "Part II", page: 1, depth: 0 },
      { title: "Methods", page: 1, depth: 1 },
    ]);
  });

  it("maps an XYZ destination into the centered PDF sheet instead of always jumping to the page top", async () => {
    const { pdf } = fakePdf({ pages: 3 });
    const result = await resolvePdfDestination(pdf, "methods");
    const fit = Math.min(PAGE_WIDTH / 600, PAGE_HEIGHT / 800);
    expect(result?.page).toBe(1);
    expect(result?.top).toBeCloseTo(((PAGE_HEIGHT - 800 * fit) / 2 + 200 * fit) / PAGE_HEIGHT);
  });

  it("rejects malformed or out-of-range destinations without breaking valid page links", async () => {
    const { pdf } = fakePdf({ pages: 3 });
    expect(await resolvePdfDestination(pdf, "missing")).toBeNull();
    expect(await resolvePdfDestination(pdf, [9, { name: "Fit" }])).toBeNull();
    expect(await resolvePdfDestination(pdf, [-1, { name: "Fit" }])).toBeNull();
    expect(await resolvePdfDestination(pdf, [2, { name: "Fit" }])).toEqual({ page: 2 });
  });

  it("restores clickable PDF annotations with safe external URLs and real internal targets", async () => {
    const { pdf } = fakePdf({ pages: 3, annotations: [
      { id: "internal", subtype: "Link", rect: [10, 700, 100, 720], dest: "methods" },
      { id: "external", subtype: "Link", rect: [10, 660, 100, 680], url: "https://example.org/paper" },
      { id: "unsafe", subtype: "Link", rect: [10, 600, 100, 620], url: "javascript:alert(1)" },
      { id: "attachment", subtype: "FileAttachment", rect: [10, 500, 100, 520], url: "https://example.org/attachment" },
    ] });
    const links = await loadPdfPageLinks(pdf, 0);
    expect(links.map(link => link.id)).toEqual(["internal", "external"]);
    expect(links[0].destination?.page).toBe(1);
    expect(links[0].rect.width).toBeGreaterThan(0);
    expect(links[1].href).toBe("https://example.org/paper");
  });

  it("searches real PDF text, navigates all matches and reuses extraction between queries", async () => {
    const { pdf, content } = fakePdf({ texts: [
      [text("Paper and paper")],
      [text("A second PAPER")],
    ] });
    const matches = await searchPdfDocument(pdf, "paper");
    expect(matches.map(({ page, occurrence }) => ({ page, occurrence }))).toEqual([
      { page: 0, occurrence: 0 }, { page: 0, occurrence: 1 }, { page: 1, occurrence: 0 },
    ]);
    expect(matches[0].context).toContain("Paper");
    expect(matches[0].top).toBeGreaterThan(0);
    await searchPdfDocument(pdf, "second");
    expect(content.every(fn => fn.mock.calls.length === 1)).toBe(true);
  });

  it("finds text split across PDF font runs and preserves word gaps", async () => {
    const { pdf } = fakePdf({ texts: [[
      text("阅读", 20, 700, 24), text("器", 44, 700, 12),
      text("hello", 20, 670, 30), text("world", 56, 670, 30),
    ]] });
    expect(await searchPdfDocument(pdf, "阅读器")).toHaveLength(1);
    expect(await searchPdfDocument(pdf, "hello world")).toHaveLength(1);
    const pageMatches = await searchPdfPage(pdf, 0, "阅读器");
    expect(pageMatches[0].rects).toHaveLength(2);
  });

  it("does not search when empty or after cancellation", async () => {
    const { pdf, raw } = fakePdf();
    expect(await searchPdfDocument(pdf, "  ")).toEqual([]);
    expect(raw.getPage).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    await expect(searchPdfDocument(pdf, "paper", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
