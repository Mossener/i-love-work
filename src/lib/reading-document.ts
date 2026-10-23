import type { Book } from "../types";
import { buildDocumentBlocks, DEFAULT_DOCUMENT_METADATA } from "./document";
import { stampReadingAnchors } from "./reading-position";

export function buildReadingBlocks(book: Book) {
  // Keep the established source identities: old bookmarks were stamped after
  // the three paper preamble blocks. Only the cover keeps that generated prose.
  // Filtering after stamping also keeps image/figure toggles position-stable.
  return stampReadingAnchors(buildDocumentBlocks(book, DEFAULT_DOCUMENT_METADATA, true)).slice(3);
}
