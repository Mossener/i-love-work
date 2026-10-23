import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { BOOK_FILE_ACCEPT, detectBookFormat, parseBook } from "./book-import";
import { parseEpub } from "./epub";
import { mobiFixture } from "./test-fixtures/mobi-fixture";

async function epub(type = "application/epub+zip") {
  const zip = new JSZip();
  zip.file("META-INF/container.xml", '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>');
  zip.file("book.opf", '<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">兼容旧图书</dc:title></metadata><manifest><item id="c1" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>');
  zip.file("chapter.xhtml", '<html><body><h1>第一章</h1><p>原有阅读进度应当保留。</p></body></html>');
  return new Blob([await zip.generateAsync({ type: "uint8array" }) as BlobPart], { type });
}

describe("book format detection", () => {
  it("advertises every supported extension in the import picker", () => {
    for (const extension of [".epub", ".mobi", ".txt"]) {
      expect(BOOK_FILE_ACCEPT.split(",")).toContain(extension);
    }
  });

  it.each([[
    "小说.EPUB", "epub",
  ], ["小说.MoBi", "mobi"], ["小说.TXT", "txt"]] as const)("detects %s case insensitively", (name, format) => {
    expect(detectBookFormat(new File([], name))).toBe(format);
  });

  it.each([
    ["application/epub+zip", "epub"],
    ["application/x-mobipocket-ebook", "mobi"],
    ["text/plain;charset=gb18030", "txt"],
  ] as const)("restores nameless %s blobs", (type, format) => {
    expect(detectBookFormat(new Blob([], { type }))).toBe(format);
  });

  it("uses persisted metadata when IndexedDB returns a nameless generic blob", () => {
    const stored = new Blob(["正文"], { type: "application/octet-stream" });
    expect(detectBookFormat(stored, { format: "txt" })).toBe("txt");
    expect(detectBookFormat(stored, { filename: "恢复的图书.MOBI" })).toBe("mobi");
  });

  it("does not import unsupported extensions as text merely because the MIME is text/plain", async () => {
    const file = new File(["正文"], "document.csv", { type: "text/plain" });
    expect(detectBookFormat(file)).toBeNull();
    await expect(parseBook(file)).rejects.toThrow(/EPUB.*MOBI.*TXT/);
  });

  it("rejects unknown binary data instead of treating arbitrary blobs as EPUB or text", async () => {
    const file = new Blob([new Uint8Array([0, 1, 2, 3])]);
    expect(detectBookFormat(file)).toBeNull();
    await expect(parseBook(file)).rejects.toThrow(/EPUB.*MOBI.*TXT/);
  });
});

describe("parseBook", () => {
  it("retains legacy EPUB content IDs while adding import metadata", async () => {
    const file = new File([await epub()], "兼容.EPUB");
    const original = await parseEpub(file);
    const imported = await parseBook(file);
    expect(imported.id).toBe(original.id);
    expect(imported.title).toBe("兼容旧图书");
    expect(imported.format).toBe("epub");
    expect(imported.filename).toBe("兼容.EPUB");
  });

  it("restores existing saved EPUB blobs without a format or filename", async () => {
    const file = await epub();
    expect((await parseBook(file)).format).toBe("epub");
  });

  it("recognizes nameless ZIP signatures for EPUB records that lost their MIME type", async () => {
    const file = await epub("");
    const imported = await parseBook(file);
    expect(imported.title).toBe("兼容旧图书");
    expect(imported.format).toBe("epub");
  });

  it("reopens real TXT files from generic saved blobs without changing their chapter anchors or book identity", async () => {
    const source = "前言\n阅读说明。\n第一章 初见\n你好，世界。\nChapter 2 Later\nA quiet afternoon.";
    const first = await parseBook(new File([source], "午间读物.TXT"));
    const restored = await parseBook(new Blob([source]), { format: "txt", filename: first.filename });
    const renamed = await parseBook(new File([source], "重命名.txt"));
    expect(first.format).toBe("txt");
    expect(first.title).toBe("午间读物");
    expect(restored.filename).toBe("午间读物.TXT");
    expect(restored.title).toBe(first.title);
    expect(first.id).toMatch(/^txt-/);
    expect(restored.id).toBe(first.id);
    expect(renamed.id).toBe(first.id);
    expect(restored.chapters).toEqual(first.chapters);
    expect(restored.toc.map(entry => entry.title)).toEqual(["前言", "第一章 初见", "Chapter 2 Later"]);
    expect(restored.sourceEncoding).toBe("utf-8");
  });

  it("routes real MOBI bytes and restores the same publication from its saved format", async () => {
    const bytes = mobiFixture({ html: "<html><body><h1>Opening</h1><p>原始 MOBI 正文。</p></body></html>" });
    const first = await parseBook(new File([bytes as BlobPart], "午间读物.MOBI"));
    const restored = await parseBook(new Blob([bytes as BlobPart]), { format: "mobi", filename: first.filename });
    const renamed = await parseBook(new File([bytes as BlobPart], "renamed.mobi"));
    expect(first.id).toMatch(/^mobi-/);
    expect(first.format).toBe("mobi");
    expect(restored.filename).toBe("午间读物.MOBI");
    expect(restored.id).toBe(first.id);
    expect(renamed.id).toBe(first.id);
    expect(restored.chapters).toEqual(first.chapters);
    expect(restored.chapters[0].text).toContain("原始 MOBI 正文。");
  });
});
