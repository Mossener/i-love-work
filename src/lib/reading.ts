const CONTAINERS = new Set(["DIV", "SECTION", "ARTICLE", "MAIN"]);
const normalizedHeading = (text: string | null | undefined) =>
  (text ?? "").replace(/\s+/g, " ").trim();

export interface ChapterContent {
  parts: [string, string];
  /** The source heading's target must move with its replacement heading. */
  headingId?: string;
}

/** Split sanitized chapter markup without interpreting escaped text as new HTML. */
export function splitChapterContent(
  html: string,
  chapterTitle?: string,
): ChapterContent {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let parent = doc.body;
  while (
    parent.children.length === 1 &&
    CONTAINERS.has(parent.firstElementChild!.tagName)
  ) {
    const hasTextSiblings = Array.from(parent.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );
    if (hasTextSiblings) break;
    parent = parent.firstElementChild as HTMLElement;
  }
  const first = Array.from(parent.childNodes).find(
    (node) =>
      node.nodeType === Node.ELEMENT_NODE ||
      (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()),
  );
  const title = normalizedHeading(chapterTitle);
  const removeHeading =
    !!title &&
    first?.nodeType === Node.ELEMENT_NODE &&
    ["H1", "H2"].includes((first as Element).tagName) &&
    normalizedHeading(first.textContent) === title;
  const headingId = removeHeading
    ? (first as Element).getAttribute("id") ?? undefined
    : undefined;
  if (removeHeading) first.remove();
  const elements = [...parent.childNodes];
  const paragraphs = elements.filter(
    (node) => node.nodeType === 1 && (node as Element).tagName === "P",
  );
  if (paragraphs.length < 3)
    return {
      parts: [removeHeading ? doc.body.innerHTML : html, ""],
      ...(headingId !== undefined ? { headingId } : {}),
    };
  const splitAt = elements.indexOf(paragraphs[1]) + 1;
  const serialize = (nodes: ChildNode[]) => {
    const wrapper = doc.createElement("div");
    for (const node of nodes) wrapper.append(node.cloneNode(true));
    return wrapper.innerHTML;
  };
  return {
    parts: [
      serialize(elements.slice(0, splitAt)),
      serialize(elements.slice(splitAt)),
    ],
    ...(headingId !== undefined ? { headingId } : {}),
  };
}

export function chapterParts(
  html: string,
  chapterTitle?: string,
): [string, string] {
  return splitChapterContent(html, chapterTitle).parts;
}

const SEARCH_EXCLUDED_TAGS = new Set([
  "SVG",
  "MATH",
  "STYLE",
  "SCRIPT",
  "TEMPLATE",
]);
const SEARCH_BOUNDARY_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BR",
  "CAPTION",
  "DD",
  "DETAILS",
  "DIALOG",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HGROUP",
  "HR",
  "IMG",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "SUMMARY",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

export interface HtmlSearchMatch {
  /** Zero-based logical match ID, shared by all of its highlighted segments. */
  id: number;
  text: string;
}

interface TextRun {
  text: string;
  nodes: { node: Text; start: number; end: number }[];
}

interface SearchSegment {
  node: Text;
  start: number;
  end: number;
  id: number;
}

interface LocatedSearchMatch extends HtmlSearchMatch {
  segments: SearchSegment[];
}

/** Adjacent inline text shares a run; blocks and excluded content end it. */
function searchableRuns(root: HTMLElement): TextRun[] {
  const runs: TextRun[] = [];
  let run: TextRun = { text: "", nodes: [] };
  const flush = () => {
    if (run.nodes.length) runs.push(run);
    run = { text: "", nodes: [] };
  };
  // Undefined is a block's exit boundary. An explicit stack also handles deeply
  // nested publication markup without relying on the JavaScript call stack.
  const stack: (Node | undefined)[] = Array.from(root.childNodes).reverse();
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      flush();
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (!text) continue;
      const start = run.text.length;
      run.text += text;
      run.nodes.push({ node: node as Text, start, end: run.text.length });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).tagName.toUpperCase();
      if (SEARCH_EXCLUDED_TAGS.has(tag)) {
        flush();
        continue;
      }
      if (SEARCH_BOUNDARY_TAGS.has(tag)) {
        flush();
        stack.push(undefined);
      }
      stack.push(...Array.from(node.childNodes).reverse());
    }
  }
  flush();
  return runs;
}

function locateMatches(doc: Document, query: string): LocatedSearchMatch[] {
  const term = query.trim();
  if (!term) return [];
  // Escaping the query keeps punctuation literal. RegExp indices refer to the
  // original text, including when Unicode lowercasing would change its length.
  const pattern = new RegExp(
    term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "giu",
  );
  const matches: LocatedSearchMatch[] = [];
  for (const run of searchableRuns(doc.body)) {
    for (const match of run.text.matchAll(pattern)) {
      const start = match.index!;
      const end = start + match[0].length;
      const id = matches.length;
      const segments = run.nodes
        .filter((part) => part.start < end && part.end > start)
        .map((part) => ({
          node: part.node,
          start: Math.max(0, start - part.start),
          end: Math.min(part.end, end) - part.start,
          id,
        }));
      matches.push({ id, text: match[0], segments });
    }
  }
  return matches;
}

/** Count and navigate the same literal, case-insensitive matches as highlightHtml. */
export function findHtmlMatches(
  html: string,
  query: string,
): HtmlSearchMatch[] {
  if (!query.trim()) return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  return locateMatches(doc, query).map(({ id, text }) => ({ id, text }));
}

export function highlightHtml(html: string, query: string): string {
  if (!query.trim()) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const nodes = new Map<Text, SearchSegment[]>();
  for (const match of locateMatches(doc, query)) {
    for (const segment of match.segments) {
      const segments = nodes.get(segment.node) ?? [];
      segments.push(segment);
      nodes.set(segment.node, segments);
    }
  }
  for (const [node, segments] of nodes) {
    const text = node.textContent ?? "";
    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    for (const segment of segments) {
      fragment.append(text.slice(cursor, segment.start));
      const mark = doc.createElement("mark");
      mark.setAttribute("data-search-match", String(segment.id));
      mark.textContent = text.slice(segment.start, segment.end);
      fragment.append(mark);
      cursor = segment.end;
    }
    fragment.append(text.slice(cursor));
    node.replaceWith(fragment);
  }
  return doc.body.innerHTML;
}
