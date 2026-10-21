import DOMPurify from "dompurify";
import JSZip from "jszip";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { DocumentBlock } from "./pagination";

export interface CoverSource {
  name: string;
  blob: Blob;
}

export type CoverDocument =
  | { kind: "pdf"; filename: string; pdf: PDFDocumentProxy }
  | { kind: "docx"; filename: string; blocks: DocumentBlock[] };

const MAX_FILE_SIZE = 80 * 1024 * 1024;
const MAX_EXPANDED_SIZE = 250 * 1024 * 1024;

function checkAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
}

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("无法读取遮挡文档，请重新选择。"));
    reader.readAsArrayBuffer(blob);
  });
}

/** Check every central-directory entry before JSZip can discard duplicates. */
function validateWordZip(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const invalid = "Word 文件已损坏，请选择有效的 .docx 文档。";
  let end = -1;
  for (
    let at = view.byteLength - 22;
    at >= Math.max(0, view.byteLength - 65557);
    at--
  ) {
    if (
      view.getUint32(at, true) === 0x06054b50 &&
      at + 22 + view.getUint16(at + 20, true) === view.byteLength
    ) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error(invalid);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (
    count === 0xffff ||
    at === 0xffffffff ||
    view.getUint32(end + 12, true) === 0xffffffff
  )
    throw new Error("Word ZIP64 文档暂不支持，请另存为标准 .docx。");
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    view.getUint16(end + 8, true) !== count ||
    at + view.getUint32(end + 12, true) !== end
  )
    throw new Error(invalid);
  let size = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50)
      throw new Error(invalid);
    if (view.getUint16(at + 8, true) & 1)
      throw new Error("无法打开加密 Word 文档，请先移除密码并另存为 .docx。");
    size += view.getUint32(at + 24, true);
    if (size > MAX_EXPANDED_SIZE)
      throw new Error("Word 文档解压后超过 250 MiB，无法导入。");
    at +=
      46 +
      view.getUint16(at + 28, true) +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
    if (at > end) throw new Error(invalid);
  }
  if (at !== end) throw new Error(invalid);
}

/** Mammoth output is not trusted HTML; retain prose and embedded raster images only. */
export function sanitizeCoverHtml(html: string): string {
  const safe = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      "script",
      "style",
      "iframe",
      "object",
      "embed",
      "form",
      "input",
      "button",
      "video",
      "audio",
      "source",
      "link",
      "meta",
    ],
    FORBID_ATTR: ["style", "srcset", "autofocus", "formaction"],
  });
  const template = document.createElement("template");
  template.innerHTML = safe;
  for (const image of template.content.querySelectorAll("img")) {
    if (
      !/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[a-z\d+/=\s]+$/i.test(
        image.getAttribute("src") ?? "",
      )
    )
      image.remove();
    else image.loading = "eager";
  }
  for (const link of template.content.querySelectorAll("a")) {
    const href = link.getAttribute("href") ?? "";
    if (/^https?:\/\//i.test(href) && !/[\u0000-\u0020\u007f]/.test(href)) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    } else if (!href.startsWith("#")) link.removeAttribute("href");
  }
  return template.innerHTML;
}

export async function parseCoverFile(
  input: File | CoverSource,
  signal?: AbortSignal,
): Promise<CoverDocument> {
  checkAborted(signal);
  const source = "blob" in input ? input : { name: input.name, blob: input };
  const extension = source.name.split(".").pop()?.toLowerCase();
  if (extension !== "pdf" && extension !== "docx")
    throw new Error(
      "请选择 PDF 或 Word .docx 文档；旧版 .doc 请先另存为 .docx。",
    );
  if (source.blob.size > MAX_FILE_SIZE)
    throw new Error("遮挡文档超过 80 MiB，请选择较小的文档。");
  const buffer = await readBlob(source.blob);
  checkAborted(signal);
  const filename = source.name.slice(0, 240);
  if (extension === "pdf") {
    if (!new TextDecoder().decode(buffer.slice(0, 1024)).includes("%PDF-"))
      throw new Error("这不是有效的 PDF 文件，请重新选择。");
    const [
      pdfjs,
      worker,
      { LocalCMapReaderFactory, LocalStandardFontDataFactory },
    ] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      import("./pdf-resources"),
    ]);
    checkAborted(signal);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const loading = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      enableXfa: false,
      useWorkerFetch: false,
      CMapReaderFactory: LocalCMapReaderFactory,
      StandardFontDataFactory: LocalStandardFontDataFactory,
    });
    const abort = () => {
      void loading.destroy();
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const pdf = await loading.promise;
      checkAborted(signal);
      if (!pdf.numPages) {
        await pdf.destroy();
        throw new Error("PDF 文档没有可显示的页面。");
      }
      return { kind: "pdf", filename, pdf };
    } catch (error) {
      await loading.destroy();
      checkAborted(signal);
      if ((error as { name?: string }).name === "PasswordException")
        throw new Error("PDF 受到密码保护，请先移除密码后再导入。");
      throw new Error("PDF 文件无法解析，可能已损坏，请选择其他文件。", {
        cause: error,
      });
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
  validateWordZip(buffer);
  try {
    const zip = await JSZip.loadAsync(buffer);
    if (!zip.file("word/document.xml") || !zip.file("[Content_Types].xml"))
      throw new Error("缺少 Word 正文");
    const { default: mammoth } = await import("mammoth/mammoth.browser");
    checkAborted(signal);
    const converted = await mammoth.convertToHtml(
      { arrayBuffer: buffer },
      {
        externalFileAccess: false,
        includeEmbeddedStyleMap: false,
        ignoreEmptyParagraphs: false,
      },
    );
    checkAborted(signal);
    const html = sanitizeCoverHtml(converted.value);
    const content = new DOMParser().parseFromString(html, "text/html");
    if (!content.body.textContent?.trim() && !content.querySelector("img"))
      throw new Error("Word 文档没有可显示的内容。");
    return { kind: "docx", filename, blocks: [{ html, chapterIndex: 0 }] };
  } catch (error) {
    checkAborted(signal);
    throw new Error("Word 文档无法解析，请选择有效的 .docx 文件。", {
      cause: error,
    });
  }
}

export async function releaseCoverDocument(document: CoverDocument | null) {
  if (document?.kind === "pdf") await document.pdf.destroy();
}
