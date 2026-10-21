# Paperleaf Implementation Plan

> 2026-10-21 revision completed: the active entry is `src/PdfApp.tsx` / `src/pdf.css`. It uses measured A4 pagination, a PDF-style toolbar, a neutral document cover and Q reference switching. The original reader tasks below record the first implementation; see `docs/verification.md` for current acceptance evidence.

> **For agentic workers:** Use superpowers:subagent-driven-development. Independent parser and demo content tasks run in parallel; root owns UI and integration.

**Goal:** Deliver a local EPUB reader with academic typography, original figures, and honest scientific-style diagrams.

**Architecture:** Browser-only React application. The parser returns the Book contract in src/types.ts. The UI consumes Book chapters and generates SVG figures from actual statistics. IndexedDB persists imported blobs.

**Tech Stack:** React 19, TypeScript, Vite 6, JSZip, DOMPurify, Vitest/jsdom.

**Spec:** docs/superpowers/specs/2026-10-20-paperleaf-design.md

## Global Constraints

- Chinese product copy, browser-only file processing, no API keys.
- Preserve EPUB spine order and source image positions.
- Never invent research measurements; label schematic figures.
- Sanitize imported HTML and block active or external content.
- Support narrow screens and browser printing.

## Task 1: EPUB parsing

**Files:** src/lib/epub.ts, src/lib/epub.test.ts
**Interface:** parseEpub(file: File | Blob): Promise<Book>; releaseBook(book: Book): void; Book contract defined in src/types.ts.

- [x] Create in-memory EPUB fixtures with JSZip and assert title, author, spine order and relative image URLs.
- [x] Run npm test and observe failures before implementing the parser.
- [x] Parse container.xml and OPF, load EPUB 3 nav or EPUB 2 NCX, sanitize markup, rewrite resources and internal links.
- [x] Verify malformed input, malicious content and DRM failure paths.

## Task 2: Reading content and scientific figures

**Files:** src/data/demo.ts, src/components/PaperFigures.tsx
**Interfaces:** demoBook: Book; PaperFigures({book, chapterIndex, kind}): React element.

- [x] Author a self-contained Chinese demo book with original SVG illustrations, semantic headings and meaningful chapters.
- [x] Derive chapter word distributions and structural diagrams from Book metadata.
- [x] Label all added figures as reading statistics or schematics.

## Task 3: Complete reading workflow

**Files:** src/App.tsx, src/index.css, src/main.tsx, src/lib/storage.ts, src/lib/storage.test.ts
**Interfaces:** saveBook(SavedBook): Promise<void>; listBooks(): Promise<SavedBook[]>; removeBook(id): Promise<void>; savePosition(id, chapterIndex): Promise<void>.

- [x] Verify persistence contract and implement IndexedDB library plus resilient local settings.
- [x] Implement sidebar, paper view, chapter navigation, upload/drop, import errors, search, image viewer and settings.
- [x] Implement responsive and print layouts and keyboard shortcuts.
- [x] Verify imported content and settings persist across reload.

## Task 4: Integration and delivery

**Files:** README.md, start.bat, output/playwright/

- [x] Run npm test and npm run build; resolve failures.
- [x] Start Vite and exercise the full workflow using Playwright CLI, including a real generated EPUB fixture.
- [x] Review desktop/mobile screenshots and inspect print rendering.
- [x] Document install/start commands, limitations, data origin and project structure.
