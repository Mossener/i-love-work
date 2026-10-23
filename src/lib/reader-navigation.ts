import type { ReadingAnchor } from "./reading-position";

export interface ReadingProgress {
  page: number;
  chapterIndex: number;
  percent: number;
  anchor: ReadingAnchor | null;
  updatedAt: number;
}

/** Page destinations must reveal the correct column in an overflowing spread. */
export function pageHorizontalScroll(root: HTMLElement, page: number): number {
  const frame = root.querySelector<HTMLElement>(`[data-page-index="${page}"]`);
  if (!frame) return root.scrollLeft;
  const bounds = root.getBoundingClientRect();
  const target = frame.getBoundingClientRect();
  if (target.left >= bounds.left && target.right <= bounds.right) return root.scrollLeft;
  const padding = Number.parseFloat(getComputedStyle(root).paddingLeft) || 0;
  return Math.max(0, root.scrollLeft + target.left - bounds.left - padding);
}

export function findChapterFragment(root: HTMLElement, chapterIndex: number, fragment: string): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>("[id][data-source-chapter]")]
    .find(node => node.id === fragment && Number(node.dataset.sourceChapter) === chapterIndex) ?? null;
}

/** Chapters can start halfway down a page shared with the previous chapter. */
export function findChapterTarget(root: HTMLElement, chapterIndex: number, fragment?: string): HTMLElement | null {
  const fragmentTarget = fragment ? findChapterFragment(root, chapterIndex, fragment) : null;
  return fragmentTarget ?? [...root.querySelectorAll<HTMLElement>("[data-pdf-chapter]")]
    .find(node => Number(node.dataset.pdfChapter) === chapterIndex) ??
    [...root.querySelectorAll<HTMLElement>("h1[data-source-chapter],h2[data-source-chapter],h3[data-source-chapter],h4[data-source-chapter],h5[data-source-chapter],h6[data-source-chapter]")]
      .find(node => Number(node.dataset.sourceChapter) === chapterIndex) ?? null;
}

export function progressToPage(percent: number, total: number) {
  const value = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  return Math.round(value / 100 * Math.max(0, total - 1));
}

export function pageToProgress(page: number, total: number) {
  return total > 1 ? Math.round(Math.max(0, Math.min(total - 1, page)) / (total - 1) * 1000) / 10 : 0;
}

function validAnchor(value: unknown): value is ReadingAnchor | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const anchor = value as ReadingAnchor;
  return typeof anchor.id === "string" && anchor.id.length > 0 && anchor.id.length < 200 &&
    Number.isInteger(anchor.offset) && anchor.offset >= 0 && Number.isFinite(anchor.viewportY);
}

export function readReadingProgress(bookId: string): ReadingProgress | null {
  try {
    const value: ReadingProgress = JSON.parse(localStorage.getItem(`paper-pdf-progress:${bookId}`) || "null");
    if (!value || !Number.isInteger(value.page) || value.page < 0 ||
      !Number.isInteger(value.chapterIndex) || value.chapterIndex < 0 ||
      !Number.isFinite(value.percent) || value.percent < 0 || value.percent > 100 ||
      !Number.isFinite(value.updatedAt) || !validAnchor(value.anchor)) return null;
    return value;
  } catch { return null; }
}

export function writeReadingProgress(bookId: string, progress: ReadingProgress): boolean {
  try {
    localStorage.setItem(`paper-pdf-progress:${bookId}`, JSON.stringify(progress));
    // Keep the existing installation's resume keys compatible.
    localStorage.setItem(`paper-pdf-position:${bookId}`, String(progress.page + 1));
    if (progress.anchor) localStorage.setItem(`paper-pdf-anchor:${bookId}`, JSON.stringify(progress.anchor));
    else localStorage.removeItem(`paper-pdf-anchor:${bookId}`);
    return true;
  } catch { return false; }
}
