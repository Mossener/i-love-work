import type { Book, BookChapter } from "../types";
import { contentHash, readBlob, wordCount } from "./epub";

const MAX_FILE_SIZE = 80 * 1024 * 1024;
const MAX_EXPANDED_SIZE = 250 * 1024 * 1024;
const MAX_PARAGRAPH_LENGTH = 4000;

function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
  const decode = (encoding: string) => ({ text: new TextDecoder(encoding, { fatal: true }).decode(bytes), encoding });
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return decode("utf-16le");
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return decode("utf-16be");
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return decode("utf-8");
    try { return decode("utf-8"); }
    catch { return decode("gb18030"); }
  } catch {
    throw new Error("TXT 文本编码无法识别，请先将文件另存为 UTF-8 再打开。");
  }
}

function chapterHeading(line: string): boolean {
  if (line.length > 100) return false;
  return /^第\s*[〇零一二三四五六七八九十百千万两\d]+\s*[章节回卷部篇集]/u.test(line) ||
    /^(?:chapter|book|part|volume|section)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)(?=$|[\s.:：—-])/i.test(line) ||
    /^(?:楔子|序章|序言|引子|前言|尾声|后记|结语|附录|番外)(?:$|[\s:：、—-])/.test(line);
}

function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/** TXT is always literal text. It never enters the HTML document as markup. */
export async function parseTxt(file: File | Blob, filename?: string): Promise<Book> {
  if (file.size > MAX_FILE_SIZE) throw new Error("TXT 文件过大，请选择 80 MB 以内的文件。");
  const bytes = new Uint8Array(await readBlob(file));
  const decoded = decodeText(bytes);
  const text = decoded.text.replace(/\r\n?/g, "\n").replace(/\f/g, "\n");
  if (/[\u0000-\u0008\u000b\u000e-\u001f]/.test(text))
    throw new Error("这个文件包含二进制内容，不是可阅读的 TXT 文本。请另存为 UTF-8 纯文本。");
  if (!text.trim()) throw new Error("TXT 文件为空，没有可阅读的文字。");
  const name = filename || ("name" in file ? String(file.name) : "未命名书籍.txt");
  const title = name.split(/[\\/]/).at(-1)!.replace(/\.txt$/i, "").trim() || "未命名书籍";
  const chapters: BookChapter[] = [];
  let current: { title: string; html: string[]; text: string[] } = { title: "正文", html: [], text: [] };
  let expanded = 0;
  const encoder = new TextEncoder();
  const append = (markup: string) => {
    expanded += encoder.encode(markup).byteLength;
    if (expanded > MAX_EXPANDED_SIZE) throw new Error("TXT 排版内容超过 250 MB，无法导入。");
    current.html.push(markup);
  };
  const finish = () => {
    if (!current.text.length) return;
    const index = chapters.length;
    const prose = current.text.join("\n");
    chapters.push({ id: `txt-chapter-${index}`, href: `txt-chapter-${index}`, title: current.title,
      html: current.html.join(""), text: prose, wordCount: wordCount(prose), imageCount: 0 });
  };
  for (const sourceLine of text.split("\n")) {
    const line = sourceLine.trim();
    if (!line) continue;
    if (chapterHeading(line)) {
      finish();
      current = { title: line, html: [], text: [line] };
      append(`<h1 id="txt-heading-${chapters.length}">${escapeText(line)}</h1>`);
      continue;
    }
    current.text.push(sourceLine);
    // Bound DOM text nodes so a book without line breaks can still paginate.
    for (let start = 0; start < sourceLine.length;) {
      let end = Math.min(start + MAX_PARAGRAPH_LENGTH, sourceLine.length);
      if (end < sourceLine.length && /[\uD800-\uDBFF]/.test(sourceLine[end - 1])) end--;
      append(`<p>${escapeText(sourceLine.slice(start, end))}</p>`);
      start = end;
    }
  }
  finish();
  return { id: `txt-${contentHash(bytes)}`, title, author: "作者不详", language: /\p{Script=Han}/u.test(text) ? "zh" : "en",
    description: "", chapters, toc: chapters.map(chapter => ({ title: chapter.title, chapterId: chapter.id, level: 0 })),
    wordCount: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0), imageCount: 0, resourceUrls: [],
    sourceEncoding: decoded.encoding };
}
