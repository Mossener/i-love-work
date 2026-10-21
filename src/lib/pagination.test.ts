import { describe, expect, it } from "vitest";
import {
  normalizeBlocks,
  paginateBlocks,
  splitElementAtTextOffset,
} from "./pagination";

function element(html: string) {
  const container = document.createElement("template");
  container.innerHTML = html;
  return container.content.firstElementChild as HTMLElement;
}

describe("splitElementAtTextOffset", () => {
  it("retains escaped text and inline markup on both sides of a split", () => {
    const source = element(
      '<p id="paragraph" lang="zh"><em class="term">A &amp; &lt;B&gt;</em> 中文<strong data-note="kept">后文</strong></p>',
    );
    const original = source.outerHTML;
    const [head, tail] = splitElementAtTextOffset(source, 5);

    expect(head.textContent).toBe("A & <");
    expect(tail.textContent).toBe("B> 中文后文");
    expect(head.querySelector("em")?.className).toBe("term");
    expect(tail.querySelector("em")?.className).toBe("term");
    expect(tail.querySelector("strong")?.dataset.note).toBe("kept");
    expect(head.innerHTML).toContain("&lt;");
    expect(tail.querySelector("b")).toBeNull();
    expect(head.lang).toBe("zh");
    expect(tail.lang).toBe("zh");
    expect(tail.classList.contains("pdf-continuation")).toBe(true);
    expect(source.outerHTML).toBe(original);
  });

  it("keeps every Unicode character and never divides a surrogate pair", () => {
    const source = element("<p>A😀中𠀀Z</p>");
    for (let offset = 0; offset <= source.textContent!.length; offset++) {
      const [head, tail] = splitElementAtTextOffset(source, offset);
      expect(head.textContent! + tail.textContent!).toBe(source.textContent);
      expect(head.textContent).not.toMatch(/[\uD800-\uDBFF]$/u);
      expect(tail.textContent).not.toMatch(/^[\uDC00-\uDFFF]/u);
    }
    const [head, tail] = splitElementAtTextOffset(source, 2);
    expect(head.textContent).toBe("A");
    expect(tail.textContent).toBe("😀中𠀀Z");
  });

  it("retains each ID once while keeping anchors wholly within the tail", () => {
    const source = element(
      '<p id="root"><em id="crossing">abcdef</em><a id="later" href="#root">gh</a></p>',
    );
    const [head, tail] = splitElementAtTextOffset(source, 3);
    expect(head.id).toBe("root");
    expect(tail.hasAttribute("id")).toBe(false);
    expect(head.querySelector("em")?.id).toBe("crossing");
    expect(tail.querySelector("em")?.hasAttribute("id")).toBe(false);
    expect(tail.querySelector("a")?.id).toBe("later");
    expect(tail.querySelector("a")?.getAttribute("href")).toBe("#root");
    const [empty, complete] = splitElementAtTextOffset(source, 0);
    expect(empty.hasAttribute("id")).toBe(false);
    expect(complete.id).toBe("root");
  });

  it("does not leave empty paragraphs when splitting between complete paragraphs", () => {
    const source = element(
      "<blockquote><p>first</p><p>second</p></blockquote>",
    );
    const [head, tail] = splitElementAtTextOffset(source, 5);
    expect(head.innerHTML).toBe("<p>first</p>");
    expect(tail.innerHTML).toBe("<p>second</p>");
  });

  it("keeps a nested SVG atomic rather than splitting its text label", () => {
    const source = element(
      '<blockquote><p>before</p><svg viewBox="0 0 10 10"><text>diagram</text></svg><p>after</p></blockquote>',
    );
    const [head, tail] = splitElementAtTextOffset(source, 9);
    expect(head.textContent).toBe("before");
    expect(head.querySelector("svg")).toBeNull();
    expect(tail.querySelector("svg text")?.textContent).toBe("diagram");
    expect(head.textContent! + tail.textContent!).toBe(source.textContent);
  });

  it("can end a page after a complete nested SVG label", () => {
    const source = element(
      "<blockquote><svg><text>diagram</text></svg><p>after</p></blockquote>",
    );
    const [head, tail] = splitElementAtTextOffset(source, 7);
    expect(head.querySelector("svg text")?.textContent).toBe("diagram");
    expect(tail.innerHTML).toBe("<p>after</p>");
  });

  it("keeps the entire figure together when a nested SVG has its own text", () => {
    const source = element(
      "<blockquote><p>before</p><figure><svg><text>diagram</text></svg><figcaption>caption</figcaption></figure><p>after</p></blockquote>",
    );
    const [head, tail] = splitElementAtTextOffset(source, 10);
    expect(head.querySelector("figure")).toBeNull();
    expect(tail.querySelector("figure svg text")?.textContent).toBe("diagram");
    expect(tail.querySelector("figcaption")?.textContent).toBe("caption");
    expect(head.textContent! + tail.textContent!).toBe(source.textContent);
  });

  it("continues ordered lists without repeating the partial item's marker", () => {
    const source = element(
      '<ol start="4"><li>first</li><li>second <em>item</em></li><li>third</li></ol>',
    );
    const [head, tail] = splitElementAtTextOffset(source, 9);
    expect(head.textContent! + tail.textContent!).toBe(source.textContent);
    expect(tail.getAttribute("start")).toBe("5");
    expect(tail.querySelector("li")?.style.listStyleType).toBe("none");
    expect(tail.querySelectorAll("li")[1].style.listStyleType).toBe("");
  });
});

describe("normalizeBlocks", () => {
  it("unwraps nested chapter containers while preserving headings, figures, and chapters", () => {
    const blocks = normalizeBlocks([
      {
        chapterIndex: 2,
        html: '<article lang="zh"><section><div><h1 id="title">论文标题</h1><p>正文 &lt;标签&gt;</p><figure><img src="blob:figure"/><figcaption>图一</figcaption></figure></div></section></article>',
      },
      { chapterIndex: 3, html: "<main><h2>下一章</h2><p>下一段</p></main>" },
    ]);

    expect(blocks.map((block) => element(block.html).tagName)).toEqual([
      "H1",
      "P",
      "FIGURE",
      "H2",
      "P",
    ]);
    expect(blocks.map((block) => block.chapterIndex)).toEqual([2, 2, 2, 3, 3]);
    expect(element(blocks[0].html).id).toBe("title");
    expect(element(blocks[1].html).textContent).toBe("正文 <标签>");
    expect(element(blocks[1].html).lang).toBe("zh");
    expect(
      element(blocks[2].html).querySelector("figcaption")?.textContent,
    ).toBe("图一");
  });

  it("groups meaningful standalone text and inline siblings into a paragraph", () => {
    const blocks = normalizeBlocks([
      {
        chapterIndex: 0,
        html: "  Hello &amp; <em>world</em>!<div>独立文字 <strong>粗体</strong></div><p>末段</p>  ",
      },
    ]);
    expect(blocks).toHaveLength(3);
    expect(element(blocks[0].html).tagName).toBe("P");
    expect(element(blocks[0].html).textContent).toBe("  Hello & world!");
    expect(element(blocks[1].html).textContent).toBe("独立文字 粗体");
    expect(element(blocks[1].html).querySelector("strong")?.textContent).toBe(
      "粗体",
    );
  });

  it("preserves wrapper link targets even when the first heading has its own ID", () => {
    const blocks = normalizeBlocks([
      {
        chapterIndex: 0,
        html: '<section id="chapter"><h1 id="heading">Title</h1><p>Text</p></section>',
      },
    ]);
    const document = new DOMParser().parseFromString(
      blocks.map((block) => block.html).join(""),
      "text/html",
    );
    expect(document.getElementById("chapter")).not.toBeNull();
    expect(document.getElementById("heading")?.textContent).toBe("Title");
  });

  it("leaves semantic lists and quotations together and skips empty containers", () => {
    const blocks = normalizeBlocks([
      {
        chapterIndex: 0,
        html: "<div>  </div><section><ul><li>one</li><li>two</li></ul><blockquote><p>quote</p></blockquote></section>",
      },
    ]);
    expect(blocks.map((block) => element(block.html).tagName)).toEqual([
      "UL",
      "BLOCKQUOTE",
    ]);
    expect(element(blocks[0].html).querySelectorAll("li")).toHaveLength(2);
  });

  it("preserves the academic abstract and keyword layout containers", () => {
    const blocks = normalizeBlocks([
      {
        chapterIndex: 0,
        html: '<section class="pdf-abstract"><strong>摘要</strong><div>研究摘要。</div></section><div class="pdf-keywords"><strong>关键词：</strong> 研究；分析</div>',
      },
    ]);
    expect(blocks).toHaveLength(2);
    expect(element(blocks[0].html).className).toBe("pdf-abstract");
    expect(element(blocks[0].html).querySelector("div")?.textContent).toBe(
      "研究摘要。",
    );
    expect(element(blocks[1].html).className).toBe("pdf-keywords");
    expect(element(blocks[1].html).textContent).toBe("关键词： 研究；分析");
  });
});

describe("paginateBlocks lifecycle", () => {
  it("returns no blank page for an empty document", async () => {
    expect(await paginateBlocks([])).toEqual([]);
    expect(document.querySelector(".pdf-measure")).toBeNull();
  });

  it("honors an already-aborted signal without leaving measurement DOM behind", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      paginateBlocks([{ html: "<p>text</p>", chapterIndex: 0 }], {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(document.querySelector(".pdf-measure")).toBeNull();
  });

  it("cleans up measurement DOM when canceled from a progress callback", async () => {
    const controller = new AbortController();
    await expect(
      paginateBlocks([{ html: "<p>text</p>", chapterIndex: 0 }], {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(document.querySelector(".pdf-measure")).toBeNull();
  });
});
