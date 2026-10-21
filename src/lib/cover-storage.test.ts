import { Blob as NodeBlob } from "node:buffer";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCoverSource,
  loadCoverSource,
  saveCoverSource,
} from "./cover-storage";

beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());

describe("selected cover storage", () => {
  it("loads no cover before selection, persists exact file bytes, and clears the selection", async () => {
    expect(await loadCoverSource()).toBeNull();
    const blob = new NodeBlob(["%PDF-1.7 original cover"], {
      type: "application/pdf",
    }) as unknown as Blob;
    await saveCoverSource({ name: "Chosen paper.pdf", blob });
    const stored = await loadCoverSource();
    expect(stored?.name).toBe("Chosen paper.pdf");
    expect(await stored!.blob.text()).toBe("%PDF-1.7 original cover");
    await clearCoverSource();
    expect(await loadCoverSource()).toBeNull();
  });

  it("replaces the selected file instead of accumulating references", async () => {
    const blob = new NodeBlob(["one"]) as unknown as Blob;
    await saveCoverSource({ name: "one.pdf", blob });
    await saveCoverSource({
      name: "two.docx",
      blob: new NodeBlob(["two"]) as unknown as Blob,
    });
    expect((await loadCoverSource())?.name).toBe("two.docx");
    expect(await (await loadCoverSource())!.blob.text()).toBe("two");
  });

  it("reports unavailable browser storage without synchronous crashes", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(loadCoverSource()).rejects.toThrow(/存储/);
    await expect(
      saveCoverSource({
        name: "paper.pdf",
        blob: new NodeBlob(["pdf"]) as unknown as Blob,
      }),
    ).rejects.toThrow(/存储/);
    await expect(clearCoverSource()).rejects.toThrow(/存储/);
  });
});
