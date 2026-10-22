import { useEffect, useState } from "react";
import type { CoverDocument } from "./cover-document";
import {
  applyFigureVisibility,
} from "./figure-visibility";
import {
  paginateBlocks,
  type DocumentPage,
} from "./pagination";
import { stampReadingAnchors } from "./reading-position";

export interface WordPagesState {
  pages: DocumentPage[];
  ready: boolean;
  paginating: boolean;
}

const EMPTY: WordPagesState = {
  pages: [],
  ready: false,
  paginating: false,
};

const IMAGE_ONLY_NOTICE: DocumentPage = {
  html: '<p class="pdf-image-only-notice">图片已隐藏；当前文档没有可显示的文字。</p>',
  chapterIndex: 0,
  chapterIndices: [0],
};

const LAYOUT_ERROR: DocumentPage = {
  html: "<p>Word 文档排版失败，请重新选择文档。</p>",
  chapterIndex: 0,
  chapterIndices: [0],
};

interface WordLayout {
  source: Extract<CoverDocument, { kind: "docx" }>;
  images: boolean;
  pages: DocumentPage[];
  ready: boolean;
  settled: boolean;
}

/**
 * Build a Word cover's visible pages from its already-parsed source.
 *
 * The source object remains owned by useCoverDocument. This hook only derives
 * a cancellable presentation, so toggling images never reparses or rewrites
 * the selected file.
 */
export function useWordPages(
  document: CoverDocument | null,
  images: boolean,
  notify: (message: string) => void,
): WordPagesState {
  const [layout, setLayout] = useState<WordLayout | null>(null);

  useEffect(() => {
    if (document?.kind !== "docx") {
      setLayout(null);
      return;
    }

    const controller = new AbortController();
    const source = document;
    setLayout(previous => ({
      source,
      images,
      pages: previous?.source === source ? previous.pages : [],
      ready: previous?.source === source && previous.ready,
      settled: false,
    }));

    void (async () => {
      try {
        // Stamp the original blocks so both modes share source identities and
        // offsets for restoreReadingAnchor, even when image-only blocks vanish.
        const blocks = applyFigureVisibility(
          stampReadingAnchors(source.blocks),
          { images, generated: true },
        );
        const pages = await paginateBlocks(blocks, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setLayout({
          source,
          images,
          pages: pages.length ? pages : [IMAGE_ONLY_NOTICE],
          ready: true,
          settled: true,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        notify(error instanceof Error ? error.message : "Word 文档无法排版。");
        setLayout(previous => ({
          source,
          images,
          pages: previous?.source === source && previous.pages.length
            ? previous.pages
            : [LAYOUT_ERROR],
          ready: true,
          settled: true,
        }));
      }
    })();

    return () => controller.abort();
  }, [document, images, notify]);

  if (document?.kind !== "docx") return EMPTY;
  const sameSource = layout?.source === document;
  return {
    pages: sameSource ? layout.pages : [],
    ready: sameSource && layout.ready,
    // Derive this from current inputs: effects run too late for consumers
    // deciding whether it is safe to restore a saved reading position.
    paginating: !(sameSource && layout.images === images && layout.settled),
  };
}
