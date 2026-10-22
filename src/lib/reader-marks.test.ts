import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyMarksToHtml,
  captureTextSelection,
  createBookmark,
  createHighlight,
  exportMarksMarkdown,
  importMarks,
  readMarks,
  serializeMarks,
  writeMarks,
  MAX_MARKS_BACKUP_BYTES,
  type ReaderMark,
} from "./reader-marks";

function viewport(html: string) {
  const root = document.createElement("div");
  root.innerHTML = `<div class="pdf-page-body">${html}</div>`;
  document.body.append(root);
  return root;
}

function select(start: Node, startOffset: number, end: Node, endOffset: number) {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

function highlight(change: Partial<ReaderMark> = {}): ReaderMark {
  return {
    id: "mark-1",
    kind: "highlight",
    anchor: { id: "a", offset: 2, viewportY: 24 },
    chapterIndex: 0,
    quote: "cdefgh",
    note: "",
    color: "yellow",
    createdAt: 1700000000000,
    ranges: [{ anchorId: "a", start: 2, end: 8 }],
    ...change,
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

describe("reader marks", () => {
  it("captures a selection across inline markup and a second paragraph without counting nested anchors twice", () => {
    const root = viewport('<li data-reading-anchor="list" data-reading-start="0"><p data-reading-anchor="a" data-reading-start="0">ab<em>cde</em>f</p><p data-reading-anchor="b" data-reading-start="5">ghij</p></li>');
    const a = root.querySelector("p")!.firstChild!;
    const b = root.querySelectorAll("p")[1].firstChild!;
    const selected = captureTextSelection(root, select(a, 1, b, 3));
    expect(selected?.quote).toBe("bcdef\nghi");
    expect(selected?.ranges).toEqual([
      { anchorId: "a", start: 1, end: 6 },
      { anchorId: "b", start: 5, end: 8 },
    ]);
    expect(selected?.anchor).toEqual({ id: "a", offset: 1, viewportY: 24 });
  });

  it("retains absolute source offsets when the selected text spans continued pages", () => {
    const root = viewport('<p data-reading-anchor="a" data-reading-start="0">abcd</p><p data-reading-anchor="a" data-reading-start="4">efgh</p>');
    const paragraphs = root.querySelectorAll("p");
    const selected = captureTextSelection(root, select(paragraphs[0].firstChild!, 2, paragraphs[1].firstChild!, 2));
    expect(selected?.quote).toBe("cdef");
    expect(selected?.ranges).toEqual([{ anchorId: "a", start: 2, end: 6 }]);
  });

  it("respects element child boundaries without including adjacent text", () => {
    const root = viewport('<p data-reading-anchor="a">before<em>middle</em>after</p>');
    const paragraph = root.querySelector("p")!;
    const selected = captureTextSelection(root, select(paragraph, 1, paragraph, 2));
    expect(selected?.quote).toBe("middle");
    expect(selected?.ranges).toEqual([{ anchorId: "a", start: 6, end: 12 }]);
  });

  it("excludes generated figures, captions and page furniture from a selection", () => {
    const root = viewport('<p data-reading-anchor="a">before</p><figure class="pdf-generated-figure"><p data-reading-anchor="chart">generated label</p></figure><figure><figcaption data-reading-anchor="caption">caption</figcaption><p data-reading-anchor="b">original</p></figure><footer class="pdf-page-footer" data-reading-anchor="footer">2</footer>');
    const before = root.querySelector("p")!.firstChild!;
    const after = root.querySelector('[data-reading-anchor="b"]')!.firstChild!;
    const selected = captureTextSelection(root, select(before, 0, after, 8));
    expect(selected?.quote).toBe("before\noriginal");
    expect(selected?.ranges.map(range => range.anchorId)).toEqual(["a", "b"]);
  });

  it("ignores empty selections, selections outside the book and overlong selections", () => {
    const root = viewport('<p data-reading-anchor="a">text</p>');
    expect(captureTextSelection(root, window.getSelection())).toBeNull();
    const outside = document.createElement("p");
    outside.textContent = "outside";
    document.body.append(outside);
    expect(captureTextSelection(root, select(outside.firstChild!, 0, outside.firstChild!, 4))).toBeNull();
    root.querySelector("p")!.textContent = "x".repeat(12001);
    const text = root.querySelector("p")!.firstChild!;
    expect(captureTextSelection(root, select(text, 0, text, 12001))).toBeNull();
  });

  it("renders a saved highlight across page continuations and inline tags without changing prose", () => {
    const original = '<p data-reading-anchor="a" data-reading-start="0">ab<em>cd</em></p><p data-reading-anchor="a" data-reading-start="4">efghij</p>';
    const shown = document.createElement("div");
    shown.innerHTML = applyMarksToHtml(original, [highlight()]);
    expect(shown.textContent).toBe("abcdefghij");
    expect([...shown.querySelectorAll(".reader-highlight")].map(node => node.textContent).join("")).toBe("cdefgh");
    expect(shown.querySelector("em .reader-highlight")?.textContent).toBe("cd");
    expect(shown.querySelectorAll('[data-reader-mark="mark-1"]')).toHaveLength(2);
    expect(original).not.toContain("reader-highlight");
  });

  it("uses the newest overlapping mark while retaining all source characters", () => {
    const shown = document.createElement("div");
    shown.innerHTML = applyMarksToHtml('<p data-reading-anchor="a">abcdefghij</p>', [highlight(), highlight({ id: "new", color: "blue", createdAt: 1800000000000, ranges: [{ anchorId: "a", start: 4, end: 6 }] })]);
    expect(shown.textContent).toBe("abcdefghij");
    expect(shown.querySelector('[data-reader-mark="new"]')?.textContent).toBe("ef");
    expect([...shown.querySelectorAll('[data-reader-mark="mark-1"]')].map(node => node.textContent).join("")).toBe("cdgh");
  });

  it("keeps parent anchor offsets aligned around nested source anchors", () => {
    const source = '<li data-reading-anchor="list">ab<p data-reading-anchor="a">cdef</p>ghij</li>';
    const root = viewport(source);
    const list = root.querySelector("li")!;
    const captured = captureTextSelection(root, select(list.firstChild!, 1, list.lastChild!, 2))!;
    expect(captured.quote).toBe("b\ncdef\ngh");
    expect(captured.ranges).toEqual([
      { anchorId: "list", start: 1, end: 2 },
      { anchorId: "a", start: 0, end: 4 },
      { anchorId: "list", start: 6, end: 8 },
    ]);
    const shown = document.createElement("div");
    shown.innerHTML = applyMarksToHtml(source, [createHighlight(captured, 0)]);
    expect(shown.textContent).toBe("abcdefghij");
    expect([...shown.querySelectorAll(".reader-highlight")].map(node => node.textContent).join("")).toBe("bcdefgh");
    expect(shown.querySelector("p .reader-highlight")?.textContent).toBe("cdef");
  });

  it("persists separate books and recovers safely from malformed storage", () => {
    const bookmark = createBookmark({ id: "b", offset: 4, viewportY: -3 }, 2, "Read here");
    expect(writeMarks("one", [bookmark, highlight()])).toBe(true);
    expect(readMarks("one")).toEqual([bookmark, highlight()]);
    expect(readMarks("two")).toEqual([]);
    localStorage.setItem("paper-pdf-marks:two", "{broken");
    expect(readMarks("two")).toEqual([]);
    localStorage.setItem("paper-pdf-marks:two", JSON.stringify([{ ...highlight(), anchor: { id: "a", offset: -2, viewportY: 0 } }, { ...highlight(), id: "valid", color: "javascript:bad" }]));
    expect(readMarks("two")).toEqual([{ ...highlight(), id: "valid", color: "yellow" }]);
  });

  it("reports a failed write without discarding the caller's in-memory annotations", () => {
    const source = [highlight()];
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    expect(writeMarks("one", source)).toBe(false);
    expect(source).toEqual([highlight()]);
  });

  it("creates a highlight from a valid captured source selection", () => {
    const selection = { quote: "sample", anchor: { id: "a", offset: 2, viewportY: 24 }, ranges: [{ anchorId: "a", start: 2, end: 8 }] };
    const mark = createHighlight(selection, 3, "green");
    expect(mark).toMatchObject({ ...selection, kind: "highlight", chapterIndex: 3, color: "green", note: "" });
    expect(mark.id).toBeTruthy();
    expect(mark.createdAt).toBeGreaterThan(0);
  });

  it("round-trips a backup, merges without duplicate IDs and rejects a different book", () => {
    const current = highlight({ note: "local note" });
    const second = highlight({ id: "second" });
    const backup = serializeMarks("book-a", "A book", [highlight(), second]);
    expect(importMarks(backup, "book-a", [current])).toEqual([current, second]);
    expect(() => importMarks(backup, "book-b", [])).toThrow(/当前书籍/);
    expect(() => importMarks('{"format":"paperleaf-marks","version":1,"bookId":"book-a","marks":[{"id":"bad"}]}', "book-a", [])).toThrow(/损坏|无效/);
  });

  it("round-trips a valid multi-megabyte backup within the app's shared size budget", () => {
    const marks = Array.from({ length: 350 }, (_, index) => highlight({
      id: `large-${index}`,
      quote: "x".repeat(12000),
      note: "n".repeat(4000),
    }));
    const backup = serializeMarks("book-a", "A book", marks);
    expect(backup.length).toBeGreaterThan(4_000_000);
    expect(backup.length).toBeLessThanOrEqual(MAX_MARKS_BACKUP_BYTES);
    expect(importMarks(backup, "book-a", [])).toHaveLength(marks.length);
  });

  it("rejects dates outside the JavaScript date range before displaying imported notes", () => {
    const invalid = highlight({ createdAt: 8.64e15 + 1 });
    localStorage.setItem("paper-pdf-marks:book-a", JSON.stringify([invalid]));
    expect(readMarks("book-a")).toEqual([]);
    const backup = JSON.stringify({ format: "paperleaf-marks", version: 1, bookId: "book-a", marks: [invalid] });
    expect(() => importMarks(backup, "book-a", [])).toThrow(/损坏|无效/);
  });

  it("exports notes as readable Markdown and escapes HTML in user text", () => {
    const result = exportMarksMarkdown("Book <title>", [highlight({ quote: "line one\n<script>two</script>", note: "Remember <this>" })], ["Chapter 1"]);
    expect(result).toContain("# Book &lt;title&gt;");
    expect(result).toContain("Chapter 1");
    expect(result).toContain("> line one\n> &lt;script&gt;two&lt;/script&gt;");
    expect(result).toContain("Remember &lt;this&gt;");
    expect(result).not.toContain("<script>");
  });
});
