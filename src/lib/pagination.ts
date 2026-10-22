import { typographyStyle, type ReaderTypography } from "./reader-preferences";

export interface DocumentBlock {
  html: string;
  chapterIndex: number;
}

export interface DocumentPage {
  html: string;
  chapterIndex: number;
  chapterIndices: number[];
}

export const PAGE_WIDTH = 794;
export const PAGE_HEIGHT = 1123;
export const CONTENT_WIDTH = 642;
export const CONTENT_HEIGHT = 956;

const WRAPPER_TAGS = new Set(["DIV", "SECTION", "ARTICLE", "MAIN", "BODY"]);
const BLOCK_TAGS = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "FIGURE",
  "IMG",
  "SVG",
  "TABLE",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "PRE",
  "HR",
  "DL",
  "DT",
  "DD",
  "ASIDE",
  "HEADER",
  "FOOTER",
  "ADDRESS",
  "DETAILS",
  "SUMMARY",
]);
const ATOMIC_SELECTOR = "img,svg,table,figure";

interface Boundary {
  node: Node;
  offset: number;
}

function childIndex(node: Node) {
  return Array.prototype.indexOf.call(
    node.parentNode!.childNodes,
    node,
  ) as number;
}

function containingAtom(node: Node, root: HTMLElement) {
  let ancestor = node.parentElement;
  let atomic: Element | null = null;
  while (ancestor && ancestor !== root) {
    if (ancestor.matches(ATOMIC_SELECTOR)) atomic = ancestor;
    ancestor = ancestor.parentElement;
  }
  return atomic;
}

function boundaryAtOffset(
  element: HTMLElement,
  requestedOffset: number,
): Boundary {
  const text = element.textContent ?? "";
  let offset = Math.max(
    0,
    Math.min(text.length, Math.floor(requestedOffset) || 0),
  );
  // DOM Range offsets count UTF-16 code units. Move the seam before an entire
  // surrogate pair so neither page can receive an unpaired surrogate.
  if (
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[offset])
  ) {
    offset--;
  }
  if (offset === 0) return { node: element, offset: 0 };
  if (offset === text.length)
    return { node: element, offset: element.childNodes.length };

  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
  );
  let current: Node | null;
  let remaining = offset;
  while ((current = walker.nextNode())) {
    const length = current.textContent?.length ?? 0;
    if (remaining > length) {
      remaining -= length;
      continue;
    }

    // An SVG label, caption, or table cell must never turn into two figures.
    const atomic = containingAtom(current, element);
    if (atomic) {
      const remainder = element.ownerDocument.createRange();
      remainder.selectNodeContents(atomic);
      remainder.setStart(current, remaining);
      const after = remainder.toString().length === 0;
      return {
        node: atomic.parentNode!,
        offset: childIndex(atomic) + (after ? 1 : 0),
      };
    }

    let boundary: Boundary = { node: current, offset: remaining };
    // Move seams at the end/start of complete nodes outside those nodes.
    // Otherwise cloneContents produces an empty paragraph on the next page.
    while (boundary.node !== element) {
      const length =
        boundary.node.nodeType === Node.TEXT_NODE
          ? boundary.node.textContent!.length
          : boundary.node.childNodes.length;
      if (boundary.offset !== 0 && boundary.offset !== length) break;
      const after = boundary.offset === length;
      boundary = {
        node: boundary.node.parentNode!,
        offset: childIndex(boundary.node) + (after ? 1 : 0),
      };
    }
    return boundary;
  }
  return { node: element, offset: element.childNodes.length };
}

function elementsWithIds(element: HTMLElement): Element[] {
  return [element, ...element.querySelectorAll("[id]")].filter((node) =>
    node.hasAttribute("id"),
  );
}

function anchorElements(element: HTMLElement): HTMLElement[] {
  return [
    element,
    ...element.querySelectorAll<HTMLElement>("[data-reading-anchor]"),
  ].filter((node) => node.hasAttribute("data-reading-anchor"));
}

function anchorTextLength(element: HTMLElement) {
  const copy = element.cloneNode(true) as HTMLElement;
  copy
    .querySelectorAll(".pdf-generated-figure,figcaption,svg,img,math,script,style,template")
    .forEach((node) => node.remove());
  return copy.textContent?.length ?? 0;
}

/** Split existing DOM, never HTML strings: entities and inline tags remain intact. */
export function splitElementAtTextOffset(
  element: HTMLElement,
  offset: number,
): [HTMLElement, HTMLElement] {
  const boundary = boundaryAtOffset(element, offset);
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  range.setEnd(boundary.node, boundary.offset);
  const head = element.cloneNode(false) as HTMLElement;
  head.append(range.cloneContents());
  range.selectNodeContents(element);
  range.setStart(boundary.node, boundary.offset);
  const tail = element.cloneNode(false) as HTMLElement;
  tail.append(range.cloneContents());

  // A continuation keeps its source identity and advances by retained prose,
  // including when nested paragraphs or inline formatting cross the page seam.
  const headAnchors = new Map(
    anchorElements(head).map((node) => [node.dataset.readingAnchor, node]),
  );
  for (const node of anchorElements(tail)) {
    const preceding = headAnchors.get(node.dataset.readingAnchor);
    if (preceding)
      node.dataset.readingStart = String(
        (Number(node.dataset.readingStart) || 0) + anchorTextLength(preceding),
      );
  }

  if (!head.hasChildNodes()) {
    head.removeAttribute("id");
  } else {
    const retainedIds = new Set(elementsWithIds(head).map((node) => node.id));
    for (const node of elementsWithIds(tail)) {
      if (retainedIds.has(node.id)) node.removeAttribute("id");
    }
  }

  // Only ancestors actually crossed by the seam are continuations. A complete
  // paragraph at the start of the next page retains its normal indentation.
  const crossed: Element[] = [];
  let ancestor =
    boundary.node.nodeType === Node.ELEMENT_NODE
      ? (boundary.node as Element)
      : boundary.node.parentElement;
  while (ancestor) {
    crossed.push(ancestor);
    if (ancestor === element) break;
    ancestor = ancestor.parentElement;
  }
  if (head.hasChildNodes() && tail.hasChildNodes()) {
    if (element.tagName === "P") tail.classList.add("pdf-continuation");
    if (crossed.some((node) => node.tagName === "P" && node !== element)) {
      tail.querySelector("p")?.classList.add("pdf-continuation");
    }
    if (crossed.some((node) => node.tagName === "LI")) {
      const continuingItem =
        tail.tagName === "LI" ? tail : tail.querySelector("li");
      if (continuingItem) {
        continuingItem.classList.add("pdf-continuation");
        continuingItem.style.listStyleType = "none";
      }
    }
  }

  if (element.tagName === "OL" && tail.hasChildNodes()) {
    const items = Array.from(element.children).filter(
      (node) => node.tagName === "LI",
    );
    const headItems = Array.from(head.children).filter(
      (node) => node.tagName === "LI",
    );
    const continuing = crossed.some((node) => node.tagName === "LI");
    const skipped = Math.max(0, headItems.length - (continuing ? 1 : 0));
    const direction = element.hasAttribute("reversed") ? -1 : 1;
    let number = Number(
      element.getAttribute("start") ?? (direction === -1 ? items.length : 1),
    );
    for (let i = 0; i <= skipped && i < items.length; i++) {
      if (items[i].hasAttribute("value"))
        number = Number(items[i].getAttribute("value"));
      if (i < skipped) number += direction;
    }
    tail.setAttribute("start", String(number));
  }
  return [head, tail];
}

function inheritedAttributes(wrapper: Element, children: HTMLElement[]) {
  for (const attribute of ["lang", "dir"]) {
    const value = wrapper.getAttribute(attribute);
    if (value !== null) {
      for (const child of children) {
        if (!child.hasAttribute(attribute))
          child.setAttribute(attribute, value);
      }
    }
  }
  const id = wrapper.getAttribute("id");
  const first = children[0];
  if (id && first) {
    if (!first.id) first.id = id;
    else {
      const anchor = wrapper.ownerDocument.createElement("span");
      anchor.id = id;
      first.prepend(anchor);
    }
  }
}

function normalizeChildren(container: ParentNode): HTMLElement[] {
  const result: HTMLElement[] = [];
  let inline: Node[] = [];
  const flushInline = () => {
    if (!inline.length) return;
    const paragraph = document.createElement("p");
    paragraph.append(...inline);
    if (
      paragraph.textContent?.trim() ||
      paragraph.querySelector("img,svg,br,[id]")
    )
      result.push(paragraph);
    inline = [];
  };
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === Node.COMMENT_NODE) continue;
    if (node.nodeType !== Node.ELEMENT_NODE) {
      inline.push(node.cloneNode(true));
      continue;
    }
    const element = node as HTMLElement;
    if (element.matches(".pdf-abstract,.pdf-keywords")) {
      flushInline();
      result.push(element.cloneNode(true) as HTMLElement);
    } else if (WRAPPER_TAGS.has(element.tagName)) {
      flushInline();
      const children = normalizeChildren(element);
      inheritedAttributes(element, children);
      result.push(...children);
    } else if (BLOCK_TAGS.has(element.tagName.toUpperCase())) {
      flushInline();
      result.push(element.cloneNode(true) as HTMLElement);
    } else {
      inline.push(element.cloneNode(true));
    }
  }
  flushInline();
  return result;
}

/** Flatten publication layout wrappers, retaining semantic blocks and inline DOM. */
export function normalizeBlocks(blocks: DocumentBlock[]): DocumentBlock[] {
  const normalized: DocumentBlock[] = [];
  for (const block of blocks) {
    const template = document.createElement("template");
    template.innerHTML = block.html;
    for (const element of normalizeChildren(template.content)) {
      normalized.push({
        html: element.outerHTML,
        chapterIndex: block.chapterIndex,
      });
    }
  }
  return normalized;
}

function checkAborted(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException("Pagination was aborted", "AbortError");
}

function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  checkAborted(signal);
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Pagination was aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function yieldToBrowser(signal?: AbortSignal) {
  return abortable(
    new Promise<void>((resolve) => setTimeout(resolve, 0)),
    signal,
  );
}

function measureHeight(measure: HTMLElement) {
  return Math.max(measure.scrollHeight, measure.getBoundingClientRect().height);
}

function fitsPage(measure: HTMLElement) {
  return measureHeight(measure) <= CONTENT_HEIGHT + 0.25;
}

function mediaElements(element: HTMLElement) {
  const media = Array.from(
    element.querySelectorAll<HTMLElement | SVGElement>("img,svg"),
  );
  if (element.matches("img,svg")) media.unshift(element);
  return media;
}

function clampMedia(element: HTMLElement) {
  for (const media of mediaElements(element)) {
    media.style.maxWidth = "100%";
    media.style.maxHeight = "640px";
    media.style.height = "auto";
    media.style.objectFit = "contain";
  }
}

function isLocalImage(source: string) {
  return (
    /^blob:/i.test(source) ||
    /^data:image\/(?:png|jpeg|jpg|gif|webp|avif|bmp|svg\+xml)[;,]/i.test(source)
  );
}

function prepareImageSources(element: HTMLElement) {
  const images = Array.from(element.querySelectorAll<HTMLImageElement>("img"));
  if (element.matches("img")) images.unshift(element as HTMLImageElement);
  for (const image of images) {
    // EPUB resources are local blob/data URLs. Do not initiate a network image
    // request even if a caller accidentally passes an unsanitized source.
    const source = image.getAttribute("src");
    if (source && !isLocalImage(source)) image.removeAttribute("src");
    image.removeAttribute("srcset");
    image.loading = "eager";
  }
  return images;
}

async function waitForImage(image: HTMLImageElement, signal?: AbortSignal) {
  if (!image.getAttribute("src")) return;
  let cleanup = () => {};
  const loaded = new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      cleanup();
      resolve();
    };
    cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      image.removeEventListener("load", finish);
      image.removeEventListener("error", finish);
    };
    if (typeof image.decode === "function") {
      // decode() also waits for a pending local image load. Corrupt artwork
      // remains as its alt text and does not stop the publication rendering.
      void image.decode().then(finish, finish);
      return;
    } else if (image.complete) {
      finish();
      return;
    } else {
      image.addEventListener("load", finish, { once: true });
      image.addEventListener("error", finish, { once: true });
    }
    timer = setTimeout(finish, 4000);
  });
  try {
    await abortable(loaded, signal);
    // Intrinsic dimensions on serialized clones prevent a transient zero-size
    // image during binary-search measurements and when the visible pages mount.
    if (image.naturalWidth && image.naturalHeight) {
      if (!image.hasAttribute("width")) image.width = image.naturalWidth;
      if (!image.hasAttribute("height")) image.height = image.naturalHeight;
    }
  } finally {
    cleanup();
  }
}

function isAtomic(element: HTMLElement) {
  if (element.matches(`${ATOMIC_SELECTOR},hr,h1,h2,h3,h4,h5,h6`)) return true;
  if (!element.textContent?.length) return true;
  if (element.querySelector(ATOMIC_SELECTOR)) {
    const prose = element.cloneNode(true) as HTMLElement;
    for (const atomic of prose.querySelectorAll(ATOMIC_SELECTOR))
      atomic.remove();
    if (!prose.textContent?.trim()) return true;
  }
  return false;
}

function hasFragmentContent(element: HTMLElement) {
  return Boolean(
    element.textContent?.length ||
    element.querySelector(`${ATOMIC_SELECTOR},br,hr,[id]`),
  );
}

function preferWordBoundary(element: HTMLElement, offset: number) {
  const text = element.textContent ?? "";
  if (
    !/[\p{L}\p{N}]/u.test(text[offset - 1] ?? "") ||
    !/[\p{L}\p{N}]/u.test(text[offset] ?? "") ||
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
      text[offset] ?? "",
    )
  ) {
    return offset;
  }
  const nearEnd = text.slice(Math.max(0, offset - 64), offset);
  const spaces = [...nearEnd.matchAll(/\s+/g)];
  const last = spaces.at(-1);
  return last
    ? Math.max(0, offset - 64) + last.index! + last[0].length
    : offset;
}

function fittingPrefix(
  element: HTMLElement,
  measure: HTMLElement,
): [HTMLElement, HTMLElement] | null {
  const length = element.textContent?.length ?? 0;
  let lower = 1;
  let upper = length - 1;
  let best: [HTMLElement, HTMLElement] | null = null;
  while (lower <= upper) {
    const offset = Math.floor((lower + upper) / 2);
    const parts = splitElementAtTextOffset(element, offset);
    if (!hasFragmentContent(parts[0])) {
      lower = offset + 1;
      continue;
    }
    measure.append(parts[0]);
    const fits = fitsPage(measure);
    parts[0].remove();
    if (fits) {
      best = parts;
      lower = offset + 1;
    } else {
      upper = offset - 1;
    }
  }
  if (best) {
    const offset = best[0].textContent?.length ?? 0;
    const preferred = preferWordBoundary(element, offset);
    if (preferred > 0 && preferred < offset) {
      const wordParts = splitElementAtTextOffset(element, preferred);
      if (hasFragmentContent(wordParts[0])) best = wordParts;
    }
  }
  return best;
}

/** First indivisible character/atom, used only if nothing can fit an empty page. */
function firstFragment(element: HTMLElement): [HTMLElement, HTMLElement] {
  const text = element.textContent ?? "";
  let offset = text.codePointAt(0)! > 0xffff ? 2 : 1;
  let parts = splitElementAtTextOffset(element, Math.min(offset, text.length));
  if (hasFragmentContent(parts[0])) return parts;
  // A leading table or SVG can have text of its own. Include that entire atom
  // rather than repeatedly asking for a seam inside the same unsplittable node.
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
  );
  const firstText = walker.nextNode();
  const atomic = firstText ? containingAtom(firstText, element) : null;
  if (atomic) {
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    range.setEndAfter(atomic);
    offset = range.toString().length;
    parts = splitElementAtTextOffset(element, offset);
  }
  return parts;
}

function fitAtomicOnEmptyPage(element: HTMLElement, measure: HTMLElement) {
  // Prefer reducing the artwork while keeping its caption at the reading size.
  const media = mediaElements(element);
  for (let pass = 0; pass < 3 && !fitsPage(measure) && media.length; pass++) {
    const excess = measureHeight(measure) - CONTENT_HEIGHT + 2;
    for (const item of media) {
      const height = item.getBoundingClientRect().height;
      item.style.maxHeight = `${Math.max(24, height - excess / media.length)}px`;
    }
  }
  if (fitsPage(measure)) return element;

  // Extremely tall tables or figures remain one complete atom. Scale their
  // complete DOM into the page so no rows, labels, or caption text are clipped.
  const naturalHeight = measureHeight(measure);
  const scale = (CONTENT_HEIGHT - 1) / naturalHeight;
  const wrapper = document.createElement("div");
  wrapper.className = "pdf-atomic-fit";
  Object.assign(wrapper.style, {
    position: "relative",
    width: `${CONTENT_WIDTH}px`,
    height: `${CONTENT_HEIGHT - 1}px`,
    margin: "0",
    padding: "0",
    overflow: "hidden",
  });
  const content = document.createElement("div");
  Object.assign(content.style, {
    position: "absolute",
    display: "flow-root",
    width: `${CONTENT_WIDTH}px`,
    top: "0",
    left: `${(CONTENT_WIDTH * (1 - scale)) / 2}px`,
    transform: `scale(${scale})`,
    transformOrigin: "top left",
  });
  element.remove();
  content.append(element);
  wrapper.append(content);
  measure.append(wrapper);
  return wrapper;
}

export async function paginateBlocks(
  blocks: DocumentBlock[],
  options: {
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
    typography?: ReaderTypography;
  } = {},
): Promise<DocumentPage[]> {
  const { signal, onProgress, typography } = options;
  checkAborted(signal);
  if (!blocks.length) return [];
  const normalized = normalizeBlocks(blocks);
  if (!normalized.length) {
    onProgress?.(1);
    checkAborted(signal);
    return [];
  }

  const measure = document.createElement("div");
  measure.className = "pdf-typeset pdf-measure";
  measure.setAttribute("aria-hidden", "true");
  Object.assign(measure.style, {
    position: "fixed",
    left: "-20000px",
    top: "0",
    width: `${CONTENT_WIDTH}px`,
    height: "auto",
    minHeight: "0",
    maxHeight: "none",
    margin: "0",
    padding: "0",
    display: "flow-root",
    boxSizing: "border-box",
    visibility: "hidden",
    pointerEvents: "none",
    ...(typography ? typographyStyle(typography) : {}),
  });
  document.body.append(measure);

  const pages: DocumentPage[] = [];
  let current: { element: HTMLElement; chapterIndex: number }[] = [];
  let operations = 0;
  const flush = () => {
    if (!current.length) return;
    const chapterIndices = [
      ...new Set(current.map((block) => block.chapterIndex)),
    ];
    pages.push({
      html: current.map((block) => block.element.outerHTML).join(""),
      chapterIndex: chapterIndices[0],
      chapterIndices,
    });
    measure.replaceChildren();
    current = [];
  };
  const commit = (element: HTMLElement, chapterIndex: number) => {
    current.push({ element, chapterIndex });
  };

  try {
    onProgress?.(0);
    checkAborted(signal);
    if (document.fonts?.ready) await abortable(document.fonts.ready, signal);
    for (let index = 0; index < normalized.length; index++) {
      checkAborted(signal);
      const block = normalized[index];
      const template = document.createElement("template");
      template.innerHTML = block.html;
      let pending = template.content.firstElementChild as HTMLElement;
      clampMedia(pending);
      const images = prepareImageSources(pending);
      measure.append(pending);
      await Promise.all(images.map((image) => waitForImage(image, signal)));
      pending.remove();
      checkAborted(signal);

      while (pending) {
        checkAborted(signal);
        if (++operations % 20 === 0) await yieldToBrowser(signal);
        measure.append(pending);
        // Reserve enough room below headings for several lines of body text.
        if (
          pending.matches("h1,h2,h3,h4,h5,h6") &&
          current.length &&
          measureHeight(measure) > CONTENT_HEIGHT - 64
        ) {
          pending.remove();
          flush();
          measure.append(pending);
        }
        if (fitsPage(measure)) {
          commit(pending, block.chapterIndex);
          break;
        }
        pending.remove();

        if (isAtomic(pending)) {
          flush();
          measure.append(pending);
          commit(fitAtomicOnEmptyPage(pending, measure), block.chapterIndex);
          break;
        }

        const split = fittingPrefix(pending, measure);
        if (split) {
          measure.append(split[0]);
          commit(split[0], block.chapterIndex);
          flush();
          pending = split[1];
        } else if (current.length) {
          flush();
        } else {
          // A single unusually large glyph or nested atom must still advance.
          const [head, tail] = firstFragment(pending);
          const progressing = hasFragmentContent(head) ? head : pending;
          measure.append(progressing);
          commit(
            fitAtomicOnEmptyPage(progressing, measure),
            block.chapterIndex,
          );
          flush();
          if (progressing === pending || !hasFragmentContent(tail)) break;
          pending = tail;
        }
      }
      onProgress?.((index + 1) / normalized.length);
      checkAborted(signal);
    }
    flush();
    return pages;
  } finally {
    measure.remove();
  }
}
