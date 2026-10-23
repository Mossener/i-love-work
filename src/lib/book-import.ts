import type { Book, BookFormat } from "../types";
import { parseEpub, readBlob } from "./epub";

export const BOOK_FILE_ACCEPT = ".epub,.mobi,.txt,application/epub+zip,application/x-mobipocket-ebook,text/plain";

export interface BookImportOptions {
  format?: BookFormat;
  filename?: string;
}

type BookFileInfo = Pick<Blob, "type"> & { name?: string };

function importFilename(file: BookFileInfo, options: BookImportOptions): string | undefined {
  return options.filename?.trim() || file.name?.trim() || undefined;
}

function filenameExtension(filename: string | undefined): string | undefined {
  return filename?.match(/\.([^./\\]+)$/)?.[1].toLowerCase();
}

/** Metadata detection is synchronous so file pickers and drag/drop use the same rules. */
export function detectBookFormat(file: BookFileInfo, options: BookImportOptions = {}): BookFormat | null {
  if (options.format) {
    return ["epub", "mobi", "txt"].includes(options.format) ? options.format : null;
  }
  const extension = filenameExtension(importFilename(file, options));
  if (extension) {
    return extension === "epub" || extension === "mobi" || extension === "txt"
      ? extension
      : null;
  }
  const mime = file.type.toLowerCase().split(";", 1)[0].trim();
  if (mime === "application/epub+zip") return "epub";
  if (mime === "application/x-mobipocket-ebook") return "mobi";
  if (mime === "text/plain") return "txt";
  return null;
}

/** Import files and restore nameless IndexedDB blobs through the same parsers. */
export async function parseBook(file: File | Blob, options: BookImportOptions = {}): Promise<Book> {
  const filename = importFilename(file, options);
  let format = detectBookFormat(file, options);
  if (!format && !options.format && !filenameExtension(filename)) {
    // Old EPUB records have neither a stored format nor a filename. Some browser
    // storage implementations also drop their MIME type; the EPUB parser still
    // validates the archive and its container after this narrow ZIP signature check.
    const header = new Uint8Array(await readBlob(file.slice(0, 4)));
    if (header.length === 4 && header[0] === 0x50 && header[1] === 0x4b &&
      ((header[2] === 3 && header[3] === 4) || (header[2] === 5 && header[3] === 6))) {
      format = "epub";
    }
  }
  if (!format) throw new Error("请选择 EPUB、MOBI 或 TXT 格式的阅读文件。");

  // Preserve a saved filename for metadata fallbacks even if IndexedDB returned
  // only a Blob. Do not change parser content IDs: existing EPUB marks depend on them.
  const source = filename && (!("name" in file) || file.name !== filename)
    ? new File([file], filename, { type: file.type })
    : file;
  let book: Book;
  if (format === "epub") book = await parseEpub(source);
  else if (format === "mobi") book = await (await import("./mobi")).parseMobi(source, filename);
  else book = await (await import("./txt")).parseTxt(source, filename);
  return { ...book, format, ...(filename ? { filename } : {}) };
}
