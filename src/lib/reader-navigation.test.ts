import { describe, expect, it } from "vitest";
import { stampReadingAnchors } from "./reading-position";
import { findChapterFragment, findChapterTarget, pageHorizontalScroll, progressToPage, pageToProgress, readReadingProgress, writeReadingProgress } from "./reader-navigation";

describe("reader navigation", () => {
  it("brings a right-hand page into view when a zoomed spread overflows horizontally", () => {
    const root = document.createElement("div");
    root.style.paddingLeft = "18px";
    root.innerHTML = '<article data-page-index="1"></article>';
    root.getBoundingClientRect = () => ({ left: 262, right: 1440 } as DOMRect);
    const frame = root.firstElementChild as HTMLElement;
    frame.getBoundingClientRect = () => ({ left: 1880, right: 3468 } as DOMRect);
    expect(pageHorizontalScroll(root, 1)).toBe(1600);
    root.scrollLeft = 1600;
    frame.getBoundingClientRect = () => ({ left: 280, right: 1868 } as DOMRect);
    expect(pageHorizontalScroll(root, 1)).toBe(1600);
    frame.getBoundingClientRect = () => ({ left: 280, right: 840 } as DOMRect);
    expect(pageHorizontalScroll(root, 1)).toBe(1600);
    expect(pageHorizontalScroll(root, 99)).toBe(1600);
  });
  it("resolves duplicate source IDs only within the requested chapter", () => {
    const root = document.createElement("div");
    root.innerHTML = stampReadingAnchors([
      { chapterIndex: 0, html: '<p id="note">First note</p>' },
      { chapterIndex: 1, html: '<p id="note">Second note</p>' },
    ]).map(block => block.html).join("");
    expect(findChapterFragment(root, 1, "note")?.textContent).toBe("Second note");
    expect(findChapterFragment(root, 9, "note")).toBeNull();
  });

  it("targets a chapter's heading rather than the preceding chapter on its shared page", () => {
    const root = document.createElement("div");
    root.innerHTML = '<article data-page-index="4"><p>End of the previous chapter</p><h2 data-pdf-chapter="2">New chapter</h2><p id="note" data-source-chapter="2">Footnote destination</p></article>';
    expect(findChapterTarget(root, 2)?.textContent).toBe("New chapter");
    expect(findChapterTarget(root, 2, "note")?.textContent).toBe("Footnote destination");
    expect(findChapterTarget(root, 2, "missing")?.textContent).toBe("New chapter");
    expect(findChapterTarget(root, 8)).toBeNull();
  });

  it("uses an original source heading when no generated chapter heading remains", () => {
    const root = document.createElement("div");
    root.innerHTML = '<h2 data-source-chapter="0">Previous chapter</h2><h3 data-source-chapter="1">Source chapter heading</h3><p data-source-chapter="1">Source prose</p>';
    expect(findChapterTarget(root, 1)?.textContent).toBe("Source chapter heading");
  });

  it("maps the ends of a progress slider to valid pages, including a single page", () => {
    expect(progressToPage(0, 30)).toBe(0);
    expect(progressToPage(100, 30)).toBe(29);
    expect(progressToPage(50, 31)).toBe(15);
    expect(progressToPage(-20, 30)).toBe(0);
    expect(progressToPage(Number.NaN, 30)).toBe(0);
    expect(progressToPage(50, 1)).toBe(0);
    expect(pageToProgress(29, 30)).toBe(100);
  });

  it("saves each book's precise position independently and tolerates damaged storage", () => {
    localStorage.clear();
    const progress = { page: 4, chapterIndex: 2, percent: 38, updatedAt: 100, anchor: { id: "c2-b9-n0", offset: 73, viewportY: 18 } };
    expect(writeReadingProgress("alpha", progress)).toBe(true);
    expect(readReadingProgress("alpha")).toEqual(progress);
    expect(readReadingProgress("beta")).toBeNull();
    localStorage.setItem("paper-pdf-progress:alpha", '{"anchor":{"id":7}}');
    expect(readReadingProgress("alpha")).toBeNull();
  });

  it("clears a stale legacy text anchor when the newest position has no prose anchor", () => {
    const anchored = { page: 4, chapterIndex: 2, percent: 38, updatedAt: 100, anchor: { id: "c2-b9-n0", offset: 73, viewportY: 18 } };
    const blank = { ...anchored, page: 5, percent: 44, updatedAt: 200, anchor: null };
    expect(writeReadingProgress("alpha", anchored)).toBe(true);
    expect(localStorage.getItem("paper-pdf-anchor:alpha")).toContain("c2-b9-n0");
    expect(writeReadingProgress("alpha", blank)).toBe(true);
    expect(localStorage.getItem("paper-pdf-anchor:alpha")).toBeNull();
  });
});
