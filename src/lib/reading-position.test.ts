import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  stampReadingAnchors,
  captureReadingAnchor,
  restoreReadingAnchor,
} from "./reading-position";
import { splitElementAtTextOffset } from "./pagination";

function el(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
beforeAll(() => {
  if (!Range.prototype.getBoundingClientRect)
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      value: () => new DOMRect(),
      configurable: true,
      writable: true,
    });
});

describe("reading anchors", () => {
  it("stamps stable distinct prose identities before pictures are removed", () => {
    const source = [
      {
        chapterIndex: 2,
        html: "<section><p>Repeated text</p><figure><svg><text>Figure label</text></svg><figcaption>Caption</figcaption></figure><p>Repeated text</p></section>",
      },
    ];
    const first = stampReadingAnchors(source);
    const second = stampReadingAnchors(source);
    expect(first).toEqual(second);
    const stamped = el(first.map((block) => block.html).join(""));
    const anchors = [
      ...stamped.querySelectorAll<HTMLElement>("[data-reading-anchor]"),
    ];
    expect(anchors.map((node) => node.textContent)).toEqual([
      "Repeated text",
      "Repeated text",
    ]);
    expect(
      new Set(anchors.map((node) => node.dataset.readingAnchor)).size,
    ).toBe(2);
    expect(anchors.every((node) => node.dataset.readingStart === "0")).toBe(
      true,
    );
    expect(source[0].html).not.toContain("data-reading-anchor");
    stamped.querySelectorAll("figure").forEach((node) => node.remove());
    expect(stamped.querySelectorAll("[data-reading-anchor]")).toHaveLength(2);
  });

  it("retains source character offsets across repeated paragraph splits", () => {
    const source = el(
      stampReadingAnchors([
        { chapterIndex: 0, html: "<p>abc<em>def</em>ghijkl</p>" },
      ])[0].html,
    ).firstElementChild as HTMLElement;
    const [head, tail] = splitElementAtTextOffset(source, 5);
    const [middle, last] = splitElementAtTextOffset(tail, 3);
    expect(head.dataset.readingStart).toBe("0");
    expect(tail.dataset.readingStart).toBe("5");
    expect(middle.dataset.readingStart).toBe("5");
    expect(last.dataset.readingStart).toBe("8");
    expect(last.dataset.readingAnchor).toBe(head.dataset.readingAnchor);
    expect(head.textContent! + middle.textContent! + last.textContent!).toBe(
      "abcdefghijkl",
    );
  });

  it("anchors native prose inside figures while excluding captions and generated figure text", () => {
    const stamped = stampReadingAnchors([{
      chapterIndex: 0,
      html: '<figure><p>Original prose.</p><img src="blob:x"><figcaption><p>Image caption.</p></figcaption></figure><figure class="pdf-generated-figure"><p>Generated explanation.</p></figure><p>Following prose.</p>',
    }]);
    const root = el(stamped.map(block => block.html).join(""));
    expect([...root.querySelectorAll('[data-reading-anchor]')].map(node => node.textContent)).toEqual([
      "Original prose.", "Following prose.",
    ]);
  });

  it("counts retained native figure prose when a list item continues after a figure", () => {
    const source = el(stampReadingAnchors([{
      chapterIndex: 0,
      html: '<li>ab<figure><p>cd</p><img src="blob:x"><figcaption>caption</figcaption></figure>efgh</li>',
    }])[0].html).firstElementChild as HTMLElement;
    const [, tail] = splitElementAtTextOffset(source, 11);
    expect(tail.textContent).toBe("efgh");
    expect(tail.dataset.readingStart).toBe("4");
  });

  it("updates crossed nested anchors without shifting complete paragraphs", () => {
    const source = el(
      stampReadingAnchors([
        {
          chapterIndex: 0,
          html: "<blockquote><p>abcdef</p><p>ghijkl</p></blockquote>",
        },
      ])[0].html,
    ).firstElementChild as HTMLElement;
    const [, tail] = splitElementAtTextOffset(source, 3);
    expect(
      [...tail.querySelectorAll<HTMLElement>("[data-reading-anchor]")].map(
        (node) => node.dataset.readingStart,
      ),
    ).toEqual(["3", "0"]);
    const [, last] = splitElementAtTextOffset(tail, 3);
    expect(last.querySelector<HTMLElement>("p")?.dataset.readingStart).toBe(
      "0",
    );
  });

  it("does not include SVG labels in continued source text offsets", () => {
    const source = el(
      stampReadingAnchors([
        {
          chapterIndex: 0,
          html: "<p>before<svg><text>diagram</text></svg>after</p>",
        },
      ])[0].html,
    ).firstElementChild as HTMLElement;
    const [, tail] = splitElementAtTextOffset(source, 13);
    expect(tail.dataset.readingStart).toBe("6");
  });

  it("restores the same source character onto its new page and vertical position", () => {
    const viewport = el(
      '<div data-page-index="3"><p data-reading-anchor="same" data-reading-start="0">abcdef</p></div><div data-page-index="4"><p data-reading-anchor="same" data-reading-start="6">ghijkl</p></div>',
    );
    document.body.append(viewport);
    viewport.scrollTop = 1200;
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
      top: 40,
      left: 0,
      right: 600,
      bottom: 840,
      width: 600,
      height: 800,
    } as DOMRect);
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Range) {
        return {
          top: this.startContainer.textContent?.startsWith("gh") ? 270 : 100,
          bottom: 290,
          left: 30,
          right: 45,
          width: 15,
          height: 20,
        } as DOMRect;
      },
    );
    expect(
      restoreReadingAnchor(viewport, { id: "same", offset: 8, viewportY: 15 }),
    ).toBe(4);
    expect(viewport.scrollTop).toBe(1415);
  });

  it("chooses the continuation at an exact source seam and ignores missing targets", () => {
    const viewport = el(
      '<div data-page-index="1"><p data-reading-anchor="x" data-reading-start="0">abc</p></div><div data-page-index="2"><p data-reading-anchor="x" data-reading-start="3">def</p></div>',
    );
    document.body.append(viewport);
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 500,
      left: 0,
      right: 500,
    } as DOMRect);
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 120,
      left: 20,
      right: 30,
      width: 10,
      height: 20,
    } as DOMRect);
    expect(
      restoreReadingAnchor(viewport, { id: "x", offset: 3, viewportY: 0 }),
    ).toBe(2);
    expect(
      restoreReadingAnchor(viewport, {
        id: "missing",
        offset: 3,
        viewportY: 0,
      }),
    ).toBeNull();
  });

  it("captures text on the selected spread page instead of a figure or duplicate prose", () => {
    const viewport = el(
      '<div data-page-index="0"><p data-reading-anchor="left" data-reading-start="0">left text</p></div><div data-page-index="1"><figure>chart</figure><p data-reading-anchor="right" data-reading-start="20">right text</p></div>',
    );
    document.body.append(viewport);
    viewport.dataset.readingCurrentPage = "1";
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
      top: 40,
      bottom: 800,
      left: 0,
      right: 1000,
    } as DOMRect);
    viewport.querySelectorAll<HTMLElement>("p").forEach((node) =>
      vi.spyOn(node, "getBoundingClientRect").mockReturnValue({
        top: 45,
        bottom: 65,
        left: node.dataset.readingAnchor === "right" ? 550 : 50,
        right: 650,
        height: 20,
      } as DOMRect),
    );
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue({
      top: 45,
      bottom: 65,
      left: 550,
      right: 560,
      width: 10,
      height: 20,
    } as DOMRect);
    expect(captureReadingAnchor(viewport)).toEqual({
      id: "right",
      offset: 20,
      viewportY: 5,
    });
  });

  it("captures the first visible line inside a paragraph spanning above the viewport", () => {
    const viewport = el(
      '<div data-page-index="8"><p data-reading-anchor="paragraph" data-reading-start="50">abcdefghijklmnopqrst</p></div>',
    );
    document.body.append(viewport);
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
      top: 40,
      bottom: 600,
      left: 0,
      right: 800,
    } as DOMRect);
    vi.spyOn(
      viewport.querySelector("p")!,
      "getBoundingClientRect",
    ).mockReturnValue({ top: 10, bottom: 70, left: 40, right: 700 } as DOMRect);
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Range) {
        const top = 10 + Math.floor(this.startOffset / 5) * 15;
        return {
          top,
          bottom: top + 15,
          left: 40,
          right: 50,
          width: 10,
          height: 15,
        } as DOMRect;
      },
    );
    expect(captureReadingAnchor(viewport)).toEqual({
      id: "paragraph",
      offset: 60,
      viewportY: 0,
    });
  });

  it("anchors the nearest following prose when the viewport contains only an image", () => {
    const viewport = el(
      '<header><p>Unstamped journal header</p></header><div data-page-index="2"><p data-reading-anchor="before" data-reading-start="30">before</p><figure><img src="picture.png"><figcaption><p data-reading-anchor="caption">Ignore caption</p></figcaption></figure><p data-reading-anchor="after" data-reading-start="60">after</p></div>',
    );
    document.body.append(viewport);
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
      top: 40,
      bottom: 600,
      left: 0,
      right: 800,
    } as DOMRect);
    viewport
      .querySelectorAll<HTMLElement>("[data-reading-anchor]")
      .forEach((node) => {
        const top =
          node.dataset.readingAnchor === "before"
            ? -150
            : node.dataset.readingAnchor === "caption"
              ? 100
              : 650;
        vi.spyOn(node, "getBoundingClientRect").mockReturnValue({
          top,
          bottom: top + 20,
          left: 40,
          right: 700,
          height: 20,
        } as DOMRect);
      });
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Range) {
        const top =
          this.startContainer.parentElement?.dataset.readingAnchor === "before"
            ? -150
            : 650;
        return {
          top,
          bottom: top + 20,
          left: 40,
          right: 50,
          height: 20,
        } as DOMRect;
      },
    );
    expect(captureReadingAnchor(viewport)).toEqual({
      id: "after",
      offset: 60,
      viewportY: 540,
    });
    expect(captureReadingAnchor(viewport, { nearest: false })).toBeNull();
  });

  it("anchors the last preceding character when it is nearest to a blank viewport", () => {
    const viewport = el(
      '<div data-page-index="3"><p data-reading-anchor="before" data-reading-start="20">before</p><p data-reading-anchor="after" data-reading-start="60">after</p></div>',
    );
    document.body.append(viewport);
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
      top: 40,
      bottom: 600,
      left: 0,
      right: 800,
    } as DOMRect);
    viewport.querySelectorAll<HTMLElement>("p").forEach((node) => {
      const top = node.dataset.readingAnchor === "before" ? -20 : 900;
      vi.spyOn(node, "getBoundingClientRect").mockReturnValue({
        top,
        bottom: top + 20,
        left: 40,
        right: 700,
        height: 20,
      } as DOMRect);
    });
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Range) {
        const top =
          this.startContainer.parentElement?.dataset.readingAnchor === "before"
            ? -20
            : 900;
        return {
          top,
          bottom: top + 20,
          left: 40,
          right: 50,
          height: 20,
        } as DOMRect;
      },
    );
    expect(captureReadingAnchor(viewport)).toEqual({
      id: "before",
      offset: 25,
      viewportY: 0,
    });
  });
});
