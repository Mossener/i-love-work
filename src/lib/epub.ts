import DOMPurify from "dompurify";
import JSZip from "jszip";
import type { Book, BookChapter, BookTocItem } from "../types";

const MAX_FILE_SIZE = 80 * 1024 * 1024;
const MAX_EXPANDED_SIZE = 250 * 1024 * 1024;
const HTML_TYPES = new Set(["application/xhtml+xml", "text/html"]);
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/svg+xml",
]);
const EXTENSION_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};
const HTML_TAGS = [
  "a",
  "abbr",
  "article",
  "aside",
  "b",
  "bdi",
  "bdo",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "main",
  "mark",
  "nav",
  "ol",
  "p",
  "pre",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
  "var",
  "wbr",
];
const SVG_TAGS = [
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "title",
  "desc",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "image",
];
const SAFE_ATTRIBUTES = [
  "id",
  "class",
  "title",
  "alt",
  "width",
  "height",
  "colspan",
  "rowspan",
  "scope",
  "start",
  "reversed",
  "value",
  "lang",
  "dir",
  "datetime",
  "role",
  "xmlns",
  "viewBox",
  "preserveAspectRatio",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "transform",
  "fill",
  "fill-rule",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "opacity",
  "offset",
  "stop-color",
  "stop-opacity",
  "text-anchor",
  "font-size",
  "font-family",
  "data-paperleaf-src",
  "data-paperleaf-href",
];
const TEXT_BLOCKS = new Set([
  "article",
  "aside",
  "blockquote",
  "br",
  "caption",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);

interface ManifestItem {
  id: string;
  path: string;
  mediaType: string;
  properties: string[];
}
interface LocalTarget {
  path: string;
  fragment?: string;
}
interface NavigationItem extends LocalTarget {
  title: string;
  level: number;
}
type ZipEntry = JSZip.JSZipObject & { unsafeOriginalName?: string };

function elements(parent: Document | Element, name: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS("*", name));
}

function normalizedText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** All publication paths stay relative to the ZIP root, never to the web origin. */
function normalizePath(value: string): string | undefined {
  if (
    !value ||
    /[\u0000-\u001f\u007f\\]/.test(value) ||
    value.startsWith("/") ||
    /^[a-z][a-z\d+.-]*:/i.test(value)
  )
    return undefined;
  const result: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!result.length) return undefined;
      result.pop();
    } else result.push(part);
  }
  return result.join("/") || undefined;
}

function resolveLocal(base: string, href: string): LocalTarget | undefined {
  const value = href.trim();
  if (
    !value ||
    /[\u0000-\u001f\u007f\\]/.test(value) ||
    value.startsWith("/") ||
    /^[a-z][a-z\d+.-]*:/i.test(value)
  )
    return undefined;
  const hash = value.indexOf("#");
  const fragment = hash >= 0 ? decodePath(value.slice(hash + 1)) : undefined;
  const resource = (hash >= 0 ? value.slice(0, hash) : value).split("?")[0];
  if (!resource) return { path: base, ...(fragment ? { fragment } : {}) };
  const decoded = decodePath(resource);
  if (decoded.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(decoded))
    return undefined;
  const directory = base.includes("/")
    ? base.slice(0, base.lastIndexOf("/") + 1)
    : "";
  const path = normalizePath(directory + decoded);
  return path ? { path, ...(fragment ? { fragment } : {}) } : undefined;
}

function xml(source: string, error: string): Document {
  const document = new DOMParser().parseFromString(source, "application/xml");
  if (
    elements(document, "parsererror").length ||
    document.documentElement.localName === "parsererror"
  )
    throw new Error(error);
  return document;
}

function readBlob(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () =>
      reject(new Error("无法读取 EPUB 文件，请重新选择。"));
    reader.readAsArrayBuffer(file);
  });
}

/** Read declarations before JSZip can discard duplicate entries or empty folders. */
function validateZipSize(buffer: ArrayBuffer): void {
  const view = new DataView(buffer);
  let end = -1;
  for (
    let offset = view.byteLength - 22;
    offset >= Math.max(0, view.byteLength - 65557);
    offset--
  ) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === view.byteLength
    ) {
      end = offset;
      break;
    }
  }
  const invalid = "这不是有效的 EPUB 压缩包，或 ZIP 文件已经损坏。";
  if (end < 0) throw new Error(invalid);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (
    count === 0xffff ||
    offset === 0xffffffff ||
    view.getUint32(end + 12, true) === 0xffffffff
  )
    throw new Error(
      "EPUB 使用了暂不支持的 ZIP64 格式，请重新导出为标准 EPUB。",
    );
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true))
    throw new Error("EPUB 是分卷压缩包，请选择完整的 EPUB 文件。");
  if (
    view.getUint16(end + 8, true) !== count ||
    offset + view.getUint32(end + 12, true) !== end
  )
    throw new Error(invalid);
  let expandedSize = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error(invalid);
    if (view.getUint16(offset + 8, true) & 1)
      throw new Error("这本 EPUB 的 ZIP 压缩包受到加密保护，暂时无法阅读。");
    const size = view.getUint32(offset + 24, true);
    expandedSize += size;
    if (expandedSize > MAX_EXPANDED_SIZE)
      throw new Error("EPUB 解压后超过 250 MB，无法导入。");
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
    if (offset > end) throw new Error(invalid);
  }
  if (offset !== end) throw new Error(invalid);
}

// Two independent 32-bit lanes provide a stable content key even without Web Crypto.
function contentHash(bytes: Uint8Array): string {
  let first = 2166136261;
  let second = 0x9e3779b9;
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 16777619);
    second = Math.imul(second ^ byte, 2246822519);
  }
  return (
    (first >>> 0).toString(16).padStart(8, "0") +
    (second >>> 0).toString(16).padStart(8, "0")
  );
}

function wordCount(text: string): number {
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const words =
    text
      .replace(/\p{Script=Han}/gu, " ")
      .match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return han + words;
}

function readableText(root: Node): string {
  const parts: string[] = [];
  const stack: Array<Node | string> = Array.from(root.childNodes).reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if (typeof node === "string") {
      parts.push(node);
      continue;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue ?? "");
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    if (TEXT_BLOCKS.has((node as Element).localName)) {
      parts.push(" ");
      stack.push(" ");
    }
    stack.push(...Array.from(node.childNodes).reverse());
  }
  return normalizedText(parts.join(""));
}

/** Parse inside a template: untrusted resources stay inert until replaced below. */
function sanitizedFragment(
  source: string,
  svgOnly = false,
): { fragment: DocumentFragment; title: string } {
  const template = document.createElement("template");
  template.innerHTML = source;
  const sourceTitle = Array.from(
    template.content.querySelectorAll("title"),
  ).find((title) => !title.closest("svg"));
  const title = normalizedText(sourceTitle?.textContent);
  sourceTitle?.remove();
  for (const element of template.content.querySelectorAll("*")) {
    const tag = element.localName.toLowerCase();
    const imageSource =
      tag === "img"
        ? element.getAttribute("src")
        : tag === "image"
          ? (element.getAttribute("href") ?? element.getAttribute("xlink:href"))
          : null;
    const link = tag === "a" ? element.getAttribute("href") : null;
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("data-") ||
        name.startsWith("on") ||
        [
          "src",
          "href",
          "xlink:href",
          "style",
          "srcset",
          "poster",
          "background",
        ].includes(name) ||
        /url\s*\(/i.test(attribute.value)
      )
        element.removeAttribute(attribute.name);
    }
    if (!svgOnly && imageSource)
      element.setAttribute("data-paperleaf-src", imageSource);
    if (!svgOnly && link) element.setAttribute("data-paperleaf-href", link);
  }
  const fragment = DOMPurify.sanitize(template.content, {
    ALLOWED_TAGS: svgOnly
      ? SVG_TAGS.filter((tag) => tag !== "image")
      : [...HTML_TAGS, ...SVG_TAGS],
    ALLOWED_ATTR: SAFE_ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
    FORBID_TAGS: [
      "script",
      "style",
      "iframe",
      "object",
      "embed",
      "form",
      "input",
      "button",
      "textarea",
      "select",
      "option",
      "link",
      "meta",
      "base",
      "video",
      "audio",
      "source",
      "track",
      "foreignObject",
      "animate",
      "set",
    ],
    FORBID_CONTENTS: [
      "script",
      "style",
      "iframe",
      "object",
      "embed",
      "form",
      "video",
      "audio",
      "foreignObject",
    ],
    RETURN_DOM_FRAGMENT: true,
  }) as DocumentFragment;
  return { fragment, title };
}

function plainDescription(value: string): string {
  return readableText(sanitizedFragment(value).fragment);
}

function navigationFromHtml(source: string, path: string): NavigationItem[] {
  const template = document.createElement("template");
  template.innerHTML = source;
  const navs = Array.from(template.content.querySelectorAll("nav"));
  const nav =
    navs.find(
      (element) =>
        (
          element.getAttribute("epub:type") ??
          element.getAttribute("type") ??
          ""
        )
          .split(/\s+/)
          .includes("toc") || element.getAttribute("role") === "doc-toc",
    ) ?? navs[0];
  if (!nav) return [];
  return Array.from(nav.querySelectorAll("a[href]")).flatMap((anchor) => {
    const target = resolveLocal(path, anchor.getAttribute("href") ?? "");
    const title = normalizedText(anchor.textContent);
    let level = -1;
    for (
      let parent = anchor.parentElement;
      parent && parent !== nav;
      parent = parent.parentElement
    )
      if (parent.localName === "ol" || parent.localName === "ul") level++;
    return target && title
      ? [{ ...target, title, level: Math.max(0, level) }]
      : [];
  });
}

function navigationFromNcx(source: string, path: string): NavigationItem[] {
  const document = xml(source, "EPUB 的 NCX 目录已损坏。");
  return elements(document, "navPoint").flatMap((point) => {
    const content = Array.from(point.children).find(
      (child) => child.localName === "content",
    );
    const label = Array.from(point.children).find(
      (child) => child.localName === "navLabel",
    );
    const target = resolveLocal(path, content?.getAttribute("src") ?? "");
    const title = normalizedText(label?.textContent);
    let level = 0;
    for (
      let parent = point.parentElement;
      parent;
      parent = parent.parentElement
    )
      if (parent.localName === "navPoint") level++;
    return target && title ? [{ ...target, title, level }] : [];
  });
}

export async function parseEpub(file: File | Blob): Promise<Book> {
  if (file.size > MAX_FILE_SIZE)
    throw new Error("EPUB 文件过大，请选择 80 MB 以内的文件。");
  const buffer = await readBlob(file);
  validateZipSize(buffer);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error("这不是有效的 EPUB 压缩包，或 ZIP 文件已经损坏。");
  }
  const entries = new Map<string, ZipEntry>();
  for (const candidate of Object.values(zip.files) as ZipEntry[]) {
    const original = candidate.unsafeOriginalName ?? candidate.name;
    const path = normalizePath(original);
    if (!path) throw new Error("EPUB 包含不安全的文件路径，无法导入。");
    if (candidate.dir) continue;
    entries.set(path, candidate);
  }
  const read = async (path: string, error: string): Promise<string> => {
    const entry = entries.get(path);
    if (!entry) throw new Error(error);
    try {
      return await entry.async("string");
    } catch {
      throw new Error(error);
    }
  };
  const containerError = "EPUB 缺少或损坏容器文件 META-INF/container.xml。";
  const container = xml(
    await read("META-INF/container.xml", containerError),
    containerError,
  );
  const rootfiles = elements(container, "rootfile");
  const rootfile =
    rootfiles.find(
      (element) =>
        element.getAttribute("media-type") === "application/oebps-package+xml",
    ) ?? rootfiles[0];
  const opfPath = resolveLocal(
    "",
    rootfile?.getAttribute("full-path") ?? "",
  )?.path;
  const opfError = "EPUB 缺少或损坏 OPF 书籍描述文件。";
  if (!opfPath) throw new Error(opfError);
  const opf = xml(await read(opfPath, opfError), opfError);
  if (opf.documentElement.localName !== "package") throw new Error(opfError);
  const manifest = new Map<string, ManifestItem>();
  for (const element of elements(opf, "item")) {
    const target = resolveLocal(opfPath, element.getAttribute("href") ?? "");
    const id = element.getAttribute("id") ?? "";
    if (target && id)
      manifest.set(id, {
        id,
        path: target.path,
        mediaType: (element.getAttribute("media-type") ?? "").toLowerCase(),
        properties: (element.getAttribute("properties") ?? "").split(/\s+/),
      });
  }
  const spineItems = elements(opf, "itemref")
    .filter((element) => element.getAttribute("linear")?.toLowerCase() !== "no")
    .map((element) => manifest.get(element.getAttribute("idref") ?? ""))
    .filter(
      (item): item is ManifestItem => !!item && HTML_TYPES.has(item.mediaType),
    );
  if (!spineItems.length) throw new Error("EPUB 中没有可阅读的章节。");

  const encrypted = new Set<string>();
  if (entries.has("META-INF/encryption.xml")) {
    const encryption = xml(
      await read("META-INF/encryption.xml", "EPUB 加密信息已损坏。"),
      "EPUB 加密信息已损坏。",
    );
    for (const reference of elements(encryption, "CipherReference")) {
      const target = resolveLocal("", reference.getAttribute("URI") ?? "");
      if (target) encrypted.add(target.path);
    }
  }
  if (spineItems.some((item) => encrypted.has(item.path)))
    throw new Error("这本 EPUB 的正文受到 DRM 加密保护，暂时无法阅读。");

  const resourceUrls: string[] = [];
  const images = new Map<string, string | undefined>();
  const mediaTypes = new Map(
    Array.from(manifest.values(), (item) => [item.path, item.mediaType]),
  );
  const imageUrl = async (path: string): Promise<string | undefined> => {
    if (images.has(path)) return images.get(path);
    const entry = entries.get(path);
    const declaredType = mediaTypes.get(path);
    const type =
      declaredType && IMAGE_TYPES.has(declaredType)
        ? declaredType
        : EXTENSION_TYPES[path.split(".").pop()?.toLowerCase() ?? ""];
    images.set(path, undefined);
    if (!entry || !type || encrypted.has(path)) return undefined;
    let blob: Blob;
    if (type === "image/svg+xml") {
      const { fragment } = sanitizedFragment(await entry.async("string"), true);
      const svg = fragment.querySelector("svg");
      if (!svg) return undefined;
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      blob = new Blob([svg.outerHTML], { type });
    } else {
      blob = new Blob([await entry.async("arraybuffer")], { type });
    }
    const url = URL.createObjectURL(blob);
    resourceUrls.push(url);
    images.set(path, url);
    return url;
  };

  try {
    const navigation: NavigationItem[] = [];
    const nav = Array.from(manifest.values()).find((item) =>
      item.properties.includes("nav"),
    );
    if (nav && entries.has(nav.path))
      navigation.push(
        ...navigationFromHtml(
          await read(nav.path, "EPUB 目录无法读取。"),
          nav.path,
        ),
      );
    if (!navigation.length) {
      const ncxId = elements(opf, "spine")[0]?.getAttribute("toc");
      const ncx =
        (ncxId ? manifest.get(ncxId) : undefined) ??
        Array.from(manifest.values()).find(
          (item) => item.mediaType === "application/x-dtbncx+xml",
        );
      if (ncx && entries.has(ncx.path))
        navigation.push(
          ...navigationFromNcx(
            await read(ncx.path, "EPUB 目录无法读取。"),
            ncx.path,
          ),
        );
    }
    const chapterIds = new Map<string, string>();
    const chapterItems: ManifestItem[] = [];
    spineItems.forEach((item, index) => {
      if (!chapterIds.has(item.path)) {
        chapterIds.set(item.path, `chapter-${index + 1}`);
        chapterItems.push(item);
      }
    });
    const primaryPaths = new Set(chapterIds.keys());
    const htmlItems = new Map(
      Array.from(manifest.values())
        .filter((item) => HTML_TYPES.has(item.mediaType))
        .map((item) => [item.path, item]),
    );
    const chapters: BookChapter[] = [];
    // Start with every primary chapter. Linked notes join the same queue after
    // them, so nonlinear documents never interrupt the spine's reading order.
    for (const item of chapterItems) {
      const source = await read(
        item.path,
        `EPUB 章节文件无法读取：${item.path}`,
      );
      const { fragment, title: documentTitle } = sanitizedFragment(source);
      for (const image of fragment.querySelectorAll("img,image")) {
        const target = resolveLocal(
          item.path,
          image.getAttribute("data-paperleaf-src") ?? "",
        );
        image.removeAttribute("data-paperleaf-src");
        const url = target ? await imageUrl(target.path) : undefined;
        if (url) {
          image.setAttribute(image.localName === "image" ? "href" : "src", url);
          if (image.localName === "img") {
            image.setAttribute("loading", "lazy");
            image.setAttribute("decoding", "async");
          }
        } else image.remove();
      }
      for (const anchor of fragment.querySelectorAll("a")) {
        const href = anchor.getAttribute("data-paperleaf-href") ?? "";
        anchor.removeAttribute("data-paperleaf-href");
        const target = resolveLocal(item.path, href);
        if (target && !chapterIds.has(target.path)) {
          const referenced = htmlItems.get(target.path);
          if (
            referenced &&
            entries.has(target.path) &&
            !encrypted.has(target.path)
          ) {
            // Register before enqueueing so repeated references and note cycles
            // resolve to one document with a deterministic ID.
            chapterIds.set(
              target.path,
              `chapter-aux-${contentHash(new TextEncoder().encode(target.path))}`,
            );
            chapterItems.push(referenced);
          }
        }
        const chapterId = target && chapterIds.get(target.path);
        if (chapterId) {
          anchor.setAttribute("data-chapter-id", chapterId);
          if (target.fragment)
            anchor.setAttribute("data-fragment", target.fragment);
          anchor.setAttribute(
            "href",
            target.fragment ? `#${encodeURIComponent(target.fragment)}` : "#",
          );
        } else if (
          /^https?:\/\//i.test(href) &&
          !/[\u0000-\u0020\u007f]/.test(href)
        ) {
          try {
            const url = new URL(href);
            anchor.setAttribute("href", url.href);
            anchor.setAttribute("target", "_blank");
            anchor.setAttribute("rel", "noopener noreferrer");
          } catch {
            /* Invalid references remain plain text. */
          }
        }
      }
      const title =
        navigation.find((entry) => entry.path === item.path)?.title ||
        normalizedText(fragment.querySelector("h1,h2,h3")?.textContent) ||
        documentTitle ||
        `第 ${chapters.length + 1} 章`;
      const holder = document.createElement("div");
      holder.append(fragment);
      const text = readableText(holder);
      const imageCount = holder.querySelectorAll("img[src],svg").length;
      if (!text && !imageCount) continue;
      chapters.push({
        id: chapterIds.get(item.path)!,
        href: item.path,
        title,
        html: holder.innerHTML,
        text,
        wordCount: wordCount(text),
        imageCount,
        ...(!primaryPaths.has(item.path) ? { auxiliary: true } : {}),
      });
    }
    if (!chapters.length) throw new Error("EPUB 中没有可阅读的章节。");
    const readable = new Set(chapters.map((chapter) => chapter.id));
    const toc: BookTocItem[] = navigation.flatMap((entry) => {
      const chapterId = chapterIds.get(entry.path);
      return chapterId && readable.has(chapterId)
        ? [
            {
              title: entry.title,
              chapterId,
              ...(entry.fragment ? { fragment: entry.fragment } : {}),
              level: entry.level,
            },
          ]
        : [];
    });
    if (!toc.length)
      toc.push(
        ...chapters.map((chapter) => ({
          title: chapter.title,
          chapterId: chapter.id,
          level: 0,
        })),
      );
    const coverItem =
      Array.from(manifest.values()).find((item) =>
        item.properties.includes("cover-image"),
      ) ??
      manifest.get(
        elements(opf, "meta")
          .find((element) => element.getAttribute("name") === "cover")
          ?.getAttribute("content") ?? "",
      );
    const coverUrl = coverItem ? await imageUrl(coverItem.path) : undefined;
    const metadata = elements(opf, "metadata")[0] ?? opf.documentElement;
    const textOf = (tag: string) =>
      normalizedText(elements(metadata, tag)[0]?.textContent);
    const authors = elements(metadata, "creator")
      .map((element) => normalizedText(element.textContent))
      .filter(Boolean);
    const fallbackTitle =
      "name" in file ? String(file.name).replace(/\.epub$/i, "") : "未命名书籍";
    return {
      id: `epub-${contentHash(new Uint8Array(buffer))}`,
      title: textOf("title") || fallbackTitle,
      author: authors.join("、") || "作者不详",
      language: textOf("language") || "zh",
      description: plainDescription(textOf("description")),
      publisher: textOf("publisher") || undefined,
      coverUrl,
      chapters,
      toc,
      wordCount: chapters.reduce(
        (total, chapter) => total + chapter.wordCount,
        0,
      ),
      imageCount: chapters.reduce(
        (total, chapter) => total + chapter.imageCount,
        0,
      ),
      resourceUrls,
    };
  } catch (error) {
    resourceUrls.forEach((url) => URL.revokeObjectURL(url));
    if (error instanceof Error && /EPUB|DRM/.test(error.message)) throw error;
    throw new Error("EPUB 内容无法解析，文件可能已经损坏。");
  }
}

export function releaseBook(book: Book): void {
  for (const url of book.resourceUrls) URL.revokeObjectURL(url);
  book.resourceUrls.length = 0;
}
