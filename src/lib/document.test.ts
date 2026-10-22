import { describe, expect, it } from "vitest";
import type { Book, BookChapter } from "../types";
import { buildDocumentBlocks, DEFAULT_DOCUMENT_METADATA } from "./document";
import { normalizeBlocks } from "./pagination";

function chapter(title: string, html: string, wordCount = 10): BookChapter {
  return {
    id: title,
    title,
    href: `${title}.xhtml`,
    html,
    text:
      new DOMParser().parseFromString(html, "text/html").body.textContent ?? "",
    wordCount,
    imageCount: 0,
  };
}

function book(
  chapters = [chapter("Source section", "<p>Original source text.</p>")],
): Book {
  return {
    id: "test-book",
    title: "Private imported book title",
    author: "Private imported author",
    language: "en",
    description: "Private imported synopsis.",
    chapters,
    toc: [],
    wordCount: chapters.reduce((sum, item) => sum + item.wordCount, 0),
    imageCount: 0,
    resourceUrls: [],
  };
}

function documentOf(html: string) {
  return new DOMParser().parseFromString(html, "text/html");
}

function rendered(source: Book, showFigures = true) {
  return documentOf(
    buildDocumentBlocks(source, DEFAULT_DOCUMENT_METADATA, showFigures)
      .map((block) => block.html)
      .join(""),
  );
}

describe("buildDocumentBlocks", () => {
  it("uses the paper metadata and an original neutral abstract on an imported cover", () => {
    const source = book();
    const blocks = buildDocumentBlocks(
      source,
      DEFAULT_DOCUMENT_METADATA,
      false,
    );
    const cover = documentOf(blocks[0].html);
    expect(cover.querySelector(".pdf-article-title")?.textContent).toBe(
      DEFAULT_DOCUMENT_METADATA.title,
    );
    expect(cover.querySelector(".pdf-masthead svg")).not.toBeNull();
    expect(cover.querySelector(".pdf-authors")?.textContent).toBe(
      DEFAULT_DOCUMENT_METADATA.authors,
    );
    expect(cover.querySelector(".pdf-affiliation")?.textContent).toBe(
      DEFAULT_DOCUMENT_METADATA.affiliation,
    );
    expect(cover.querySelector(".pdf-dates")?.textContent).toContain("2026");
    expect(cover.body.textContent).not.toContain(source.title);
    expect(cover.body.textContent).not.toContain(source.author);
    const document = rendered(source, false);
    expect(document.querySelector(".pdf-abstract")?.textContent).not.toContain(
      source.description,
    );
    expect(
      document.querySelector(".pdf-abstract")?.textContent?.split(/\s+/).length,
    ).toBeGreaterThan(80);
    expect(document.querySelector(".pdf-keywords")?.textContent).toContain(
      "Keywords",
    );
    expect(document.body.textContent).not.toContain("DOI");
  });

  it("uses the demo description as its abstract", () => {
    const source = {
      ...book(),
      isDemo: true,
      description:
        "An English demonstration abstract about structured reading.",
    };
    expect(
      rendered(source, false).querySelector(".pdf-abstract")?.textContent,
    ).toContain(source.description);
  });

  it("escapes all metadata and chapter titles instead of activating their HTML", () => {
    const injection = '<img src="x" onerror="alert(1)">';
    const metadata = {
      filename: injection,
      title: injection,
      journal: injection,
      authors: injection,
      affiliation: injection,
      year: injection,
    };
    const blocks = buildDocumentBlocks(
      book([chapter(injection, "<p>Safe.</p>")]),
      metadata,
      false,
    );
    const document = documentOf(blocks.map((block) => block.html).join(""));
    expect(document.querySelector("img,[onerror],script")).toBeNull();
    expect(document.querySelector(".pdf-article-title")?.textContent).toBe(
      injection,
    );
    expect(document.querySelector(".pdf-authors")?.textContent).toBe(injection);
    expect(document.querySelector(".pdf-affiliation")?.textContent).toBe(
      injection,
    );
    expect(document.querySelector(".pdf-section-heading")?.textContent).toBe(
      `1. ${injection}`,
    );
    expect(document.querySelector(".pdf-dates")?.textContent).toContain(
      injection,
    );
  });

  it("replaces only the matching leading heading and retains source structure and escaped text once", () => {
    const html =
      '<article><section><h1>  Source <em>section</em></h1>&lt;img src=x onerror=alert(1)&gt;<p>First <strong>paragraph</strong>.</p><p>Second paragraph.</p><h2>Details</h2><figure id="original"><img src="blob:original"><figcaption>Original caption</figcaption></figure><p>Third paragraph.</p>&lt;script&gt;alert(2)&lt;/script&gt;</section></article>';
    const source = book([chapter("Source section", html)]);
    const original = JSON.stringify(source);
    const document = rendered(source);
    expect(document.querySelectorAll(".pdf-section-heading")).toHaveLength(1);
    expect(document.querySelector("h1:not(.pdf-article-title)")).toBeNull();
    expect(
      document.querySelector("h2:not(.pdf-section-heading)")?.textContent,
    ).toBe("Details");
    expect(document.querySelector("p strong")?.textContent).toBe("paragraph");
    expect(document.querySelectorAll("#original")).toHaveLength(1);
    expect(document.querySelector("#original img")?.getAttribute("src")).toBe(
      "blob:original",
    );
    expect(document.querySelectorAll("p")).toHaveLength(3);
    expect(document.querySelector("script,[onerror]")).toBeNull();
    expect(document.body.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(document.body.textContent).toContain("<script>alert(2)</script>");
    expect(
      document
        .querySelectorAll(".pdf-section-heading")[0]
        .getAttribute("data-pdf-chapter"),
    ).toBe("0");
    expect(JSON.stringify(source)).toBe(original);
  });

  it("preserves headings that do not match the leading chapter title", () => {
    const document = rendered(
      book([
        chapter("Methods", "<h2>Background</h2><p>Text.</p><h1>Methods</h1>"),
      ]),
      false,
    );
    expect(
      Array.from(
        document.querySelectorAll("h1:not(.pdf-article-title),h2"),
      ).map((heading) => heading.textContent),
    ).toEqual(["1. Methods", "Background", "Methods"]);
  });

  it.each(["h1", "h2"])("moves the replaced %s source ID to the generated chapter heading", tag => {
    const source = book([
      chapter("Methods", `<section><${tag} id="chapter-start">Methods</${tag}><p>First.</p><p>Second.</p><p>Third.</p></section>`),
    ]);
    const blocks = buildDocumentBlocks(source, DEFAULT_DOCUMENT_METADATA, false);
    const document = documentOf(normalizeBlocks(blocks).map(block => block.html).join(""));
    const target = document.getElementById("chapter-start");
    expect(target?.classList.contains("pdf-section-heading")).toBe(true);
    expect(target?.textContent).toBe("1. Methods");
    expect(document.querySelectorAll("#chapter-start")).toHaveLength(1);
    expect(document.querySelectorAll("p")).toHaveLength(3);
    expect(document.querySelectorAll("h1:not(.pdf-article-title),h2")).toHaveLength(1);
  });

  it("retains and safely escapes a replaced heading ID when the chapter does not split", () => {
    const document = rendered(book([
      chapter("Methods", '<article><h2 id="title &quot; onmouseover=&quot;alert(1)">Methods</h2><p>Only paragraph.</p></article>'),
    ]), false);
    expect(document.querySelector(".pdf-section-heading")?.id).toBe('title " onmouseover="alert(1)');
    expect(document.querySelector("[onmouseover]")).toBeNull();
    expect(document.querySelectorAll("h2")).toHaveLength(1);
  });

  it("toggles only generated figures and places the distribution after the second paragraph", () => {
    const source = book([
      chapter(
        "Section",
        '<p>One.</p><p>Two.</p><figure id="source-figure"><img src="blob:source"></figure><p>Three.</p>',
      ),
    ]);
    const enabled = rendered(source);
    const disabled = rendered(source, false);
    expect(enabled.querySelectorAll(".pdf-generated-figure")).toHaveLength(1);
    expect(disabled.querySelector(".pdf-generated-figure")).toBeNull();
    expect(
      enabled.querySelector(".pdf-distribution-figure")?.previousElementSibling
        ?.textContent,
    ).toBe("Two.");
    expect(enabled.querySelectorAll("#source-figure")).toHaveLength(1);
    expect(disabled.querySelectorAll("#source-figure")).toHaveLength(1);
    expect(
      enabled.querySelector(".pdf-distribution-figure figcaption")?.textContent,
    ).toBe(
      "Figure S1. Distribution of textual units across document sections. Values are computed from the source text.",
    );
  });

  it("appends a distribution to a chapter without paragraphs", () => {
    const document = rendered(
      book([chapter("Empty paragraphs", "<div>Unwrapped source text.</div>")]),
    );
    expect(
      document.querySelector(".pdf-distribution-figure")?.previousElementSibling
        ?.textContent,
    ).toBe("Unwrapped source text.");
  });

  it("plots the actual word counts in source order and labels its axes", () => {
    const source = book([
      chapter("One", "<p>One.</p>", 17),
      chapter("Two", "<p>Two.</p>", 91),
      chapter("Three", "<p>Three.</p>", 0),
    ]);
    const document = rendered(source);
    const bars = Array.from(document.querySelectorAll(".pdf-distribution-bar"));
    expect(
      bars.map((bar) => Number(bar.getAttribute("data-text-units"))),
    ).toEqual([17, 91, 0]);
    expect(Number(bars[1].getAttribute("height"))).toBeGreaterThan(
      Number(bars[0].getAttribute("height")),
    );
    expect(Number(bars[2].getAttribute("height"))).toBe(0);
    expect(
      document.querySelector(".pdf-distribution-figure svg")?.textContent,
    ).toContain("Document section");
    expect(
      document.querySelector(".pdf-distribution-figure svg")?.textContent,
    ).toContain("Text units");
  });

  it("aggregates many sections into at most sixteen consecutive bins without losing values", () => {
    const source = book(
      Array.from({ length: 33 }, (_, index) =>
        chapter(`Section ${index + 1}`, `<p>Text ${index + 1}.</p>`, index + 1),
      ),
    );
    const bars = Array.from(
      rendered(source).querySelectorAll(".pdf-distribution-bar"),
    );
    expect(bars).toHaveLength(16);
    expect(
      bars.reduce(
        (sum, bar) => sum + Number(bar.getAttribute("data-text-units")),
        0,
      ),
    ).toBe(561);
    expect(bars[0].getAttribute("data-section-start")).toBe("1");
    expect(bars.at(-1)?.getAttribute("data-section-end")).toBe("33");
    for (let index = 1; index < bars.length; index++) {
      expect(Number(bars[index].getAttribute("data-section-start"))).toBe(
        Number(bars[index - 1].getAttribute("data-section-end")) + 1,
      );
    }
  });

  it("adds a schematic representing the real chapter sequence halfway through longer documents", () => {
    const source = book(
      Array.from({ length: 5 }, (_, index) =>
        chapter(`Section ${index + 1}`, `<p>Text ${index + 1}.</p>`),
      ),
    );
    const blocks = buildDocumentBlocks(source, DEFAULT_DOCUMENT_METADATA, true);
    const schematicBlock = blocks.find((block) =>
      block.html.includes("pdf-sequence-figure"),
    );
    expect(schematicBlock?.chapterIndex).toBe(2);
    const document = documentOf(schematicBlock?.html ?? "");
    expect(
      document.querySelector(".pdf-sequence-figure svg")?.textContent,
    ).toContain("Section 1");
    expect(
      document.querySelector(".pdf-sequence-figure svg")?.textContent,
    ).toContain("Section 5");
    expect(
      rendered(source, false).querySelector(".pdf-sequence-figure"),
    ).toBeNull();
  });
});
