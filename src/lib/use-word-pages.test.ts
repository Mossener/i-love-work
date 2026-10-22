import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoverDocument } from "./cover-document";
import type { DocumentBlock, DocumentPage } from "./pagination";
import { useWordPages } from "./use-word-pages";

const { paginate } = vi.hoisted(() => ({ paginate: vi.fn() }));
vi.mock("./pagination", async (original) => ({
  ...await original<typeof import("./pagination")>(),
  paginateBlocks: paginate,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function word(html = '<p>Before <img src="data:image/png;base64,aGVsbG8="> after.</p><p>Next passage.</p>'): CoverDocument {
  return { kind: "docx", filename: "study.docx", blocks: [{ html, chapterIndex: 0 }] };
}

function pages(blocks: DocumentBlock[]): DocumentPage[] {
  return blocks.map(block => ({ ...block, chapterIndices: [block.chapterIndex] }));
}

let root: Root;
let container: HTMLDivElement;
let current!: ReturnType<typeof useWordPages>;
let rendered: ReturnType<typeof useWordPages>[];
const notify = vi.fn();

async function render(document: CoverDocument | null, images: boolean) {
  function Harness({ document, images }: { document: CoverDocument | null; images: boolean }) {
    current = useWordPages(document, images, notify);
    rendered.push(current);
    return null;
  }
  // Keep the component identity stable across updates.
  harness ??= Harness;
  await act(async () => root.render(createElement(harness!, { document, images })));
}
let harness: ((props: { document: CoverDocument | null; images: boolean }) => null) | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  paginate.mockImplementation(async (blocks: DocumentBlock[]) => pages(blocks));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  rendered = [];
  harness = undefined;
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Word image presentation", () => {
  it("removes embedded Word images and restores them without changing source prose anchors", async () => {
    const source = word();
    const original = JSON.stringify(source);
    await render(source, true);
    const shown = document.createElement("div");
    shown.innerHTML = current.pages.map(page => page.html).join("");
    const identity = shown.querySelector("p")?.getAttribute("data-reading-anchor");
    expect(shown.querySelector("img")).not.toBeNull();
    expect(identity).toBeTruthy();

    await render(source, false);
    const hidden = document.createElement("div");
    hidden.innerHTML = current.pages.map(page => page.html).join("");
    expect(hidden.querySelector("img,svg,figure")).toBeNull();
    expect(hidden.textContent).toBe("Before  after.Next passage.");
    expect(hidden.querySelector("p")?.getAttribute("data-reading-anchor")).toBe(identity);
    expect(current.ready).toBe(true);
    expect(current.paginating).toBe(false);

    await render(source, true);
    expect(current.pages.map(page => page.html).join("")).toContain("<img");
    expect(JSON.stringify(source)).toBe(original);
  });

  it("keeps old same-document pages visible while the requested image layout is pending", async () => {
    const source = word();
    await render(source, true);
    const previous = current.pages;
    const next = deferred<DocumentPage[]>();
    paginate.mockReturnValueOnce(next.promise);
    const renderStart = rendered.length;
    await render(source, false);
    expect(rendered[renderStart].paginating).toBe(true);
    expect(current.paginating).toBe(true);
    expect(current.pages).toBe(previous);
    expect(current.ready).toBe(true);

    await act(async () => next.resolve([{ html: "<p>Hidden layout</p>", chapterIndex: 0, chapterIndices: [0] }]));
    expect(current.pages[0].html).toBe("<p>Hidden layout</p>");
    expect(current.paginating).toBe(false);
  });

  it("ignores late layout results after the user switches document or image setting", async () => {
    const first = deferred<DocumentPage[]>();
    const second = deferred<DocumentPage[]>();
    paginate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const source = word();
    await render(source, true);
    const firstSignal = paginate.mock.calls[0][1].signal as AbortSignal;
    await render(source, false);
    expect(firstSignal.aborted).toBe(true);
    await act(async () => second.resolve([{ html: "<p>Latest layout</p>", chapterIndex: 0, chapterIndices: [0] }]));
    await act(async () => first.resolve([{ html: "<img src='stale'>", chapterIndex: 0, chapterIndices: [0] }]));
    expect(current.pages[0].html).toBe("<p>Latest layout</p>");

    const replacement = word("<p>A different source</p>");
    const replacementWait = deferred<DocumentPage[]>();
    paginate.mockReturnValueOnce(replacementWait.promise);
    const replacementStart = rendered.length;
    await render(replacement, false);
    expect(rendered[replacementStart]).toEqual({ pages: [], ready: false, paginating: true });
    expect(current.pages).toEqual([]);
    expect(current.ready).toBe(false);
    expect(current.paginating).toBe(true);
    await render(null, false);
    await act(async () => replacementWait.resolve([{ html: "<p>Abandoned source</p>", chapterIndex: 0, chapterIndices: [0] }]));
    expect(current).toEqual({ pages: [], ready: false, paginating: false });
  });

  it("provides a recoverable page when hiding pictures leaves an image-only document empty", async () => {
    paginate.mockResolvedValueOnce([]);
    await render(word('<p><img src="data:image/png;base64,aGVsbG8="></p>'), false);
    expect(current.ready).toBe(true);
    expect(current.paginating).toBe(false);
    expect(current.pages).toHaveLength(1);
    const output = document.createElement("div");
    output.innerHTML = current.pages[0].html;
    expect(output.textContent).toContain("图片已隐藏");
    expect(output.querySelector("img")).toBeNull();
  });

  it("ends a failed reflow while retaining the last successful same-source pages", async () => {
    const source = word();
    await render(source, true);
    const previous = current.pages;
    paginate.mockRejectedValueOnce(new Error("Layout failed"));
    await render(source, false);
    expect(current.pages).toBe(previous);
    expect(current.ready).toBe(true);
    expect(current.paginating).toBe(false);
    expect(notify).toHaveBeenCalledWith("Layout failed");
    const calls = paginate.mock.calls.length;
    await render(source, false);
    expect(paginate.mock.calls.length).toBe(calls);
  });

  it("does not reflow PDF documents and aborts pending Word work on unmount", async () => {
    const source = word();
    const pending = deferred<DocumentPage[]>();
    paginate.mockReturnValueOnce(pending.promise);
    await render(source, true);
    const signal = paginate.mock.calls[0][1].signal as AbortSignal;
    await act(async () => root.unmount());
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve([]));
    root = createRoot(container);
    await render({ kind: "pdf", filename: "paper.pdf", pdf: {} } as CoverDocument, false);
    expect(current).toEqual({ pages: [], ready: false, paginating: false });
    expect(paginate).toHaveBeenCalledTimes(1);
  });
});
