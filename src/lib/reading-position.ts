import { normalizeBlocks, type DocumentBlock } from "./pagination";

export interface ReadingAnchor {
  id: string;
  offset: number;
  viewportY: number;
}

const EXCLUDED = ".pdf-generated-figure,figcaption,svg,img,math,script,style,template";
const PROSE =
  "p,h1,h2,h3,h4,h5,h6,li,pre,td,th,dt,dd,.pdf-abstract,.pdf-keywords";

interface ProseSegment {
  node: Text;
  start: number;
  end: number;
}

/** Stamp the unchanged source before filtering media or paginating it. */
export function stampReadingAnchors(blocks: DocumentBlock[]): DocumentBlock[] {
  return normalizeBlocks(blocks).map((block, blockIndex) => {
    const template = document.createElement("template");
    template.innerHTML = block.html;
    const candidates = template.content.querySelectorAll<HTMLElement>(PROSE);
    let index = 0;
    for (const node of candidates) {
      if (node.closest(EXCLUDED) || !proseSegments(node).length) continue;
      node.dataset.readingAnchor = `c${block.chapterIndex}-b${blockIndex}-n${index++}`;
      node.dataset.readingStart = "0";
    }
    return { ...block, html: template.innerHTML };
  });
}

function proseSegments(element: HTMLElement): ProseSegment[] {
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        node.parentElement?.closest(EXCLUDED)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    },
  );
  const segments: ProseSegment[] = [];
  let length = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent ?? "";
    if (!text.length) continue;
    segments.push({
      node: node as Text,
      start: length,
      end: length + text.length,
    });
    length += text.length;
  }
  return segments;
}

function proseLength(segments: ProseSegment[]) {
  return segments.at(-1)?.end ?? 0;
}

function characterRange(
  segments: ProseSegment[],
  requestedOffset: number,
): Range | null {
  const length = proseLength(segments);
  if (!length) return null;
  const offset = Math.max(0, Math.min(length - 1, requestedOffset));
  const segment = segments.find((part) => part.end > offset)!;
  let local = offset - segment.start;
  const text = segment.node.textContent ?? "";
  if (
    local > 0 &&
    /[\uDC00-\uDFFF]/.test(text[local]) &&
    /[\uD800-\uDBFF]/.test(text[local - 1])
  )
    local--;
  const range = segment.node.ownerDocument.createRange();
  range.setStart(segment.node, local);
  range.setEnd(
    segment.node,
    Math.min(text.length, local + (text.codePointAt(local)! > 0xffff ? 2 : 1)),
  );
  return range;
}

function characterRect(
  segments: ProseSegment[],
  offset: number,
): DOMRect | null {
  const range = characterRange(segments, offset);
  if (!range) return null;
  const rect = range.getBoundingClientRect();
  return rect.height > 0 ? rect : null;
}

function firstCharacterBelow(segments: ProseSegment[], top: number): number {
  let lower = 0;
  let upper = proseLength(segments) - 1;
  while (lower < upper) {
    const mid = Math.floor((lower + upper) / 2);
    const rect = characterRect(segments, mid);
    if (rect && rect.bottom > top) upper = mid;
    else lower = mid + 1;
  }
  // Ignore leading whitespace with a zero-size range after an inline element.
  while (lower < proseLength(segments) - 1 && !characterRect(segments, lower))
    lower++;
  return lower;
}

/** Capture an actual text character, not a page index that changes with media. */
export function captureReadingAnchor(
  viewport: HTMLElement,
  { nearest = true }: { nearest?: boolean } = {},
): ReadingAnchor | null {
  const bounds = viewport.getBoundingClientRect();
  const preferredPage = viewport.dataset.readingCurrentPage;
  const allCandidates = [
    ...viewport.querySelectorAll<HTMLElement>("[data-reading-anchor]"),
  ].filter((node) => !node.closest(EXCLUDED));
  const preferred = (node: HTMLElement) =>
    node.closest<HTMLElement>("[data-page-index]")?.dataset.pageIndex ===
    preferredPage
      ? 0
      : 1;
  const candidates = allCandidates
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return (
        rect.bottom > bounds.top &&
        rect.top < bounds.bottom &&
        rect.right > bounds.left &&
        rect.left < bounds.right
      );
    })
    .sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return (
        preferred(a) - preferred(b) ||
        Math.max(bounds.top, aRect.top) - Math.max(bounds.top, bRect.top) ||
        aRect.left - bRect.left
      );
    });
  for (const node of candidates) {
    const segments = proseSegments(node);
    if (!proseLength(segments)) continue;
    const offset = firstCharacterBelow(segments, bounds.top);
    const rect = characterRect(segments, offset);
    if (!rect || rect.bottom <= bounds.top || rect.top >= bounds.bottom)
      continue;
    return {
      id: node.dataset.readingAnchor!,
      offset: (Number(node.dataset.readingStart) || 0) + offset,
      viewportY: rect.top - bounds.top,
    };
  }

  if (!nearest) return null;
  // A full-page image or page margin may leave no prose visible. Anchor the
  // nearest surrounding passage so removing that image cannot reuse an
  // unrelated numerical page. Keep the selected character at a visible edge.
  const nearby = allCandidates
    .map((node) => ({ node, rect: node.getBoundingClientRect() }))
    .filter(({ rect }) => rect.right > bounds.left && rect.left < bounds.right)
    .sort((a, b) => {
      const distance = (rect: DOMRect) =>
        Math.max(bounds.top - rect.bottom, rect.top - bounds.bottom, 0);
      return (
        distance(a.rect) - distance(b.rect) ||
        preferred(a.node) - preferred(b.node)
      );
    });
  for (const { node } of nearby) {
    const segments = proseSegments(node);
    if (!proseLength(segments)) continue;
    const offset = firstCharacterBelow(segments, bounds.top);
    const rect = characterRect(segments, offset);
    if (!rect) continue;
    return {
      id: node.dataset.readingAnchor!,
      offset: (Number(node.dataset.readingStart) || 0) + offset,
      viewportY: Math.max(
        0,
        Math.min(
          Math.max(0, bounds.bottom - bounds.top - rect.height),
          rect.top - bounds.top,
        ),
      ),
    };
  }
  return null;
}

/** Restore after the replacement pages have mounted; returns the new page. */
export function restoreReadingAnchor(
  viewport: HTMLElement,
  anchor: ReadingAnchor,
): number | null {
  const candidates = [
    ...viewport.querySelectorAll<HTMLElement>("[data-reading-anchor]"),
  ]
    .filter((node) => node.dataset.readingAnchor === anchor.id)
    .map((node) => ({
      node,
      start: Number(node.dataset.readingStart) || 0,
      segments: proseSegments(node),
    }))
    .filter((item) => proseLength(item.segments) > 0)
    .sort((a, b) => a.start - b.start);
  const exact = candidates.find(
    (item) =>
      anchor.offset >= item.start &&
      anchor.offset < item.start + proseLength(item.segments),
  );
  const selected = exact ?? candidates.at(-1);
  if (!selected) return null;
  const rect = characterRect(selected.segments, anchor.offset - selected.start);
  if (!rect) return null;
  const bounds = viewport.getBoundingClientRect();
  viewport.scrollTop += rect.top - bounds.top - anchor.viewportY;
  if (rect.left < bounds.left) viewport.scrollLeft += rect.left - bounds.left;
  else if (rect.right > bounds.right)
    viewport.scrollLeft += rect.right - bounds.right;
  const pageIndex =
    selected.node.closest<HTMLElement>("[data-page-index]")?.dataset.pageIndex;
  return pageIndex !== undefined && Number.isFinite(Number(pageIndex))
    ? Number(pageIndex)
    : null;
}
