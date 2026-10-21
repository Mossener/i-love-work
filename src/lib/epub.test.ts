import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEpub, releaseBook } from "./epub";

const container = `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
const body = (html: string, title = "") =>
  `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>${html}</body></html>`;
const packageFile = (items: string, spine: string, metadata = "") =>
  `<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>测试书</dc:title><dc:creator>林舟</dc:creator><dc:language>zh-CN</dc:language>${metadata}</metadata><manifest>${items}</manifest><spine toc="ncx">${spine}</spine></package>`;
const item = (
  id: string,
  href: string,
  type = "application/xhtml+xml",
  properties = "",
) =>
  `<item id="${id}" href="${href}" media-type="${type}" properties="${properties}"/>`;

async function epub(files: Record<string, string | Uint8Array>) {
  const zip = new JSZip();
  zip.file("META-INF/container.xml", container);
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return new Blob([bytes as BlobPart], { type: "application/epub+zip" });
}

function simpleFiles(html = "<h1>正文</h1><p>一段文字。</p>") {
  return {
    "OPS/package.opf": packageFile(
      item("chapter", "Text/first.xhtml"),
      '<itemref idref="chapter"/>',
    ),
    "OPS/Text/first.xhtml": body(html),
  };
}

const urls = new Map<string, Blob>();
let serial = 0;
beforeEach(() => {
  urls.clear();
  serial = 0;
  // jsdom has no object-URL store; this shim retains the actual emitted blobs.
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL(blob: Blob) {
        const url = `blob:paperleaf-${++serial}`;
        urls.set(url, blob);
        return url;
      }
      static revokeObjectURL(url: string) {
        urls.delete(url);
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("parseEpub", () => {
  it("reads metadata and spine order, skips nonlinear entries, and counts Chinese characters plus Latin words", async () => {
    const book = await parseEpub(
      await epub({
        "OPS/package.opf": packageFile(
          item("one", "one.xhtml") +
            item("two", "two.xhtml") +
            item("note", "note.xhtml"),
          '<itemref idref="two"/><itemref idref="note" linear="no"/><itemref idref="one"/>',
          "<dc:description>&lt;p&gt;一本实验书&lt;/p&gt;</dc:description><dc:publisher>纸间出版社</dc:publisher>",
        ),
        "OPS/one.xhtml": body("<h1>后章</h1><p>你好 world test.</p>"),
        "OPS/two.xhtml": body("<h1>前章</h1><p>中文。</p>"),
        "OPS/note.xhtml": body("<h1>附录</h1>"),
      }),
    );
    expect(book.title).toBe("测试书");
    expect(book.author).toBe("林舟");
    expect(book.language).toBe("zh-CN");
    expect(book.publisher).toBe("纸间出版社");
    expect(book.description).toBe("一本实验书");
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      "前章",
      "后章",
    ]);
    expect(book.chapters.map((chapter) => chapter.wordCount)).toEqual([4, 6]);
    expect(book.wordCount).toBe(10);
  });

  it("reads an EPUB 3 nested navigation list and rewrites encoded internal chapter links", async () => {
    const book = await parseEpub(
      await epub({
        "OPS/package.opf": packageFile(
          item("one", "Text/part%20one.xhtml") +
            item("two", "Text/two.xhtml") +
            item("nav", "nav.xhtml", "application/xhtml+xml", "nav"),
          '<itemref idref="one"/><itemref idref="two"/>',
        ),
        "OPS/nav.xhtml": body(
          '<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol><li><a href="Text/part%20one.xhtml">第一章</a><ol><li><a href="Text/two.xhtml#%E5%AE%9E%E9%AA%8C">实验章节</a></li></ol></li></ol></nav>',
        ),
        "OPS/Text/part one.xhtml": body(
          '<h1>书内标题</h1><p><a href="two.xhtml#%E5%AE%9E%E9%AA%8C">下一章</a><a href="#local">本节</a></p>',
        ),
        "OPS/Text/two.xhtml": body('<h1 id="实验">实验</h1>'),
      }),
    );
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      "第一章",
      "实验章节",
    ]);
    expect(book.toc).toEqual([
      { title: "第一章", chapterId: book.chapters[0].id, level: 0 },
      {
        title: "实验章节",
        chapterId: book.chapters[1].id,
        fragment: "实验",
        level: 1,
      },
    ]);
    const document = new DOMParser().parseFromString(
      book.chapters[0].html,
      "text/html",
    );
    expect(document.querySelector("a")?.dataset.chapterId).toBe(
      book.chapters[1].id,
    );
    expect(document.querySelector("a")?.dataset.fragment).toBe("实验");
    expect(document.querySelectorAll("a")[1].getAttribute("href")).toBe(
      "#local",
    );
  });

  it("reads EPUB 2 NCX labels relative to its own directory", async () => {
    const book = await parseEpub(
      await epub({
        "OPS/package.opf": packageFile(
          item("chapter", "Text/first.xhtml") +
            item("ncx", "Navigation/toc.ncx", "application/x-dtbncx+xml"),
          '<itemref idref="chapter"/>',
        ),
        "OPS/Text/first.xhtml": body("<p>第一节</p>"),
        "OPS/Navigation/toc.ncx":
          '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint><navLabel><text>传统目录</text></navLabel><content src="../Text/first.xhtml#start"/></navPoint></navMap></ncx>',
      }),
    );
    expect(book.chapters[0].title).toBe("传统目录");
    expect(book.toc[0]).toEqual({
      title: "传统目录",
      chapterId: book.chapters[0].id,
      fragment: "start",
      level: 0,
    });
  });

  it("preserves original raster figures and captions, deduplicates resources, and releases them", async () => {
    const book = await parseEpub(
      await epub({
        ...simpleFiles(
          '<h1>观察</h1><figure><img src="../Images/figure%201.png" alt="显微图"/><figcaption>图 1：原始图注</figcaption></figure><img src="../Images/figure%201.png"/>',
        ),
        "OPS/package.opf": packageFile(
          item("chapter", "Text/first.xhtml") +
            item("cover", "Images/figure%201.png", "image/png", "cover-image"),
          '<itemref idref="chapter"/>',
        ),
        "OPS/Images/figure 1.png": new Uint8Array([
          137, 80, 78, 71, 13, 10, 26, 10,
        ]),
      }),
    );
    const document = new DOMParser().parseFromString(
      book.chapters[0].html,
      "text/html",
    );
    expect(document.querySelector("figcaption")?.textContent).toBe(
      "图 1：原始图注",
    );
    expect(document.querySelector("img")?.getAttribute("alt")).toBe("显微图");
    expect(document.querySelector("img")?.getAttribute("src")).toBe(
      book.coverUrl,
    );
    expect(book.imageCount).toBe(2);
    expect(book.resourceUrls).toEqual([book.coverUrl]);
    expect(urls.get(book.coverUrl!)?.type).toBe("image/png");
    releaseBook(book);
    expect(urls.size).toBe(0);
    releaseBook(book);
  });

  it("removes active content and all remote resource entry points", async () => {
    const book = await parseEpub(
      await epub(
        simpleFiles(`<h1 style="background:url(https://evil.test/pixel)">安全正文</h1>
      <script>alert(1)</script><iframe src="https://evil.test"></iframe><object data="https://evil.test"></object>
      <form action="https://evil.test"><input name="password"/></form><link rel="stylesheet" href="https://evil.test/style.css"/>
      <img src="https://evil.test/image.png" srcset="https://evil.test/2.png 2x" onerror="alert(1)"/>
      <video poster="https://evil.test/poster.png"><source src="https://evil.test/movie.mp4"/></video>
      <svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><image href="https://evil.test/image.png"/><rect width="12" height="12"/></svg>
      <a href="javascript:alert(1)">危险</a><a href="https://example.com/article">参考资料</a>`),
      ),
    );
    const document = new DOMParser().parseFromString(
      book.chapters[0].html,
      "text/html",
    );
    expect(
      document.querySelector(
        "script,iframe,object,form,input,link,video,source",
      ),
    ).toBeNull();
    expect(document.querySelector("[onerror],[style],[srcset]")).toBeNull();
    expect(document.querySelector("[src],[poster],svg image")).toBeNull();
    expect(document.querySelector("a")?.hasAttribute("href")).toBe(false);
    const external = Array.from(document.querySelectorAll("a")).find(
      (a) => a.textContent === "参考资料",
    );
    expect(external?.getAttribute("href")).toBe("https://example.com/article");
    expect(external?.getAttribute("rel")).toContain("noopener");
    expect(document.querySelector("svg rect")).not.toBeNull();
    expect(book.imageCount).toBe(1);
  });

  it("sanitizes EPUB SVG image assets before creating their local blob URL", async () => {
    const book = await parseEpub(
      await epub({
        ...simpleFiles('<h1>矢量图</h1><img src="../Images/figure.svg"/>'),
        "OPS/package.opf": packageFile(
          item("chapter", "Text/first.xhtml") +
            item("svg", "Images/figure.svg", "image/svg+xml"),
          '<itemref idref="chapter"/>',
        ),
        "OPS/Images/figure.svg":
          '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><image href="https://evil.test/a.png"/><rect width="10" height="10" fill="red"/></svg>',
      }),
    );
    const image = new DOMParser()
      .parseFromString(book.chapters[0].html, "text/html")
      .querySelector("img");
    expect(image?.getAttribute("src")).toMatch(/^blob:/);
    const blob = urls.get(image!.getAttribute("src")!)!;
    const svg = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(blob);
    });
    expect(svg).toContain("<rect");
    expect(svg).not.toMatch(/script|onload|evil\.test|<image/i);
  });

  it("produces stable IDs for the same content and different IDs for different content", async () => {
    const file = await epub(simpleFiles());
    const first = await parseEpub(file);
    const second = await parseEpub(file);
    const different = await parseEpub(
      await epub(simpleFiles("<h1>另一份内容</h1>")),
    );
    expect(first.id).toBe(second.id);
    expect(first.chapters[0].id).toBe(second.chapters[0].id);
    expect(first.id).not.toBe(different.id);
  });

  it("keeps Latin words separated across block boundaries while preserving inline word fragments", async () => {
    const book = await parseEpub(
      await epub(
        simpleFiles(
          "<h1>Alpha</h1><p>Hello</p><p>world from inter<em>na</em>tional EPUB.</p>",
        ),
      ),
    );
    expect(book.chapters[0].text).toBe(
      "Alpha Hello world from international EPUB.",
    );
    expect(book.chapters[0].wordCount).toBe(6);
  });

  it("releases already-created figure URLs if a later chapter cannot be read", async () => {
    await expect(
      parseEpub(
        await epub({
          "OPS/package.opf": packageFile(
            item("first", "first.xhtml") +
              item("missing", "missing.xhtml") +
              item("figure", "figure.png", "image/png"),
            '<itemref idref="first"/><itemref idref="missing"/>',
          ),
          "OPS/first.xhtml": body('<h1>第一章</h1><img src="figure.png"/>'),
          "OPS/figure.png": new Uint8Array([137, 80, 78, 71]),
        }),
      ),
    ).rejects.toThrow(/章节文件无法读取/);
    expect(serial).toBe(1);
    expect(urls.size).toBe(0);
  });

  it.each([
    [
      "invalid ZIP",
      async () => new Blob(["plain text"]),
      /有效.*EPUB|ZIP.*损坏|压缩包/,
    ],
    [
      "missing container",
      async () => {
        const zip = new JSZip();
        zip.file("dummy", "x");
        return new Blob([
          (await zip.generateAsync({ type: "uint8array" })) as BlobPart,
        ]);
      },
      /container|容器/,
    ],
    ["missing OPF", async () => epub({}), /OPF|书籍描述/],
    [
      "malformed OPF",
      async () => epub({ "OPS/package.opf": "<broken>" }),
      /OPF|书籍描述/,
    ],
    [
      "no readable chapters",
      async () => epub({ "OPS/package.opf": packageFile("", "") }),
      /章节/,
    ],
    [
      "encrypted chapters",
      async () =>
        epub({
          ...simpleFiles(),
          "META-INF/encryption.xml":
            '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><CipherData><CipherReference URI="OPS/Text/first.xhtml"/></CipherData></EncryptedData></encryption>',
        }),
      /加密|DRM/,
    ],
  ] as const)(
    "rejects %s with an actionable Chinese error",
    async (_name, file, message) => {
      await expect(parseEpub(await file())).rejects.toThrow(message);
    },
  );

  it("rejects a ZIP entry that attempts to escape the publication root", async () => {
    await expect(
      parseEpub(
        await epub({
          ...simpleFiles(),
          "../outside.xhtml": body("<h1>outside</h1>"),
        }),
      ),
    ).rejects.toThrow(/路径|安全/);
  });

  it("rejects compressed files over 80 MiB before reading their bytes", async () => {
    const file = new Blob(["x"]);
    Object.defineProperty(file, "size", { value: 80 * 1024 * 1024 + 1 });
    await expect(parseEpub(file)).rejects.toThrow(/80|过大/);
  });

  it("rejects a declared ZIP expansion over 250 MiB before extracting a chapter", async () => {
    const file = await epub(simpleFiles());
    const bytes = new Uint8Array(
      await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      }),
    );
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < bytes.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 251 * 1024 * 1024, true);
        break;
      }
    }
    await expect(parseEpub(new Blob([bytes]))).rejects.toThrow(/250|解压/);
  });

  it("rejects contradictory central-directory counts rather than bypassing expansion checks", async () => {
    const file = await epub(simpleFiles());
    const bytes = new Uint8Array(
      await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      }),
    );
    const view = new DataView(bytes.buffer);
    const end = bytes.length - 22;
    view.setUint16(end + 8, 0, true);
    view.setUint16(end + 10, 0, true);
    await expect(parseEpub(new Blob([bytes]))).rejects.toThrow(
      /压缩包|ZIP.*损坏/,
    );
  });
});
