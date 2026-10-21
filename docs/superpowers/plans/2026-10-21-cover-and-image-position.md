# Selectable Cover Documents and Stable Reading Position

**Goal:** Allow the user to select a local PDF or Word .docx as the Q cover document and toggle book images without losing the text being read.

**Architecture:** Render local PDFs through PDF.js canvases in the existing viewer so Q remains available. Convert Word .docx to sanitized HTML and paginate it with the existing page styles. Store the selected source in IndexedDB. Stamp source prose with stable identifiers before image filtering, preserve source offsets when paragraphs split, and restore a DOM Range text anchor after pagination.

**Constraints:** Browser-local file processing; preserve the user's EPUB text; keep existing Q input-field guard and original fallback paper. Image controls affect book illustrations and added charts. DOCX is supported; binary .doc gets a clear conversion message. Cover selection and visibility survive reload. No original book content remains mounted when Q displays a cover.

## Tasks

- [x] Add and test stable text anchor stamping, split offsets, capture and restore (`reading-position.ts`, `pagination.ts`).
- [x] Add and test image filtering while preserving text and anchor IDs (`figure-visibility.ts`).
- [x] Add and test PDF/DOCX validation, conversion and selected-source persistence (`cover-document.ts`, `cover-storage.ts`).
- [x] Add cancellable PDF canvas page rendering with the local worker (`CoverPdfPages.tsx`).
- [x] Integrate cover selection/replacement/default reset in the viewer, and Q switching with independent book/cover positions.
- [x] Add a visible image toggle and restore the current text anchor after images or supplemental charts change.
- [x] Verify real PDF and DOCX covers, input errors, persisted selection, Q return, search, and repeated image toggles across split paragraphs and page spreads in a real browser.
- [x] Update README, run the complete test suite and production build, and review the changes.

Parallel ownership: cover parser/storage/render component; anchor helper/paginator; root owns viewer, image filter and integration. Each helper receives behavioral regression tests before implementation. Root verifies layout with real browser geometry.
