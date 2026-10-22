import type { ReadingAnchor } from "./reading-position";

export type ReaderMarkColor = "yellow" | "green" | "blue" | "pink";

export interface ReaderMarkRange {
  anchorId: string;
  start: number;
  end: number;
}

export interface CapturedTextSelection {
  quote: string;
  anchor: ReadingAnchor;
  ranges: ReaderMarkRange[];
}

export interface ReaderMark {
  id: string;
  kind: "bookmark" | "highlight";
  anchor: ReadingAnchor;
  chapterIndex: number;
  quote: string;
  note: string;
  color: ReaderMarkColor;
  createdAt: number;
  ranges?: ReaderMarkRange[];
}

export const MAX_SELECTION_LENGTH = 12000;
export const MAX_READER_MARKS = 1000;
/** Maximum JSON backup size accepted by both the reader and the file picker. */
export const MAX_MARKS_BACKUP_BYTES = 20 * 1024 * 1024;
const COLORS: ReaderMarkColor[] = ["yellow", "green", "blue", "pink"];
const EXCLUDED = ".pdf-generated-figure,figcaption,svg,img,math,script,style,template,.pdf-masthead,.pdf-abstract,.pdf-keywords,.pdf-running-header,.pdf-page-footer";
const ANCHOR = "[data-reading-anchor]";

function backupBytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function sourceText(element: HTMLElement) {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest(EXCLUDED)
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const segments: { node: Text; start: number; end: number }[] = [];
  let start = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0;
    if (!length) continue;
    segments.push({ node: node as Text, start, end: start + length });
    start += length;
  }
  return segments;
}

function validOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 200_000_000;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

function normalizeMark(value: unknown): ReaderMark | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<ReaderMark>;
  if (!validId(input.id) || !["bookmark", "highlight"].includes(input.kind ?? "") ||
      !input.anchor || !validId(input.anchor.id) || !validOffset(input.anchor.offset) ||
      typeof input.anchor.viewportY !== "number" || !Number.isFinite(input.anchor.viewportY) ||
      !validOffset(input.chapterIndex) || typeof input.createdAt !== "number" ||
      !Number.isFinite(input.createdAt) || input.createdAt < 0 || input.createdAt > 8.64e15) return null;
  const ranges = Array.isArray(input.ranges) ? input.ranges.filter(range => range &&
    validId(range.anchorId) && validOffset(range.start) && validOffset(range.end) && range.end > range.start)
    .slice(0, 1000).map(range => ({ anchorId: range.anchorId, start: range.start, end: range.end })) : [];
  if (input.kind === "highlight" && !ranges.length) return null;
  return {
    id: input.id,
    kind: input.kind as ReaderMark["kind"],
    anchor: { id: input.anchor.id, offset: input.anchor.offset, viewportY: Math.max(-10000, Math.min(10000, input.anchor.viewportY)) },
    chapterIndex: input.chapterIndex,
    quote: typeof input.quote === "string" ? input.quote.slice(0, MAX_SELECTION_LENGTH) : "",
    note: typeof input.note === "string" ? input.note.slice(0, 4000) : "",
    color: COLORS.includes(input.color as ReaderMarkColor) ? input.color! : "yellow",
    createdAt: input.createdAt,
    ...(input.kind === "highlight" ? { ranges } : {}),
  };
}

function normalizeMarks(input: unknown): ReaderMark[] {
  if (!Array.isArray(input)) return [];
  const ids = new Set<string>();
  return input.slice(0, MAX_READER_MARKS).flatMap(value => {
    const mark = normalizeMark(value);
    if (!mark || ids.has(mark.id)) return [];
    ids.add(mark.id);
    return [mark];
  });
}

export function readMarks(bookId: string): ReaderMark[] {
  try { return normalizeMarks(JSON.parse(localStorage.getItem(`paper-pdf-marks:${bookId}`) || "[]")); }
  catch { return []; }
}

/** False means the in-memory notes remain usable but could not be persisted. */
export function writeMarks(bookId: string, marks: ReaderMark[]): boolean {
  if (marks.length > MAX_READER_MARKS) return false;
  try {
    localStorage.setItem(`paper-pdf-marks:${bookId}`, JSON.stringify(normalizeMarks(marks)));
    return true;
  } catch { return false; }
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `mark-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createBookmark(anchor: ReadingAnchor, chapterIndex: number, quote: string): ReaderMark {
  return {
    id: newId(), kind: "bookmark", anchor: { ...anchor }, chapterIndex,
    quote: quote.slice(0, MAX_SELECTION_LENGTH), note: "", color: "yellow", createdAt: Date.now(),
  };
}

export function createHighlight(
  selection: CapturedTextSelection,
  chapterIndex: number,
  color: ReaderMarkColor = "yellow",
): ReaderMark {
  return {
    ...createBookmark(selection.anchor, chapterIndex, selection.quote), kind: "highlight", color,
    ranges: selection.ranges.map(range => ({ ...range })),
  };
}

/** Capture source offsets rather than DOM paths, which change during reflow. */
export function captureTextSelection(viewport: HTMLElement, selection: Selection | null): CapturedTextSelection | null {
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!viewport.contains(range.startContainer) || !viewport.contains(range.endContainer)) return null;
  const ranges: ReaderMarkRange[] = [];
  const quote: string[] = [];
  let previousAnchor = "";
  const offsets = new Map<HTMLElement, ReturnType<typeof sourceText>>();
  const walker = viewport.ownerDocument.createTreeWalker(viewport, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    const owner = parent?.closest<HTMLElement>(ANCHOR);
    if (!owner || parent?.closest(EXCLUDED) || !parent?.closest(".pdf-page-body") || !range.intersectsNode(node)) continue;
    const text = node.textContent ?? "";
    const start = range.startContainer === node ? range.startOffset : 0;
    const end = range.endContainer === node ? range.endOffset : text.length;
    if (end <= start) continue;
    let segments = offsets.get(owner);
    if (!segments) { segments = sourceText(owner); offsets.set(owner, segments); }
    const segment = segments.find(part => part.node === node);
    if (!segment) continue;
    const anchorId = owner.dataset.readingAnchor!;
    const sourceStart = (Number(owner.dataset.readingStart) || 0) + segment.start;
    const next = { anchorId, start: sourceStart + start, end: sourceStart + end };
    const previous = ranges.at(-1);
    if (previous?.anchorId === anchorId && previous.end === next.start) previous.end = next.end;
    else ranges.push(next);
    if (previousAnchor && previousAnchor !== anchorId) quote.push("\n");
    quote.push(text.slice(start, end));
    previousAnchor = anchorId;
  }
  const selectedText = quote.join("").trim();
  if (!selectedText || selectedText.length > MAX_SELECTION_LENGTH || !ranges.length || ranges.length > 1000) return null;
  return {
    quote: selectedText,
    anchor: { id: ranges[0].anchorId, offset: ranges[0].start, viewportY: 24 },
    ranges,
  };
}

/** Highlight a derived page only; the parsed EPUB and pagination source stay intact. */
export function applyMarksToHtml(html: string, marks: ReaderMark[]): string {
  const active = marks.filter(mark => mark.kind === "highlight" && mark.ranges?.length);
  if (!active.length) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("span.reader-highlight").forEach(node => node.replaceWith(...Array.from(node.childNodes)));
  const byAnchor = new Map<string, { mark: ReaderMark; range: ReaderMarkRange }[]>();
  for (const mark of [...active].sort((a, b) => a.createdAt - b.createdAt)) {
    for (const range of mark.ranges!) {
      const list = byAnchor.get(range.anchorId) ?? [];
      list.push({ mark, range });
      byAnchor.set(range.anchorId, list);
    }
  }
  for (const owner of template.content.querySelectorAll<HTMLElement>(ANCHOR)) {
    if (owner.closest(EXCLUDED)) continue;
    const entries = byAnchor.get(owner.dataset.readingAnchor!);
    if (!entries) continue;
    const offset = Number(owner.dataset.readingStart) || 0;
    for (const segment of sourceText(owner)) {
      if (segment.node.parentElement?.closest(ANCHOR) !== owner) continue;
      const text = segment.node.textContent ?? "";
      const start = offset + segment.start;
      const overlaps = entries.filter(({ range }) => range.start < start + text.length && range.end > start);
      if (!overlaps.length) continue;
      const boundaries = [...new Set([0, text.length, ...overlaps.flatMap(({ range }) => [
        Math.max(0, range.start - start), Math.min(text.length, range.end - start),
      ])])].sort((a, b) => a - b);
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < boundaries.length - 1; index++) {
        const from = boundaries[index], to = boundaries[index + 1];
        const selected = [...overlaps].reverse().find(({ range }) => range.start <= start + from && range.end >= start + to);
        const part = text.slice(from, to);
        if (!selected) fragment.append(part);
        else {
          const span = document.createElement("span");
          span.className = `reader-highlight reader-highlight-${selected.mark.color}`;
          span.dataset.readerMark = selected.mark.id;
          span.title = selected.mark.note || "查看批注";
          span.textContent = part;
          fragment.append(span);
        }
      }
      segment.node.replaceWith(fragment);
    }
  }
  return template.innerHTML;
}

function markdownText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function exportMarksMarkdown(title: string, marks: ReaderMark[], chapterNames: string[]): string {
  return `# ${markdownText(title.replace(/\s+/g, " "))}\n\n` + marks.map(mark => {
    const chapter = chapterNames[mark.chapterIndex] || `第 ${mark.chapterIndex + 1} 章`;
    const heading = `## ${mark.kind === "bookmark" ? "书签" : "划线"} · ${markdownText(chapter)}`;
    const quote = markdownText(mark.quote).split(/\r?\n/).map(line => `> ${line}`).join("\n");
    return `${heading}\n\n${quote}\n\n${markdownText(mark.note)}\n`;
  }).join("\n");
}

export function serializeMarks(bookId: string, title: string, marks: ReaderMark[]): string {
  const value = JSON.stringify({ format: "paperleaf-marks", version: 1, bookId, title, marks: normalizeMarks(marks) }, null, 2);
  if (backupBytes(value) > MAX_MARKS_BACKUP_BYTES) throw new Error("批注备份过大，请先整理批注后导出。");
  return value;
}

/** Merge backups for this exact EPUB, preserving notes already edited locally. */
export function importMarks(json: string, bookId: string, existing: ReaderMark[]): ReaderMark[] {
  const invalid = () => new Error("批注备份无效或已损坏。");
  if (backupBytes(json) > MAX_MARKS_BACKUP_BYTES)
    throw new Error("批注备份过大，请选择 20 MB 以内的 JSON 文件。");
  let input: { format?: unknown; version?: unknown; bookId?: unknown; marks?: unknown };
  try { input = JSON.parse(json); } catch { throw invalid(); }
  if (!input || typeof input !== "object" || input.format !== "paperleaf-marks" || input.version !== 1 || !Array.isArray(input.marks)) throw invalid();
  if (input.bookId !== bookId) throw new Error("此备份不属于当前书籍，请先打开对应的 EPUB。");
  const incoming = normalizeMarks(input.marks);
  if (incoming.length !== input.marks.length) throw invalid();
  const ids = new Set(existing.map(mark => mark.id));
  const merged = [...existing, ...incoming.filter(mark => !ids.has(mark.id))];
  if (merged.length > MAX_READER_MARKS) throw new Error("当前书籍的批注已达到 1000 条，请先导出整理。");
  return merged;
}
