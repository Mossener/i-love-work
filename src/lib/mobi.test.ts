import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseMobi } from "./mobi";
import { releaseBook } from "./epub";
import { mobiFixture } from "./test-fixtures/mobi-fixture";
import { buildReadingBlocks } from "./reading-document";

const objectUrls = new Map<string, Blob>();
let serial = 0;
beforeEach(() => {
  objectUrls.clear();
  serial = 0;
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL(blob: Blob) {
      const url = `blob:mobi-fixture-${++serial}`;
      objectUrls.set(url, blob);
      return url;
    }
    static revokeObjectURL(url: string) { objectUrls.delete(url); }
  });
});
afterEach(() => vi.unstubAllGlobals());
const file = (options: Parameters<typeof mobiFixture>[0] = {}) => new Blob([mobiFixture(options) as BlobPart]);

describe("parseMobi", () => {
  it("reads a real MOBI database, metadata, ordered chapters and embedded illustrations", async () => {
    const book = await parseMobi(file(), "sample.mobi");
    expect(book.id).toMatch(/^mobi-[a-f0-9]+$/);
    expect(book.title).toBe("MOBI 测试书");
    expect(book.author).toBe("林舟");
    expect(book.language).toBe("zh-CN");
    expect(book.description).toBe("Original fixture");
    expect(book.publisher).toBe("Fixture Press");
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Opening", "Contents", "Notes"]);
    expect(book.chapters[0].text).toContain("你好 world.");
    expect(book.imageCount).toBe(1);
    expect(book.resourceUrls).toHaveLength(1);
    const image = new DOMParser().parseFromString(book.chapters[0].html, "text/html").querySelector("img")!;
    expect(objectUrls.get(image.src)?.type).toBe("image/png");
    releaseBook(book);
    expect(objectUrls.size).toBe(0);
  });

  it("uses the content identity across filenames and handles actual PalmDOC compression", async () => {
    const first = await parseMobi(file({ compression: 2 }), "one.mobi");
    const second = await parseMobi(file({ compression: 2 }), "two.mobi");
    expect(second.id).toBe(first.id);
    expect(first.chapters[0].text).toContain("你好 world.");
    expect(first.chapters[2].text).toContain("Original endnote.");
  });

  it("keeps a real table of contents and two-way file-position note targets", async () => {
    const book = await parseMobi(file());
    expect(book.toc.map((entry) => entry.title)).toEqual(["Opening", "Notes"]);
    const source = new DOMParser().parseFromString(book.chapters[0].html, "text/html");
    const note = source.querySelector("a")!;
    expect(note.dataset.chapterId).toBe(book.chapters[2].id);
    const destination = new DOMParser().parseFromString(book.chapters[2].html, "text/html");
    expect(destination.getElementById(note.dataset.fragment!)).not.toBeNull();
    expect(destination.querySelector("a")!.dataset.chapterId).toBe(book.chapters[0].id);
  });

  it("accepts old MOBI without EXTH and falls back to the header title", async () => {
    const book = await parseMobi(file({ noExth: true }));
    expect(book.title).toBe("Header title");
    expect(book.author).toBe("作者不详");
    expect(book.chapters).toHaveLength(3);
  });

  it("sanitizes original HTML and rejects external image and active resource references", async () => {
    const book = await parseMobi(file({ html: '<html><body><h1>Safe</h1><p onclick="alert(1)">Real text<script>unsafe()</script></p><img src="https://tracker.invalid/x"/><iframe src="https://bad.invalid"></iframe><a href="javascript:alert(1)">Unsafe</a><a href="https://example.com/">Allowed</a><img recindex="1" onerror="alert(1)"/></body></html>' }));
    const html = book.chapters[0].html;
    expect(html).not.toMatch(/onclick|onerror|<script|<iframe|tracker\.invalid|javascript:/);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(book.imageCount).toBe(1);
  });

  it("rejects DRM before parsing and does not allocate resources", async () => {
    await expect(parseMobi(file({ encryption: 2 }))).rejects.toThrow(/DRM/);
    expect(objectUrls.size).toBe(0);
  });

  it("rejects oversized, corrupt and unsupported books with useful errors", async () => {
    const oversize = new Blob();
    Object.defineProperty(oversize, "size", { value: 80 * 1024 * 1024 + 1 });
    await expect(parseMobi(oversize)).rejects.toThrow(/80 MB/);
    await expect(parseMobi(new Blob(["not a MOBI"]))).rejects.toThrow(/MOBI.*损坏|有效.*MOBI/);
    await expect(parseMobi(file({ declaredLength: 250 * 1024 * 1024 + 1 }))).rejects.toThrow(/250 MB/);
    await expect(parseMobi(file({ compression: 17480 }))).rejects.toThrow(/HUFF|压缩/);
  });

  it("rejects pure KF8 explicitly instead of displaying binary reconstruction data", async () => {
    await expect(parseMobi(file({ version: 8 }))).rejects.toThrow(/KF8.*EPUB/);
  });

  it("reads the original MOBI7 rendition of a hybrid MOBI without mixing both renditions", async () => {
    const book = await parseMobi(file({ hybrid: true, compression: 2 }));
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Opening", "Contents", "Notes"]);
    expect(book.chapters.map((chapter) => chapter.text).join(" ")).not.toContain("Second KF8");
    expect(book.imageCount).toBe(1);
  });

  it("rejects a truncated record directory before allocating resource URLs", async () => {
    const bytes = mobiFixture();
    new DataView(bytes.buffer).setUint32(86, bytes.length + 1);
    await expect(parseMobi(new Blob([bytes as BlobPart]))).rejects.toThrow(/损坏/);
    expect(objectUrls.size).toBe(0);
  });

  it("rejects invalid PalmDOC references rather than inventing missing text", async () => {
    const bytes = mobiFixture({ compression: 2 });
    const textStart = new DataView(bytes.buffer).getUint32(86);
    bytes[textStart] = 0x80;
    bytes[textStart + 1] = 0x08;
    await expect(parseMobi(new Blob([bytes as BlobPart]))).rejects.toThrow(/损坏/);
  });

  it("supports an actual overlapping PalmDOC backreference", async () => {
    const original = mobiFixture({ html: "<html><body><p>abcabcabc</p></body></html>" });
    const view = new DataView(original.buffer);
    const start = view.getUint32(86);
    const imageStart = view.getUint32(94);
    const headerStart = view.getUint32(78);
    const payload = new TextEncoder().encode("<html><body><p>abcabcabc</p></body></html>");
    const needle = new TextEncoder().encode("abcabcabc");
    const literal = new TextDecoder().decode(payload).indexOf(new TextDecoder().decode(needle));
    const packed = new Uint8Array(payload.length - 4);
    packed.set(payload.subarray(0, literal + 3));
    packed.set([0x80, 0x1b], literal + 3); // distance 3, length 6
    packed.set(payload.subarray(literal + 9), literal + 5);
    const bytes = new Uint8Array(original.length - 4);
    bytes.set(original.subarray(0, start));
    bytes.set(packed, start);
    bytes.set(original.subarray(imageStart), start + packed.length);
    new DataView(bytes.buffer).setUint16(headerStart, 2);
    new DataView(bytes.buffer).setUint32(94, imageStart - 4);
    const book = await parseMobi(new Blob([bytes as BlobPart]));
    expect(book.chapters[0].text).toBe("abcabcabc");
  });

  it("cleans already-created image URLs when later chapter parsing fails", async () => {
    const create = URL.createObjectURL;
    let calls = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      if (++calls === 2) throw new Error("allocation failed");
      return create(blob);
    });
    // Two valid, distinct resource records ensure a failure after the first image.
    const original = mobiFixture({ html: '<html><body><h1>Resources</h1><img recindex="1"/><img recindex="2"/></body></html>' });
    const originalView = new DataView(original.buffer);
    const originalImageStart = originalView.getUint32(94);
    const image = original.subarray(originalImageStart);
    const bytes = new Uint8Array(original.length + 8 + image.length);
    bytes.set(original.subarray(0, 102));
    bytes.set(original.subarray(102), 110);
    bytes.set(image, original.length + 8);
    const view = new DataView(bytes.buffer);
    view.setUint16(76, 4);
    for (const offset of [78, 86, 94]) view.setUint32(offset, originalView.getUint32(offset) + 8);
    view.setUint32(102, original.length + 8);
    await expect(parseMobi(new Blob([bytes as BlobPart]))).rejects.toThrow(/损坏/);
    expect(calls).toBe(2);
    expect(objectUrls.size).toBe(0);
  });

  it("creates a useful heading outline when a book has no guide TOC", async () => {
    const book = await parseMobi(file({ html: '<html><body><h1>Part One</h1><p>Text.</p><h2>First Section</h2><p>More text.</p><h2 id="kept">Next Section</h2><p>Final text.</p></body></html>' }));
    expect(book.toc.map((entry) => [entry.title, entry.level])).toEqual([
      ["Part One", 0], ["First Section", 1], ["Next Section", 1],
    ]);
    const document = new DOMParser().parseFromString(book.chapters[0].html, "text/html");
    for (const entry of book.toc) expect(document.getElementById(entry.fragment!)).not.toBeNull();
    expect(book.toc[2].fragment).toBe("kept");
  });

  it("sanitizes an embedded SVG before creating its local object URL", async () => {
    const original = mobiFixture();
    const imageStart = new DataView(original.buffer).getUint32(94);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="unsafe()"><script>unsafe()</script><image href="https://tracker.invalid/pixel"/><rect width="10" height="10" style="fill:url(https://tracker.invalid/paint)"/></svg>');
    const bytes = new Uint8Array(imageStart + svg.length);
    bytes.set(original.subarray(0, imageStart));
    bytes.set(svg, imageStart);
    const book = await parseMobi(new Blob([bytes as BlobPart]));
    const blob = objectUrls.get(book.resourceUrls[0])!;
    expect(blob.type).toBe("image/svg+xml");
    const reader = new FileReader();
    const text = await new Promise<string>((resolve) => { reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
    expect(text).not.toMatch(/script|onload|tracker\.invalid|<image/);
    expect(text).toContain("<rect");
  });

  it("reads Windows-1252 text without mis-decoding accented letters", async () => {
    const bytes = mobiFixture({ html: "<html><body><h1>CafX</h1><p>Rsum</p></body></html>", noExth: true });
    const view = new DataView(bytes.buffer);
    const headerStart = view.getUint32(78);
    const textStart = view.getUint32(86);
    view.setUint32(headerStart + 28, 1252);
    const offset = new TextDecoder().decode(bytes.subarray(textStart)).indexOf("CafX") + textStart + 3;
    bytes[offset] = 0xe9;
    const book = await parseMobi(new Blob([bytes as BlobPart]));
    expect(book.chapters[0].title).toBe("Café");
  });

  it("resolves traditional named HTML anchors across MOBI chapter breaks", async () => {
    const book = await parseMobi(file({ html: '<html><body><h1>Source</h1><p><a href="#endnote">Jump to note</a></p><mbp:pagebreak/><h1>Note</h1><a name="endnote"></a><p>Original note.</p></body></html>' }));
    const source = new DOMParser().parseFromString(book.chapters[0].html, "text/html");
    const target = new DOMParser().parseFromString(book.chapters[1].html, "text/html");
    expect(source.querySelector("a")?.dataset.chapterId).toBe(book.chapters[1].id);
    expect(source.querySelector("a")?.dataset.fragment).toBe("endnote");
    expect(target.getElementById("endnote")).not.toBeNull();
  });

  it("keeps file-position targets when shared paper rendering replaces the source heading", async () => {
    const book = await parseMobi(file());
    const blocks = buildReadingBlocks(book);
    const first = document.createElement("div");
    first.innerHTML = blocks.filter((block) => block.chapterIndex === 0).map((block) => block.html).join("");
    expect(Array.from(first.querySelectorAll("h1,h2"), (heading) => heading.textContent)).toEqual(["1. Opening"]);
    for (const entry of book.toc) {
      const chapterIndex = book.chapters.findIndex((chapter) => chapter.id === entry.chapterId);
      const target = document.createElement("div");
      target.innerHTML = blocks.filter((block) => block.chapterIndex === chapterIndex).map((block) => block.html).join("");
      expect(target.querySelector(`[id="${entry.fragment}"]`)).not.toBeNull();
    }
  });

  it.each([0, 1, 8, 15])("maps a file-position inside a pagebreak to the following chapter (byte +%i)", async (inside) => {
    let html = '<html><head><guide><reference type="toc" filepos="TOCPOS0000"/></guide></head><body><h1>Contents</h1><p>中文 <a filepos="NOTEPOS000">Destination</a></p><mbp:pagebreak/><h1>Destination</h1><p>Text after the chapter break.</p></body></html>';
    const position = new TextEncoder().encode(html.slice(0, html.indexOf("<mbp:pagebreak/>"))).length + inside;
    html = html.replace("NOTEPOS000", String(position).padStart(10, "0"));
    const book = await parseMobi(file({ html, compression: 2 }));
    const source = new DOMParser().parseFromString(book.chapters[0].html, "text/html");
    const link = source.querySelector("a")!;
    expect(link.dataset.chapterId).toBe(book.chapters[1].id);
    expect(book.toc).toEqual([{ title: "Destination", chapterId: book.chapters[1].id, fragment: link.dataset.fragment, level: 0 }]);
    const rendered = document.createElement("div");
    rendered.innerHTML = buildReadingBlocks(book).filter((block) => block.chapterIndex === 1).map((block) => block.html).join("");
    expect(rendered.querySelector(`[id="${link.dataset.fragment}"]`)?.textContent).toBe("2. Destination");
  });

  it("finds the guide TOC when its file-position points to the preceding pagebreak", async () => {
    let html = '<html><head><guide><reference type="toc" filepos="TOCPOS0000"/></guide></head><body><h1>Opening</h1><p>Original prose.</p><mbp:pagebreak/><h1>Contents</h1><p><a filepos="OPENPOS000">Custom TOC label</a></p></body></html>';
    const position = new TextEncoder().encode(html.slice(0, html.indexOf("<mbp:pagebreak/>"))).length;
    html = html.replace("TOCPOS0000", String(position).padStart(10, "0"));
    const book = await parseMobi(file({ html }));
    expect(book.toc).toHaveLength(1);
    expect(book.toc[0].title).toBe("Custom TOC label");
    expect(book.toc[0].chapterId).toBe(book.chapters[0].id);
  });
});
