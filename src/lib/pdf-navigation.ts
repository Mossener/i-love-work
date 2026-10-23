import type { PDFDocumentProxy, PageViewport } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { PAGE_HEIGHT, PAGE_WIDTH } from "./pagination";

/** Page is zero based; top is a fraction of the fitted, centered paper sheet. */
export interface PdfDestination { page: number; top?: number }
export interface PdfOutlineItem extends PdfDestination { id: string; title: string; depth: number }
export interface PdfSheetRect { left: number; top: number; width: number; height: number }
export interface PdfPageLink {
  id: string;
  label: string;
  rect: PdfSheetRect;
  destination?: PdfDestination;
  href?: string;
}
export interface PdfSearchMatch extends PdfDestination {
  occurrence: number;
  context: string;
  rects: PdfSheetRect[];
}

interface IndexedTextItem { item: TextItem; start: number; end: number }
interface PdfTextIndex { text: string; items: IndexedTextItem[]; viewport: PageViewport }
const textCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<PdfTextIndex>>>();
const destinationCache = new WeakMap<PDFDocumentProxy, Map<string, Promise<PdfDestination | null>>>();
const MAX_MATCHES = 10000;

function checkAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("PDF operation cancelled", "AbortError");
}

function validPage(pdf: PDFDocumentProxy, page: number) {
  return Number.isInteger(page) && page >= 0 && page < pdf.numPages;
}

function fitSheet(viewport: Pick<PageViewport, "width" | "height">) {
  const scale = Math.min(PAGE_WIDTH / viewport.width, PAGE_HEIGHT / viewport.height);
  return {
    scale,
    left: (PAGE_WIDTH - viewport.width * scale) / 2,
    top: (PAGE_HEIGHT - viewport.height * scale) / 2,
  };
}

function sheetRect(viewport: PageViewport, rect: number[]): PdfSheetRect {
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);
  const fit = fitSheet(viewport);
  return {
    left: fit.left + Math.min(x1, x2) * fit.scale,
    top: fit.top + Math.min(y1, y2) * fit.scale,
    width: Math.abs(x2 - x1) * fit.scale,
    height: Math.abs(y2 - y1) * fit.scale,
  };
}

async function resolveDestination(pdf: PDFDocumentProxy, destination: unknown): Promise<PdfDestination | null> {
  try {
    const explicit = typeof destination === "string" ? await pdf.getDestination(destination) : destination;
    if (!Array.isArray(explicit) || explicit.length < 2) return null;
    const ref = explicit[0];
    const page = typeof ref === "number" ? ref
      : ref && Number.isInteger(ref.num) && Number.isInteger(ref.gen) ? await pdf.getPageIndex(ref) : -1;
    if (!validPage(pdf, page)) return null;
    const mode = typeof explicit[1] === "string" ? explicit[1] : explicit[1]?.name;
    const y = mode === "XYZ" ? explicit[3]
      : mode === "FitH" || mode === "FitBH" ? explicit[2]
      : mode === "FitR" ? explicit[5] : undefined;
    if (typeof y !== "number" || !Number.isFinite(y)) return { page };
    const nativePage = await pdf.getPage(page + 1);
    const viewport = nativePage.getViewport({ scale: 1 });
    const x = mode === "XYZ" && typeof explicit[2] === "number" ? explicit[2] : 0;
    const [, targetY] = viewport.convertToViewportPoint(x, y);
    const fit = fitSheet(viewport);
    return { page, top: Math.max(0, Math.min(1, (fit.top + targetY * fit.scale) / PAGE_HEIGHT)) };
  } catch {
    // One damaged target must not disable all other links in the same PDF.
    return null;
  }
}

export function resolvePdfDestination(pdf: PDFDocumentProxy, destination: unknown): Promise<PdfDestination | null> {
  let cache = destinationCache.get(pdf);
  if (!cache) { cache = new Map(); destinationCache.set(pdf, cache); }
  let key: string;
  try { key = JSON.stringify(destination); } catch { return Promise.resolve(null); }
  if (typeof key !== "string") return Promise.resolve(null);
  let result = cache.get(key);
  if (!result) { result = resolveDestination(pdf, destination); cache.set(key, result); }
  return result;
}

export async function loadPdfOutline(pdf: PDFDocumentProxy, signal?: AbortSignal): Promise<PdfOutlineItem[]> {
  checkAborted(signal);
  const outline = await pdf.getOutline();
  checkAborted(signal);
  const result: PdfOutlineItem[] = [];
  type OutlineNode = NonNullable<Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>>[number];
  let count = 0;
  async function visit(nodes: OutlineNode[], depth: number, prefix: string): Promise<PdfOutlineItem[]> {
    const items: PdfOutlineItem[] = [];
    for (let index = 0; index < nodes.length && count < 5000; index++) {
      checkAborted(signal);
      count++;
      const node = nodes[index];
      const id = `${prefix}${index}`;
      const own = await resolvePdfDestination(pdf, node.dest);
      const children = depth < 30 ? await visit(node.items || [], depth + 1, `${id}-`) : [];
      const target = own ?? children[0];
      const title = String(node.title || "未命名目录").slice(0, 500);
      if (target) items.push({ id, title, depth, page: target.page, ...(target.top === undefined ? {} : { top: target.top }) });
      items.push(...children);
    }
    return items;
  }
  result.push(...await visit(outline || [], 0, "pdf-outline-"));
  checkAborted(signal);
  return result;
}

function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export async function loadPdfPageLinks(pdf: PDFDocumentProxy, index: number): Promise<PdfPageLink[]> {
  if (!validPage(pdf, index)) return [];
  const page = await pdf.getPage(index + 1);
  const viewport = page.getViewport({ scale: 1 });
  const annotations = await page.getAnnotations({ intent: "display" });
  const links: PdfPageLink[] = [];
  for (const annotation of annotations) {
    if (annotation.subtype !== "Link" && annotation.annotationType !== 2) continue;
    if (!Array.isArray(annotation.rect) || annotation.rect.length !== 4 || !annotation.rect.every(Number.isFinite)) continue;
    const rect = sheetRect(viewport, annotation.rect);
    if (rect.width <= 0 || rect.height <= 0) continue;
    const destination = annotation.dest ? await resolvePdfDestination(pdf, annotation.dest) : null;
    const href = safeExternalUrl(annotation.url);
    let actionPage: number | undefined;
    if (!destination && !href) {
      if (annotation.action === "NextPage") actionPage = index + 1;
      if (annotation.action === "PrevPage") actionPage = index - 1;
      if (annotation.action === "FirstPage") actionPage = 0;
      if (annotation.action === "LastPage") actionPage = pdf.numPages - 1;
    }
    const target = destination ?? (actionPage !== undefined && validPage(pdf, actionPage) ? { page: actionPage } : null);
    if (!target && !href) continue;
    links.push({
      id: String(annotation.id ?? `pdf-link-${links.length}`), rect,
      label: target ? `跳转到第 ${target.page + 1} 页` : `打开链接：${href}`,
      ...(target ? { destination: target } : { href: href! }),
    });
  }
  return links;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
function betweenItems(previous: TextItem, current: TextItem) {
  if (/\s$/.test(previous.str) || /^\s/.test(current.str)) return "";
  if (CJK.test(previous.str.at(-1) || "") && CJK.test(current.str[0] || "")) return "";
  const lineBreak = previous.hasEOL || Math.abs(previous.transform[5] - current.transform[5]) > Math.max(previous.height, current.height) * 0.5;
  const gap = current.transform[4] - (previous.transform[4] + previous.width);
  return lineBreak || gap > Math.max(previous.height, current.height) * 0.12 ? " " : "";
}

function getTextIndex(pdf: PDFDocumentProxy, index: number): Promise<PdfTextIndex> {
  let cache = textCache.get(pdf);
  if (!cache) { cache = new Map(); textCache.set(pdf, cache); }
  let promise = cache.get(index);
  if (!promise) {
    promise = (async () => {
      const page = await pdf.getPage(index + 1);
      const content = await page.getTextContent();
      const items: IndexedTextItem[] = [];
      let text = "";
      let previous: TextItem | undefined;
      for (const entry of content.items) {
        if (!("str" in entry) || !entry.str) {
          if ("hasEOL" in entry && entry.hasEOL && previous) previous = { ...previous, hasEOL: true };
          continue;
        }
        if (previous) text += betweenItems(previous, entry);
        const start = text.length;
        text += entry.str.replace(/\s/g, " ");
        items.push({ item: entry, start, end: text.length });
        previous = entry;
      }
      return { text, items, viewport: page.getViewport({ scale: 1 }) };
    })();
    cache.set(index, promise);
    void promise.catch(() => { if (cache?.get(index) === promise) cache.delete(index); });
  }
  return promise;
}

function textRect(index: PdfTextIndex, part: IndexedTextItem, start: number, end: number): PdfSheetRect {
  const { item } = part;
  const [a, b, , , x, y] = item.transform;
  const length = Math.hypot(a, b) || 1;
  const dx = a / length, dy = b / length;
  const from = Math.max(0, start - part.start) / item.str.length;
  const to = Math.min(item.str.length, end - part.start) / item.str.length;
  const height = item.height || length;
  const points = [from, to].flatMap(fraction => [-0.2, 0.85].map(ascent => [
    x + item.width * fraction * dx - height * ascent * dy,
    y + item.width * fraction * dy + height * ascent * dx,
  ]));
  return sheetRect(index.viewport, [
    Math.min(...points.map(point => point[0])), Math.min(...points.map(point => point[1])),
    Math.max(...points.map(point => point[0])), Math.max(...points.map(point => point[1])),
  ]);
}

export async function searchPdfPage(pdf: PDFDocumentProxy, page: number, query: string, signal?: AbortSignal): Promise<PdfSearchMatch[]> {
  checkAborted(signal);
  const needle = query.trim().replace(/\s+/g, " ").toLowerCase();
  if (!needle || !validPage(pdf, page)) return [];
  const index = await getTextIndex(pdf, page);
  checkAborted(signal);
  const haystack = index.text.toLowerCase();
  const matches: PdfSearchMatch[] = [];
  let from = 0;
  while (matches.length < MAX_MATCHES) {
    const found = haystack.indexOf(needle, from);
    if (found < 0) break;
    const end = found + needle.length;
    const rects = index.items.filter(item => item.start < end && item.end > found).map(item => textRect(index, item, found, end));
    matches.push({
      page, occurrence: matches.length,
      context: `${found > 30 ? "…" : ""}${index.text.slice(Math.max(0, found - 30), Math.min(index.text.length, end + 40))}${end + 40 < index.text.length ? "…" : ""}`,
      rects,
      ...(rects[0] ? { top: Math.max(0, Math.min(1, rects[0].top / PAGE_HEIGHT)) } : {}),
    });
    from = end;
  }
  return matches;
}

export async function searchPdfDocument(pdf: PDFDocumentProxy, query: string, signal?: AbortSignal): Promise<PdfSearchMatch[]> {
  checkAborted(signal);
  if (!query.trim()) return [];
  const matches: PdfSearchMatch[] = [];
  for (let start = 0; start < pdf.numPages && matches.length < MAX_MATCHES; start += 4) {
    checkAborted(signal);
    const batch = await Promise.all(Array.from({ length: Math.min(4, pdf.numPages - start) }, (_, offset) => searchPdfPage(pdf, start + offset, query, signal)));
    matches.push(...batch.flat().slice(0, MAX_MATCHES - matches.length));
  }
  checkAborted(signal);
  return matches;
}
