import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoverDocument, CoverSource } from "./cover-document";
import { useCoverDocument } from "./use-cover-document";

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  release: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
  paginate: vi.fn(),
}));

vi.mock("./cover-document", () => ({
  parseCoverFile: mocks.parse,
  releaseCoverDocument: mocks.release,
}));
vi.mock("./cover-storage", () => ({
  loadCoverSource: mocks.load,
  saveCoverSource: mocks.save,
  clearCoverSource: mocks.clear,
}));
vi.mock("./pagination", () => ({ paginateBlocks: mocks.paginate }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function pdf(filename: string): CoverDocument {
  return { kind: "pdf", filename, pdf: {} } as CoverDocument;
}

function file(name: string) {
  return new File([`fixture ${name}`], name);
}

let root: Root | undefined;
let container: HTMLDivElement;
let current!: ReturnType<typeof useCoverDocument>;
const notify = vi.fn();

async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  function Harness() {
    current = useCoverDocument(notify);
    return null;
  }
  await act(async () => root!.render(createElement(Harness)));
}

async function unmount() {
  await act(async () => root?.unmount());
  root = undefined;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  mocks.load.mockResolvedValue(null);
  mocks.release.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue(undefined);
  mocks.clear.mockResolvedValue(undefined);
  mocks.paginate.mockResolvedValue([]);
});

afterEach(async () => {
  await unmount();
  container?.remove();
  vi.unstubAllGlobals();
});

describe("selected cover lifecycle", () => {
  it("paginates a selected Word document and persists its original file", async () => {
    const selected = file("study.docx");
    const document: CoverDocument = {
      kind: "docx",
      filename: selected.name,
      blocks: [{ html: "<p>Original study</p>", chapterIndex: 0 }],
    };
    const pages = [
      { html: "<p>Original study</p>", chapterIndex: 0, chapterIndices: [0] },
    ];
    mocks.parse.mockResolvedValue(document);
    mocks.paginate.mockResolvedValue(pages);
    await mount();
    await act(async () => current.importCover(selected));

    expect(current.cover).toEqual({
      document,
      pages,
      source: { name: selected.name, blob: selected },
    });
    expect(mocks.paginate).toHaveBeenCalledWith(document.blocks, {
      signal: expect.any(AbortSignal),
    });
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
      name: selected.name,
      blob: selected,
    });
    expect(current.loading).toBe(false);
  });

  it("retains the previous document if a replacement cannot be parsed", async () => {
    const previous = pdf("previous.pdf");
    mocks.parse
      .mockResolvedValueOnce(previous)
      .mockRejectedValueOnce(new Error("Invalid PDF"));
    await mount();
    await act(async () => current.importCover(file("previous.pdf")));
    await act(async () => current.importCover(file("broken.pdf")));

    expect(current.cover?.document).toBe(previous);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.release).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Invalid PDF");
    expect(current.loading).toBe(false);
  });

  it("restores a saved selection without rewriting storage", async () => {
    const saved = { name: "saved.pdf", blob: file("saved.pdf") };
    const restored = pdf(saved.name);
    mocks.load.mockResolvedValue(saved);
    mocks.parse.mockResolvedValue(restored);
    await mount();

    expect(current.cover?.document).toBe(restored);
    expect(mocks.parse).toHaveBeenCalledExactlyOnceWith(
      saved,
      expect.any(AbortSignal),
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each(["select", "reset"] as const)(
    "ignores delayed startup storage after an explicit %s",
    async (intent) => {
      const startup = deferred<CoverSource | null>();
      mocks.load.mockReturnValue(startup.promise);
      const chosen = pdf("chosen.pdf");
      mocks.parse.mockResolvedValue(chosen);
      await mount();
      await act(async () => {
        if (intent === "select") await current.importCover(file("chosen.pdf"));
        else await current.resetCover();
      });
      await act(async () =>
        startup.resolve({ name: "old.pdf", blob: file("old.pdf") }),
      );

      expect(current.cover?.document ?? null).toBe(
        intent === "select" ? chosen : null,
      );
      expect(mocks.parse).toHaveBeenCalledTimes(intent === "select" ? 1 : 0);
    },
  );

  it("releases each replaced PDF and the current PDF on unmount", async () => {
    const first = pdf("one.pdf");
    const second = pdf("two.pdf");
    mocks.parse.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await mount();
    await act(async () => current.importCover(file("one.pdf")));
    await act(async () => current.importCover(file("two.pdf")));

    expect(mocks.release.mock.calls).toEqual([[first]]);
    await unmount();
    expect(mocks.release.mock.calls).toEqual([[first], [second]]);
  });

  it("aborts a stale import, releases its late PDF, and retains the newer selection", async () => {
    const delayed = deferred<CoverDocument>();
    const stale = pdf("slow.pdf");
    const newest = pdf("new.pdf");
    mocks.parse
      .mockReturnValueOnce(delayed.promise)
      .mockResolvedValueOnce(newest);
    await mount();
    let pending!: Promise<void>;
    await act(async () => {
      pending = current.importCover(file("slow.pdf"));
    });
    const staleSignal = mocks.parse.mock.calls[0][1] as AbortSignal;
    expect(current.loading).toBe(true);
    await act(async () => current.importCover(file("new.pdf")));
    expect(staleSignal.aborted).toBe(true);
    await act(async () => {
      delayed.resolve(stale);
      await pending;
    });

    expect(current.cover?.document).toBe(newest);
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith(stale);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0].name).toBe("new.pdf");
    expect(notify).not.toHaveBeenCalled();
  });

  it("releases an in-flight PDF that finishes after unmount", async () => {
    const delayed = deferred<CoverDocument>();
    const abandoned = pdf("abandoned.pdf");
    mocks.parse.mockReturnValue(delayed.promise);
    await mount();
    let pending!: Promise<void>;
    await act(async () => {
      pending = current.importCover(file("abandoned.pdf"));
    });
    const signal = mocks.parse.mock.calls[0][1] as AbortSignal;
    await unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      delayed.resolve(abandoned);
      await pending;
    });

    expect(mocks.release).toHaveBeenCalledExactlyOnceWith(abandoned);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps reset as the last persisted intent when a preceding save is delayed", async () => {
    const saveGate = deferred<void>();
    let stored: CoverSource | null = null;
    mocks.parse.mockResolvedValue(pdf("chosen.pdf"));
    mocks.save.mockImplementation(async (source: CoverSource) => {
      await saveGate.promise;
      stored = source;
    });
    mocks.clear.mockImplementation(async () => {
      stored = null;
    });
    await mount();
    let importing!: Promise<void>;
    let resetting!: Promise<void>;
    await act(async () => {
      importing = current.importCover(file("chosen.pdf"));
    });
    await act(async () => {
      resetting = current.resetCover();
    });
    await act(async () => {
      saveGate.resolve();
      await Promise.all([importing, resetting]);
    });

    expect(current.cover).toBeNull();
    expect(stored).toBeNull();
    expect(mocks.clear).toHaveBeenCalledTimes(1);
  });

  it("keeps a newer selection persisted when a preceding reset is delayed", async () => {
    const clearGate = deferred<void>();
    let stored: CoverSource | null = null;
    const chosen = pdf("chosen.pdf");
    mocks.parse.mockResolvedValue(chosen);
    mocks.clear.mockImplementation(async () => {
      await clearGate.promise;
      stored = null;
    });
    mocks.save.mockImplementation(async (source: CoverSource) => {
      stored = source;
    });
    await mount();
    let resetting!: Promise<void>;
    let importing!: Promise<void>;
    await act(async () => {
      resetting = current.resetCover();
    });
    await act(async () => {
      importing = current.importCover(file("chosen.pdf"));
    });
    await act(async () => {
      clearGate.resolve();
      await Promise.all([resetting, importing]);
    });

    expect(current.cover?.document).toBe(chosen);
    expect(stored).toEqual({ name: "chosen.pdf", blob: expect.any(File) });
  });
});
