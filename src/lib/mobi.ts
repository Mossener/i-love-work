import type { Book, BookChapter, BookTocItem } from "../types";
import { contentHash, readBlob, readableText, sanitizedFragment, wordCount } from "./epub";

const MAX_FILE_SIZE = 80 * 1024 * 1024;
const MAX_EXPANDED_SIZE = 250 * 1024 * 1024;
const INVALID = "这不是有效的 MOBI 文件，或文件已经损坏。";
const TOO_LARGE = "MOBI 解压后超过 250 MB，无法导入。";
const normalized = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();

interface MobiHeader {
  start: number;
  version: number;
  compression: number;
  textLength: number;
  textRecords: number;
  recordSize: number;
  trailingFlags: number;
  encoding: string;
  title: string;
  language: string;
  resourceStart: number;
  exth: Map<number, Uint8Array[]>;
}
interface Database {
  bytes: Uint8Array;
  records: Uint8Array[];
  header: MobiHeader;
}

/** Validate record bounds, DRM and size declarations before decompressing anything. */
function database(bytes: Uint8Array): Database {
  if (bytes.length < 86 || new TextDecoder().decode(bytes.subarray(60, 68)) !== "BOOKMOBI") throw new Error(INVALID);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(76);
  const directoryEnd = 78 + count * 8;
  if (count < 2 || directoryEnd > bytes.length) throw new Error(INVALID);
  const offsets: number[] = [];
  for (let index = 0; index < count; index++) {
    const offset = view.getUint32(78 + index * 8);
    if (offset < directoryEnd || offset > bytes.length || (index && offset < offsets[index - 1])) throw new Error(INVALID);
    offsets.push(offset);
  }
  const records = offsets.map((offset, index) => bytes.subarray(offset, offsets[index + 1] ?? bytes.length));
  const header = readHeader(records, 0);
  // Hybrid files retain a complete MOBI7 rendition; using it avoids changing
  // saved chapter identities when the same .mobi file is reopened.
  return { bytes, records, header };
}

function readHeader(records: Uint8Array[], start: number): MobiHeader {
  const record = records[start];
  if (!record || record.length < 132) throw new Error(INVALID);
  const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
  const uint = (offset: number) => offset + 4 <= record.length ? view.getUint32(offset) : 0;
  const headerLength = uint(20);
  if (new TextDecoder().decode(record.subarray(16, 20)) !== "MOBI" || headerLength < 116 || headerLength + 16 > record.length) throw new Error(INVALID);
  if (view.getUint16(12)) throw new Error("这本 MOBI 的正文受到 DRM 加密保护，暂时无法阅读。");
  const compression = view.getUint16(0);
  if (![1, 2].includes(compression)) throw new Error("暂不支持这本 MOBI 的 HUFF/CDIC 压缩方式，请转换为 EPUB 或 PalmDOC 压缩的 MOBI。");
  const textLength = uint(4);
  if (textLength > MAX_EXPANDED_SIZE) throw new Error(TOO_LARGE);
  const textRecords = view.getUint16(8);
  const recordSize = view.getUint16(10);
  if (!textRecords || !recordSize || start + textRecords >= records.length) throw new Error(INVALID);
  const encodingNumber = uint(28);
  if (![1252, 65001].includes(encodingNumber)) throw new Error("暂不支持这本 MOBI 的文字编码，请先转换为 UTF-8 EPUB。");
  const encoding = encodingNumber === 65001 ? "utf-8" : "windows-1252";
  const decoder = new TextDecoder(encoding);
  const titleOffset = uint(84);
  const titleLength = uint(88);
  if (titleOffset + titleLength > record.length) throw new Error(INVALID);
  const exth = new Map<number, Uint8Array[]>();
  if (uint(128) & 64) {
    const begin = 16 + headerLength;
    if (begin + 12 > record.length || new TextDecoder().decode(record.subarray(begin, begin + 4)) !== "EXTH") throw new Error(INVALID);
    const length = uint(begin + 4);
    const count = uint(begin + 8);
    const end = begin + length;
    if (length < 12 || end > record.length || count > (length - 12) / 8) throw new Error(INVALID);
    let offset = begin + 12;
    for (let index = 0; index < count; index++) {
      if (offset + 8 > end) throw new Error(INVALID);
      const type = uint(offset);
      const size = uint(offset + 4);
      if (size < 8 || offset + size > end) throw new Error(INVALID);
      const values = exth.get(type) ?? [];
      values.push(record.subarray(offset + 8, offset + size));
      exth.set(type, values);
      offset += size;
    }
  }
  const locale = record[95];
  const language = ({ 4: "zh", 9: "en", 17: "ja", 18: "ko", 7: "de", 12: "fr", 10: "es" } as Record<number, string>)[locale] ?? "und";
  return {
    start, version: uint(36), compression, textLength, textRecords, recordSize,
    trailingFlags: headerLength >= 228 ? uint(240) : 0,
    title: normalized(decoder.decode(exth.get(503)?.[0] ?? record.subarray(titleOffset, titleOffset + titleLength))),
    language: normalized(decoder.decode(exth.get(524)?.[0] ?? new TextEncoder().encode(language))),
    resourceStart: uint(108), encoding, exth,
  };
}

function trimTrailing(record: Uint8Array, flags: number): Uint8Array {
  let end = record.length;
  for (let bits = flags >>> 1; bits; bits >>>= 1) {
    if (!(bits & 1)) continue;
    let length = 0;
    let shift = 0;
    let found = false;
    for (let offset = end - 1; offset >= Math.max(0, end - 4); offset--) {
      const byte = record[offset];
      length += (byte & 127) * 2 ** shift;
      shift += 7;
      if (byte & 128) { found = true; break; }
    }
    if (!found || length < 1 || length > end) throw new Error(INVALID);
    end -= length;
  }
  if (flags & 1) {
    if (!end) throw new Error(INVALID);
    end -= (record[end - 1] & 3) + 1;
    if (end < 0) throw new Error(INVALID);
  }
  return record.subarray(0, end);
}

/** Count safely first; the same walker then copies overlapping backreferences. */
function walkPalmDoc(record: Uint8Array, maxLength: number, output?: Uint8Array): number {
  let length = 0;
  const put = (byte: number) => {
    if (length >= maxLength) throw new Error(INVALID);
    if (output) output[length] = byte;
    length++;
  };
  for (let index = 0; index < record.length; index++) {
    const byte = record[index];
    if (byte >= 1 && byte <= 8) {
      if (index + byte >= record.length) throw new Error(INVALID);
      for (let count = 0; count < byte; count++) put(record[++index]);
    } else if (byte <= 127) put(byte);
    else if (byte <= 191) {
      if (++index >= record.length) throw new Error(INVALID);
      const pair = ((byte & 63) << 8) | record[index];
      const distance = pair >>> 3;
      if (!distance || distance > length) throw new Error(INVALID);
      for (let count = 0; count < (pair & 7) + 3; count++) put(output?.[length - distance] ?? 0);
    } else {
      put(32);
      put(byte ^ 128);
    }
  }
  return length;
}

function palmDoc(record: Uint8Array, maxLength: number): Uint8Array {
  const output = new Uint8Array(walkPalmDoc(record, maxLength));
  walkPalmDoc(record, maxLength, output);
  return output;
}

function textBytes(db: Database): Uint8Array {
  const { header } = db;
  const records: Uint8Array[] = [];
  const packedSize = db.records.slice(header.start + 1, header.start + 1 + header.textRecords).reduce((sum, record) => sum + record.length, 0);
  const otherBytes = db.bytes.length - packedSize;
  let total = 0;
  for (let index = 1; index <= header.textRecords; index++) {
    const packed = trimTrailing(db.records[header.start + index], header.trailingFlags);
    const length = header.compression === 2 ? walkPalmDoc(packed, header.recordSize) : packed.length;
    if (length > header.recordSize) throw new Error(INVALID);
    total += length;
    if (total + otherBytes > MAX_EXPANDED_SIZE) throw new Error(TOO_LARGE);
    records.push(packed);
  }
  if (header.textLength && total < header.textLength) throw new Error(INVALID);
  const bytes = new Uint8Array(header.textLength || total);
  let offset = 0;
  for (const packed of records) {
    if (offset >= bytes.length) break;
    const record = header.compression === 2 ? palmDoc(packed, header.recordSize) : packed;
    const part = record.subarray(0, bytes.length - offset);
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function imageType(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const beginning = new TextDecoder().decode(bytes.subarray(0, 256));
  if (beginning.startsWith("GIF8")) return "image/gif";
  if (beginning.startsWith("BM")) return "image/bmp";
  if (beginning.startsWith("RIFF") && beginning.slice(8, 12) === "WEBP") return "image/webp";
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(beginning)) return "image/svg+xml";
  return undefined;
}

function imageLoader(db: Database, urls: string[]) {
  const cache = new Map<number, string | undefined>();
  return (index: number): string | undefined => {
    if (cache.has(index)) return cache.get(index);
    cache.set(index, undefined);
    const bytes = db.records[db.header.resourceStart + index];
    if (!bytes || index < 0) return undefined;
    const type = imageType(bytes);
    if (!type) return undefined;
    let blob: Blob;
    if (type === "image/svg+xml") {
      const svg = sanitizedFragment(new TextDecoder().decode(bytes), true).fragment.querySelector("svg");
      if (!svg) return undefined;
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      blob = new Blob([svg.outerHTML], { type });
    } else blob = new Blob([bytes.slice().buffer], { type });
    const url = URL.createObjectURL(blob);
    urls.push(url);
    cache.set(index, url);
    return url;
  };
}

function externalLink(anchor: Element, href: string) {
  if (!/^https?:\/\//i.test(href) || /[\u0000-\u0020\u007f]/.test(href)) return;
  try {
    const url = new URL(href);
    anchor.setAttribute("href", url.href);
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  } catch { /* Invalid links stay inert. */ }
}

interface Section { id: string; start: number; end: number; html: string }
interface Destination { chapterId: string; fragment?: string }

function classicChapters(db: Database, bytes: Uint8Array, image: ReturnType<typeof imageLoader>): { chapters: BookChapter[]; toc: BookTocItem[] } {
  // A single-byte view keeps MOBI's byte offsets exact even in UTF-8 books.
  const byteView = new TextDecoder("windows-1252").decode(bytes);
  const decoder = new TextDecoder(db.header.encoding);
  const body = /<body\b[^>]*>/i.exec(byteView);
  const begin = body ? body.index + body[0].length : 0;
  const closingBody = byteView.toLowerCase().lastIndexOf("</body");
  const end = closingBody >= begin ? closingBody : bytes.length;
  const breaks = Array.from(byteView.matchAll(/<\s*(?:mbp:)?pagebreak\b[^>]*>/gi)).filter((match) => match.index >= begin && match.index < end);
  const sections: Section[] = [];
  let start = begin;
  for (const match of breaks) {
    sections.push({ id: `chapter-${sections.length + 1}`, start, end: match.index, html: "" });
    start = match.index + match[0].length;
  }
  sections.push({ id: `chapter-${sections.length + 1}`, start, end, html: "" });
  // File positions may identify the opening pagebreak rather than the first
  // element after it. The omitted break bytes belong to the next chapter's
  // navigation range; clamp its actual marker to that chapter's HTML start.
  const sectionAtPosition = (position: number) => position >= 0
    ? sections.find((section) => section.start < section.end && position < section.end)
    : undefined;
  const source = document.createElement("template");
  source.innerHTML = decoder.decode(bytes);
  const numericPositions = new Set<number>();
  for (const element of source.content.querySelectorAll("a[filepos],reference[filepos]")) {
    const position = Number(element.getAttribute("filepos"));
    if (Number.isSafeInteger(position) && position >= 0 && position <= bytes.length) numericPositions.add(position);
  }
  for (const anchor of source.content.querySelectorAll("a[href]")) {
    const value = /^filepos:(\d+)$/i.exec(anchor.getAttribute("href") ?? "");
    if (value) numericPositions.add(Number(value[1]));
  }
  const destinations = new Map<number, Destination>();
  const markerPositions = new Map<string, Array<{ position: number; id: string }>>();
  for (const position of numericPositions) {
    const section = sectionAtPosition(position);
    if (!section) continue;
    let safePosition = Math.max(position, section.start);
    // Some generators point into an opening tag. Put the marker before it,
    // rather than corrupting an attribute or inserting executable markup.
    const lastOpen = byteView.lastIndexOf("<", safePosition);
    const lastClose = byteView.lastIndexOf(">", safePosition - 1);
    if (lastOpen >= section.start && lastOpen > lastClose) safePosition = lastOpen;
    while (safePosition > section.start && (bytes[safePosition] & 0xc0) === 0x80) safePosition--;
    const id = `mobi-filepos-${position}`;
    destinations.set(position, { chapterId: section.id, fragment: id });
    const list = markerPositions.get(section.id) ?? [];
    list.push({ position: safePosition, id });
    markerPositions.set(section.id, list);
  }
  for (const section of sections) {
    const parts: string[] = [];
    let cursor = section.start;
    for (const marker of (markerPositions.get(section.id) ?? []).sort((a, b) => a.position - b.position)) {
      parts.push(decoder.decode(bytes.subarray(cursor, marker.position)), `<span id="${marker.id}"></span>`);
      cursor = marker.position;
    }
    parts.push(decoder.decode(bytes.subarray(cursor, section.end)));
    section.html = parts.join("");
  }
  const chapters: BookChapter[] = [];
  const headingToc: BookTocItem[] = [];
  const fragmentSections = new Map<string, string>();
  const markerAliases = new Map<string, string>();
  for (const section of sections) {
    const template = document.createElement("template");
    template.innerHTML = section.html;
    const generatedMarkers = new Set((markerPositions.get(section.id) ?? []).map((marker) => marker.id));
    for (const marker of template.content.querySelectorAll("span[id]")) {
      if (!generatedMarkers.has(marker.id)) continue;
      let heading = marker.closest("h1,h2");
      if (!heading) {
        let next: ChildNode | null = marker.nextSibling;
        while (next && ((next.nodeType === Node.TEXT_NODE && !next.textContent?.trim()) ||
          (next.nodeType === Node.ELEMENT_NODE && generatedMarkers.has((next as Element).id)))) next = next.nextSibling;
        if (next?.nodeType === Node.ELEMENT_NODE && (next as Element).matches("h1,h2")) heading = next as Element;
      }
      // The shared reader replaces the first h1/h2 with its paper heading.
      // Attach byte-position destinations to that heading so its ID survives.
      if (heading) {
        if (!heading.id) heading.id = marker.id;
        markerAliases.set(marker.id, heading.id);
        marker.remove();
      }
    }
    for (const element of template.content.querySelectorAll("[name]")) {
      if (!element.id) element.id = element.getAttribute("name") ?? "";
    }
    for (const element of template.content.querySelectorAll("[id]")) {
      if (!fragmentSections.has(element.id)) fragmentSections.set(element.id, section.id);
    }
    section.html = template.innerHTML;
  }
  for (const destination of destinations.values()) {
    const alias = destination.fragment && markerAliases.get(destination.fragment);
    if (alias) destination.fragment = alias;
  }
  const positionOfHref = (href: string) => /^filepos:(\d+)$/i.exec(href)?.[1];
  for (const section of sections) {
    const inert = document.createElement("template");
    inert.innerHTML = section.html;
    for (const element of inert.content.querySelectorAll("img[recindex]")) {
      const index = element.getAttribute("recindex") ?? "";
      if (/^\d+$/.test(index)) element.setAttribute("src", `mobi-resource/${index}`);
    }
    for (const anchor of inert.content.querySelectorAll("a[filepos]")) {
      const position = anchor.getAttribute("filepos") ?? "";
      if (/^\d+$/.test(position)) anchor.setAttribute("href", `mobi-filepos/${position}`);
    }
    for (const anchor of inert.content.querySelectorAll("a[href]")) {
      const position = positionOfHref(anchor.getAttribute("href") ?? "");
      if (position) anchor.setAttribute("href", `mobi-filepos/${position}`);
    }
    const { fragment } = sanitizedFragment(inert.innerHTML);
    for (const element of fragment.querySelectorAll("img,image")) {
      const value = element.getAttribute("data-paperleaf-src") ?? "";
      element.removeAttribute("data-paperleaf-src");
      const match = /^mobi-resource\/(\d+)$/.exec(value);
      const url = match ? image(Number(match[1]) - 1) : undefined;
      if (url) {
        element.setAttribute("src", url);
        element.setAttribute("loading", "lazy");
        element.setAttribute("decoding", "async");
      } else element.remove();
    }
    for (const anchor of fragment.querySelectorAll("a")) {
      const href = anchor.getAttribute("data-paperleaf-href") ?? "";
      anchor.removeAttribute("data-paperleaf-href");
      const position = /^mobi-filepos\/(\d+)$/.exec(href)?.[1];
      const destination = position ? destinations.get(Number(position)) : undefined;
      let target = destination;
      if (href.startsWith("#") && href.length > 1) {
        let id = href.slice(1);
        try { id = decodeURIComponent(id); } catch { /* Keep a literal fragment. */ }
        const chapterId = inert.content.getElementById(id) ? section.id : fragmentSections.get(id);
        if (chapterId) target = { chapterId, fragment: id };
      }
      if (target) {
        anchor.setAttribute("data-chapter-id", target.chapterId);
        if (target.fragment) anchor.setAttribute("data-fragment", target.fragment);
        anchor.setAttribute("href", target.fragment ? `#${encodeURIComponent(target.fragment)}` : "#");
      } else externalLink(anchor, href);
    }
    const holder = document.createElement("div");
    holder.append(fragment);
    const text = readableText(holder);
    const imageCount = holder.querySelectorAll("img[src],svg").length;
    if (!text && !imageCount) continue;
    const usedIds = new Set(Array.from(holder.querySelectorAll("[id]"), (element) => element.id));
    Array.from(holder.querySelectorAll("h1,h2,h3,h4,h5,h6")).forEach((heading, index) => {
      const title = normalized(heading.textContent);
      if (!title) return;
      if (!heading.id) {
        let id = `mobi-heading-${section.id}-${index + 1}`;
        while (usedIds.has(id)) id += "-x";
        heading.id = id;
        usedIds.add(id);
      }
      headingToc.push({ title, chapterId: section.id, fragment: heading.id, level: Number(heading.localName[1]) - 1 });
    });
    chapters.push({
      id: section.id, href: `${section.id}.html`,
      title: normalized(holder.querySelector("h1,h2,h3")?.textContent) || `第 ${chapters.length + 1} 章`,
      html: holder.innerHTML, text, imageCount, wordCount: wordCount(text),
    });
  }
  const toc: BookTocItem[] = [];
  const guide = Array.from(source.content.querySelectorAll("reference")).find((element) => element.getAttribute("type")?.toLowerCase() === "toc");
  const tocPosition = Number(guide?.getAttribute("filepos"));
  const tocSection = guide ? sectionAtPosition(tocPosition) : undefined;
  if (tocSection) {
    const template = document.createElement("template");
    template.innerHTML = tocSection.html;
    for (const anchor of template.content.querySelectorAll("a")) {
      const position = Number(anchor.getAttribute("filepos") ?? positionOfHref(anchor.getAttribute("href") ?? ""));
      const target = destinations.get(position);
      const title = normalized(anchor.textContent);
      if (target && title && chapters.some((chapter) => chapter.id === target.chapterId)) toc.push({ ...target, title, level: 0 });
    }
  }
  if (!toc.length && headingToc.length) {
    const minimumLevel = headingToc.reduce((minimum, entry) => Math.min(minimum, entry.level), 5);
    toc.push(...headingToc.map((entry) => ({ ...entry, level: entry.level - minimumLevel })));
  }
  if (!toc.length) toc.push(...chapters.map((chapter) => ({ chapterId: chapter.id, title: chapter.title, level: 0 })));
  return { chapters, toc };
}

export async function parseMobi(file: File | Blob, filename?: string): Promise<Book> {
  if (file.size > MAX_FILE_SIZE) throw new Error("MOBI 文件过大，请选择 80 MB 以内的文件。");
  const resourceUrls: string[] = [];
  try {
    const bytes = new Uint8Array(await readBlob(file));
    const db = database(bytes);
    if (db.header.version >= 8) throw new Error("这本 MOBI 使用 KF8 结构，暂时无法解析，请转换为 EPUB。");
    const image = imageLoader(db, resourceUrls);
    const { chapters, toc } = classicChapters(db, textBytes(db), image);
    if (!chapters.length) throw new Error("MOBI 中没有可阅读的章节。");
    const metadata = (type: number) => normalized(new TextDecoder(db.header.encoding).decode(db.header.exth.get(type)?.[0] ?? new Uint8Array()));
    const author = (db.header.exth.get(100) ?? []).map((value) => normalized(new TextDecoder(db.header.encoding).decode(value))).filter(Boolean).join("、");
    const coverBytes = db.header.exth.get(201)?.[0] ?? db.header.exth.get(202)?.[0];
    const coverOffset = coverBytes?.length === 4 ? new DataView(coverBytes.buffer, coverBytes.byteOffset, 4).getUint32(0) : undefined;
    return {
      id: `mobi-${contentHash(bytes)}`,
      title: db.header.title || (filename ?? ("name" in file ? String(file.name) : "未命名书籍")).replace(/\.mobi$/i, ""),
      author: author || "作者不详", language: db.header.language || "und",
      description: readableText(sanitizedFragment(metadata(103)).fragment),
      publisher: metadata(101) || undefined,
      coverUrl: coverOffset === undefined ? undefined : image(coverOffset),
      chapters, toc, resourceUrls,
      wordCount: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
      imageCount: chapters.reduce((sum, chapter) => sum + chapter.imageCount, 0),
    };
  } catch (error) {
    resourceUrls.forEach((url) => URL.revokeObjectURL(url));
    if (error instanceof Error && /MOBI|DRM|250 MB|80 MB/.test(error.message)) throw error;
    throw new Error(INVALID);
  }
}
