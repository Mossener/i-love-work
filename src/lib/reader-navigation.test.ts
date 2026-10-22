import { describe, expect, it } from "vitest";
import { stampReadingAnchors } from "./reading-position";
import { findChapterFragment, progressToPage, pageToProgress, readReadingProgress, writeReadingProgress } from "./reader-navigation";

describe("reader navigation", () => {
  it("resolves duplicate source IDs only within the requested chapter", () => {
    const root = document.createElement("div");
    root.innerHTML = stampReadingAnchors([
      { chapterIndex: 0, html: '<p id="note">First note</p>' },
      { chapterIndex: 1, html: '<p id="note">Second note</p>' },
    ]).map(block => block.html).join("");
    expect(findChapterFragment(root, 1, "note")?.textContent).toBe("Second note");
    expect(findChapterFragment(root, 9, "note")).toBeNull();
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
