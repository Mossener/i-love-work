import { describe, expect, it } from "vitest";
import { chapterParts, findHtmlMatches, highlightHtml } from "./reading";

function documentOf(html: string) {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("chapterParts", () => {
  it("keeps escaped standalone text as text when serializing both sides of a split", () => {
    const [before, after] = chapterParts(
      "&lt;img src=x onerror=alert(1)&gt;<p>first</p><p>second</p>&lt;script&gt;alert(2)&lt;/script&gt;<p>third</p>",
    );
    const first = documentOf(before);
    const second = documentOf(after);
    expect(first.querySelector("img")).toBeNull();
    expect(second.querySelector("script")).toBeNull();
    expect(first.body.textContent).toBe(
      "<img src=x onerror=alert(1)>firstsecond",
    );
    expect(second.body.textContent).toBe("<script>alert(2)</script>third");
    expect(first.querySelectorAll("p")).toHaveLength(2);
    expect(second.querySelectorAll("p")).toHaveLength(1);
  });

  it("removes a duplicate leading chapter heading by normalized text before splitting", () => {
    const parts = chapterParts(
      "\n<!-- chapter --><h1>第一章\n <mark>方法</mark></h1><p>一</p><p>二</p><p>三</p>",
      " 第一章 方法 ",
    );
    const document = documentOf(parts.join(""));
    expect(document.querySelector("h1")).toBeNull();
    expect(document.querySelectorAll("p")).toHaveLength(3);
    expect(documentOf(parts[0]).querySelectorAll("p")).toHaveLength(2);
  });

  it("removes a duplicate leading h2 even when there are too few paragraphs to split", () => {
    const [before, after] = chapterParts(
      "<section><h2>导论</h2><p>简介</p></section>",
      "导论",
    );
    expect(documentOf(before).querySelector("h2")).toBeNull();
    expect(documentOf(before).querySelector("section p")?.textContent).toBe(
      "简介",
    );
    expect(after).toBe("");
  });

  it("preserves unmatched subheadings and matching headings that are not leading", () => {
    const [before, after] = chapterParts(
      "<h2>背景</h2><p>一</p><h1>方法</h1><p>二</p><p>三</p>",
      "方法",
    );
    const document = documentOf(before + after);
    expect(document.querySelector("h2")?.textContent).toBe("背景");
    expect(document.querySelector("h1")?.textContent).toBe("方法");
    expect(documentOf(before).querySelectorAll("p")).toHaveLength(2);
  });

  it("unwraps a single container chain while retaining nested structure and text in split parts", () => {
    const [before, after] = chapterParts(
      '<article><section><div><h1>章节</h1>开场文字<p>一<strong>加粗</strong></p><p>二</p><figure><img src="blob:local"/><figcaption>原图注</figcaption></figure><p>三</p>结尾文字</div></section></article>',
      "章节",
    );
    expect(documentOf(before).body.textContent).toBe("开场文字一加粗二");
    expect(documentOf(before).querySelector("strong")?.textContent).toBe(
      "加粗",
    );
    expect(
      documentOf(after).querySelector("figure figcaption")?.textContent,
    ).toBe("原图注");
    expect(documentOf(after).body.textContent).toBe("原图注三结尾文字");
  });

  it("preserves meaningful text outside a container instead of dropping it while unwrapping", () => {
    const html = "前面的文字<div><p>一</p><p>二</p><p>三</p></div>后面的文字";
    const [before, after] = chapterParts(html);
    expect(documentOf(before + after).body.textContent).toBe(
      "前面的文字一二三后面的文字",
    );
    expect(before).toBe(html);
    expect(after).toBe("");
  });

  it("returns an unsplit chapter unchanged when no heading is removed", () => {
    const html =
      "<div>开始<p>one <em>inline</em></p><h3>Details</h3><p>two</p></div>";
    expect(chapterParts(html, "Other title")).toEqual([html, ""]);
  });
});

describe("highlightHtml", () => {
  it("highlights a phrase across inline elements while preserving its formatting and link", () => {
    const html =
      '<p>Read <a href="#context">information <em>processing</em></a> carefully.</p>';
    const document = documentOf(highlightHtml(html, "information processing"));
    const marks = Array.from(
      document.querySelectorAll('mark[data-search-match="0"]'),
    );
    expect(marks.map((mark) => mark.textContent).join("")).toBe(
      "information processing",
    );
    expect(marks).toHaveLength(2);
    expect(document.querySelector("a")?.getAttribute("href")).toBe("#context");
    expect(document.querySelector("a em mark")?.textContent).toBe("processing");
    expect(document.querySelector("p")?.textContent).toBe(
      "Read information processing carefully.",
    );
  });

  it("matches regex punctuation literally and case-insensitively in text nodes", () => {
    const document = documentOf(highlightHtml("<p>A+B? aab a+b?</p>", "a+b?"));
    expect(
      Array.from(document.querySelectorAll("mark")).map(
        (mark) => mark.textContent,
      ),
    ).toEqual(["A+B?", "a+b?"]);
    expect(document.querySelector("p")?.textContent).toBe("A+B? aab a+b?");
  });

  it("preserves escaped HTML special characters as text while highlighting them", () => {
    const document = documentOf(
      highlightHtml(
        "&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot;<p>safe</p>",
        "<img",
      ),
    );
    expect(document.querySelector("img,[onerror]")).toBeNull();
    expect(document.querySelector("mark")?.textContent).toBe("<img");
    expect(document.body.textContent).toBe(
      '<img src=x onerror=alert(1)> & "quoted"safe',
    );
  });

  it("ignores SVG, MathML, and style descendants while highlighting ordinary text only", () => {
    const document = documentOf(
      highlightHtml(
        '<p title="target">target</p><svg><text>target</text></svg><math><mi>target</mi></math><style>.target{color:red}</style>',
        "target",
      ),
    );
    expect(document.querySelectorAll("mark")).toHaveLength(1);
    expect(document.querySelector("p mark")?.textContent).toBe("target");
    expect(document.querySelector("p")?.getAttribute("title")).toBe("target");
    expect(document.querySelector("svg mark,math mark,style mark")).toBeNull();
    expect(document.querySelector("svg text")?.textContent).toBe("target");
    expect(document.querySelector("math mi")?.textContent).toBe("target");
  });

  it("returns the original HTML for empty or whitespace-only queries", () => {
    const html = '<p class="original">Text &amp; text</p>';
    expect(highlightHtml(html, "")).toBe(html);
    expect(highlightHtml(html, "   ")).toBe(html);
  });
});

describe("findHtmlMatches", () => {
  it("counts logical phrase matches instead of their individual highlight segments", () => {
    const html =
      "<p>Information <em>processing</em>; <strong>INFORMATION</strong> PROCESSING.</p><p>information processing</p>";
    expect(findHtmlMatches(html, "information processing")).toEqual([
      { id: 0, text: "Information processing" },
      { id: 1, text: "INFORMATION PROCESSING" },
      { id: 2, text: "information processing" },
    ]);
    const document = documentOf(highlightHtml(html, "information processing"));
    const marks = Array.from(
      document.querySelectorAll("mark[data-search-match]"),
    );
    expect(marks).toHaveLength(5);
    expect([
      ...new Set(marks.map((mark) => mark.getAttribute("data-search-match"))),
    ]).toEqual(["0", "1", "2"]);
  });

  it("does not join phrases across paragraphs, nested blocks, table cells, or line breaks", () => {
    const html =
      "<p>information</p><p> processing</p><div>information<section> processing</section></div><table><tbody><tr><td>information</td><td> processing</td></tr></tbody></table><p>information<br> processing</p>";
    expect(findHtmlMatches(html, "information processing")).toEqual([]);
    expect(
      documentOf(highlightHtml(html, "information processing")).querySelector(
        "mark",
      ),
    ).toBeNull();
  });

  it("excludes SVG, MathML, style, and script text without joining text on either side", () => {
    const html =
      "<p>target</p><svg><text>target</text></svg><math><mi>target</mi></math><style>.target{color:red}</style><script>target</script><p>information<svg><text>ignored</text></svg> processing</p><p>information<math><mi>ignored</mi></math> processing</p><p>information<script>ignored</script> processing</p><p>information<style>.ignored{}</style> processing</p>";
    expect(findHtmlMatches(html, "target")).toEqual([
      { id: 0, text: "target" },
    ]);
    expect(findHtmlMatches(html, "information processing")).toEqual([]);
    const document = documentOf(highlightHtml(html, "target"));
    expect(document.querySelectorAll("mark")).toHaveLength(1);
    expect(
      document.querySelector("svg mark,math mark,style mark,script mark"),
    ).toBeNull();
  });

  it("retains escaped HTML as ordinary searchable text across inline elements", () => {
    const html =
      "<p>&lt;img <em>src=x</em> onerror=alert(1)&gt; &amp; safe</p>";
    const query = "<img src=x onerror=alert(1)>";
    expect(findHtmlMatches(html, query)).toEqual([{ id: 0, text: query }]);
    const document = documentOf(highlightHtml(html, query));
    expect(document.querySelector("img,[onerror],script")).toBeNull();
    expect(document.querySelector("p")?.textContent).toBe(
      "<img src=x onerror=alert(1)> & safe",
    );
    expect(
      Array.from(document.querySelectorAll("mark"))
        .map((mark) => mark.textContent)
        .join(""),
    ).toBe(query);
  });

  it("matches literal punctuation and preserves offsets after Unicode case changes", () => {
    const html = "<p>İ A<em>+B?</em> a+b?</p>";
    expect(findHtmlMatches(html, "a+b?")).toEqual([
      { id: 0, text: "A+B?" },
      { id: 1, text: "a+b?" },
    ]);
    const document = documentOf(highlightHtml(html, "a+b?"));
    expect(
      Array.from(document.querySelectorAll('[data-search-match="0"]'))
        .map((mark) => mark.textContent)
        .join(""),
    ).toBe("A+B?");
    expect(document.querySelector("p")?.textContent).toBe("İ A+B? a+b?");
  });

  it("counts non-overlapping occurrences and handles trimmed or empty queries consistently", () => {
    const html = "<p>ba<strong>na</strong>nana</p>";
    expect(findHtmlMatches(html, "ana")).toEqual([
      { id: 0, text: "ana" },
      { id: 1, text: "ana" },
    ]);
    expect(findHtmlMatches(html, "  ana  ")).toEqual(
      findHtmlMatches(html, "ana"),
    );
    expect(findHtmlMatches(html, " \n ")).toEqual([]);
    expect(highlightHtml(html, "  ana  ")).toBe(highlightHtml(html, "ana"));
  });
});
