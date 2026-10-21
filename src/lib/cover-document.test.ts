import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseCoverFile, sanitizeCoverHtml } from "./cover-document";

async function docx(body: string) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return new File(
    [await zip.generateAsync({ type: "uint8array" })],
    "paper.docx",
  );
}

describe("cover documents", () => {
  it("converts real DOCX paragraphs and emphasis without adding a synthetic cover", async () => {
    const result = await parseCoverFile(
      await docx(
        "<w:p><w:r><w:t>Original document heading</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>真实文档正文 &amp; preserved text</w:t></w:r></w:p>",
      ),
    );
    expect(result.kind).toBe("docx");
    if (result.kind !== "docx") return;
    const html = result.blocks.map((block) => block.html).join("");
    expect(html).toContain("Original document heading");
    expect(html).toContain(
      "<strong>真实文档正文 &amp; preserved text</strong>",
    );
    expect(html).not.toContain("pdf-masthead");
    expect(result.filename).toBe("paper.docx");
  });

  it("keeps safe formatting and local raster artwork while blocking active or remote content", () => {
    const html = sanitizeCoverHtml(
      '<h1>Title</h1><p><em>original</em> text</p><script>alert(1)</script><iframe src="https://example.com"></iframe><img src="https://example.com/track.png"><img src="data:image/png;base64,aGVsbG8=" onerror="alert(1)"><a href="javascript:alert(1)">bad</a><a href="https://example.com/paper">Reference</a>',
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("h1")?.textContent).toBe("Title");
    expect(doc.querySelector("em")?.textContent).toBe("original");
    expect(doc.querySelector("script,iframe,[onerror]")).toBeNull();
    expect(doc.querySelectorAll("img")).toHaveLength(1);
    expect(doc.querySelector("img")?.src).toMatch(/^data:image\/png/);
    expect(doc.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(doc.querySelectorAll("a")[1].getAttribute("rel")).toBe(
      "noopener noreferrer",
    );
  });

  it.each(["paper.doc", "paper.exe", "paper.html"])(
    "rejects unsupported file %s with supported formats",
    async (name) => {
      await expect(
        parseCoverFile(new File(["unsupported"], name)),
      ).rejects.toThrow(/PDF.*docx/);
    },
  );

  it("rejects a disguised PDF before asking the PDF renderer to process it", async () => {
    await expect(
      parseCoverFile(new File(["not pdf"], "paper.pdf")),
    ).rejects.toThrow(/PDF 文件/);
  });

  it("rejects a ZIP that has no Word document", async () => {
    const zip = new JSZip().file("not-word.xml", "text");
    await expect(
      parseCoverFile(
        new File(
          [await zip.generateAsync({ type: "uint8array" })],
          "paper.docx",
        ),
      ),
    ).rejects.toThrow(/Word/);
  });

  it("honors an already cancelled import", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      parseCoverFile(new File([""], "paper.pdf"), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
