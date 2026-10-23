# I Love Work · 我爱上班

[简体中文](README.md) · [English](README.en.md)

[MIT License](LICENSE)

**A paper on the screen. One more chapter in mind.**

A local **EPUB / MOBI / TXT reader** with the quiet appearance of an A4 document viewer. Read the original book, then press `Q` to switch to a PDF paper or Word document you have chosen.

[Download for Windows](https://github.com/Mossener/i-love-work/releases/latest) · [Quick start](#quick-start) · [Keyboard shortcuts](#keyboard-shortcuts) · [Run from source](#run-from-source)

![EPUB reader with a chapter outline, A4 pages, and reading controls](docs/images/reader.png)

## Quick start

### Windows x64 release

Current version: **v1.2.0**.

1. Download the **Windows x64 ZIP** from [Releases](https://github.com/Mossener/i-love-work/releases/latest).
2. Extract the entire archive to a folder you intend to keep, such as `D:\Apps\ILoveWork`.
3. Double-click **`start.vbs`**. Your default browser opens [http://127.0.0.1:5173](http://127.0.0.1:5173/), and the app stays in the Windows **system tray** at the bottom right.
4. Open an **`.epub`, `.mobi`, or `.txt`** book, or drag one onto the page.

The release includes a Node.js runtime and the built application. **No separate Node.js installation or npm commands are needed, and normal startup leaves no command window open.** `start.bat` forwards to the same tray launcher. Extract the complete folder first; do not run from inside the ZIP or copy the launcher on its own.

### Tray controls

| Action | Result |
| --- | --- |
| Double-click the icon / choose “打开阅读器” | Open the reader again |
| Choose “打开启动日志” | View the startup log |
| Choose “退出” | Close the tray app and the local server it started |

The server keeps running after you close the browser tab. Launching again opens the existing instance. If the icon is hidden, check the tray overflow area. When the launcher reuses a development server you started manually, exiting the tray leaves that server running.

Logs are stored in `%LOCALAPPDATA%\ILoveWork\<instance directory>\`. The default port remains `5173`; if another program occupies it, the launcher reports the problem instead of silently choosing a different port.

## What it does

| Read your book | Use a cover document |
| --- | --- |
| EPUB 2 / EPUB 3, MOBI, and TXT with chapter outlines and navigation | Choose a local PDF or Word `.docx`, or use the built-in paper |
| Font size, line spacing, font family, and paper / sepia / dark themes | Preserve a PDF’s original layout, outline, and page links |
| Bookmarks, highlights, notes, search, and reading progress | Search PDF text with highlights; navigate Word headings and search its text |
| Text anchors restore your passage after image or typography changes | Press `Q` to switch; optionally cover when the pointer leaves the page |
| Local library with filtering, sorting, and per-book progress | Zoom, turn pages, and print or export the complete current document |

### Your book stays separate from the paper template

Reading mode retains the book’s text and supported illustrations. **It does not insert the cover paper’s title, abstract, or keywords.** EPUB, MOBI, and TXT share the same library, search, bookmarks, notes, and progress features. The built-in paper and your chosen PDF / Word document appear in cover mode.

Keep original illustrations and captions, and click an illustration to enlarge it. The image button hides or restores EPUB and MOBI images. Word cover documents have a separate image preference, so the two settings do not affect each other. After hiding images, changing typography, or repaginating, the reader restores your **source text position** instead of relying on a page number that may have changed. When only a full-page image is visible, it uses the nearest passage.

The `»` menu also controls optional statistics and structure diagrams. Text distribution is computed from the source book’s Chinese characters / English words; the sequence diagram follows its chapter order. Captions explain what the diagrams represent. They do not invent experimental results. Image removal is unavailable for PDFs because their original layout is preserved.

### Importing MOBI and TXT

Use the open-file control, `Ctrl+O`, or drag and drop to import `.mobi` / `.txt` directly. No EPUB conversion is needed. These books support the same cover switching, typography, text search, bookmarks, and saved reading positions.

TXT import detects UTF-8 and BOM-marked UTF-16 LE / BE, with a fallback for common Chinese GB18030 text. Titles such as `第一章`, `第12章`, or `Chapter 1` create a chapter outline. Text without recognized headings is read as one continuous document. HTML-like text is displayed literally, not executed as a webpage. Encoding and chapter conventions vary; if text appears garbled, save it as UTF-8 and import it again.

MOBI import supports common DRM-free MOBI 6 / 7 books, embedded illustrations, and outlines, with uncompressed or PalmDOC-compressed content. Outlines use the book’s HTML table of contents or headings; navigation stored only in a binary NCX index is not imported. Hybrid MOBI files use their legacy rendition. Convert pure KF8, AZW3, or HUFF/CDIC-compressed books to EPUB first; DRM decryption is unavailable. Books are reflowed into A4 pages.

### Bookmarks, notes, and reading progress

- Use the outline to reach a chapter or target passage. Local book links support chapters, footnotes, and endnotes. The back button or `Alt+←` returns to the reference.
- Move between chapters, drag the progress slider, or revisit earlier navigation with back / forward. Progress percentages follow the current pagination.
- Add a bookmark for the current position, or select text and choose the highlight-and-note action. Highlights support yellow, green, blue, and pink.
- The notes panel supports searching, filtering, editing, and jumping to the source. Export Markdown notes or back up and restore JSON. Imports merge records for the same book and retain existing local content with the same ID.
- Filter the library by title or author, then sort by recent reading, title, or date added. Resume after a refresh or after switching books.

Each book supports up to 1,000 bookmarks and annotations. A selection may contain up to 12,000 characters, and JSON backups are limited to 20 MiB. Export backups regularly.

### PDF / Word covers

![Cover mode with the built-in academic paper and its chapter outline](docs/images/cover.png)

Choose a local **PDF or `.docx`** with the cover-document button. PDFs use their embedded outline and links; Word outlines are built from headings. If a document has no outline, the sidebar provides a page list. Word retains text, tables, and embedded images, then reflows them into A4 pages.

`Ctrl+F` searches the document currently on screen. `Enter` / `Shift+Enter` moves to the next / previous match. **PDF search and highlighting require extractable text. Image-only scanned PDFs have no OCR support.**

Press `Q` to show the cover and press it again to return to the book. It also works after a toolbar button has focus. The book and cover retain separate reading positions. Typing q in an input or editable area does not switch modes.

Pointer-leave covering is enabled by default: leaving the page’s display area with the mouse activates cover mode. **Moving back does not reveal the book**; press `Q` to return. Disable the behavior from the `»` menu if preferred. It pauses during imports, dialog editing, and file dragging; touch taps do not trigger it.

Printing handles the complete current document. Books and Word documents can be exported to PDF through the browser’s print dialog. A selected PDF can be downloaded unchanged or opened in its original form for printing. Zoom and two-page spreads work for books and cover documents; narrow screens use one page.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Q` | Switch between book and cover |
| `Ctrl+O` | Open an EPUB / MOBI / TXT |
| `Ctrl+F` / `Ctrl+K` | Search the current document |
| `Enter` / `Shift+Enter` | Next / previous search result |
| `←` / `→`, `PageUp` / `PageDown` | Previous / next page |
| `Space` / `Shift+Space` | Next / previous page |
| `Home` / `End` | Beginning / end of the document |
| `Ctrl+D` | Add a bookmark |
| `Alt+←` / `Alt+→` | Back / forward in navigation history |
| `Esc` | Close search, an image preview, or a dialog |

Reading shortcuts pause in inputs, editable areas, and dialogs to avoid interfering with typing. In the browser version on macOS, supported `Ctrl` combinations use `⌘`. The tray release is for Windows only. The interface and tray menus currently use Chinese labels.

## Local data and privacy

Books and cover documents are parsed in the browser. **Files are not uploaded, and no account or AI API key is required.** Document scripts do not run; active content and external images are sanitized during import. PDF fonts, character maps, and other parser resources ship with the application.

Files are stored in IndexedDB. Bookmarks, notes, text positions, reading preferences, image settings, and similar state use browser local storage. Keep using the **same browser profile and `http://127.0.0.1:5173` address** to retain access to your library. A different browser, private window, `localhost` address, or port uses a separate storage space. Clearing site data deletes the library and saved records, so retain your original files and exported annotation backups.

The browser tab uses a neutral PDF filename by default. Document properties can adjust the filename and paper-style header information without replacing the book’s text.

## Run from source

Development requires **Node.js 20 or later**.

```sh
git clone https://github.com/Mossener/i-love-work.git
cd i-love-work
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173/). Keep the terminal open for this development server; stop it with `Ctrl+C`.

```sh
npm run build     # Check TypeScript and build dist/
npm run preview   # Preview the production build
npm test          # Run tests
```

On Windows, `start.vbs` also works from a source checkout. It serves the production build when `dist/` and the production server script are present; otherwise it uses Vite from the installed dependencies. **The source repository does not include a Node.js runtime**; it is bundled only in the Windows release ZIP. After editing source files, rebuild `dist/` or use `npm run dev`.

## Supported formats and limits

- Common DRM-free **EPUB 2 / EPUB 3, MOBI 6 / 7, and TXT** reading files: **80 MiB** per file. Expanded EPUB / MOBI content and generated TXT layout content are limited to **250 MiB**.
- MOBI supports uncompressed / PalmDOC-compressed content and UTF-8 / Windows-1252 text; hybrid files use their legacy rendition. Pure KF8, `.azw` / `.azw3` / `.kfx` imports, and HUFF/CDIC compression are unsupported. Convert them to EPUB first.
- TXT supports UTF-8, UTF-16 LE / BE with a BOM, and common Chinese GB18030 text. Its chapter outline is inferred from headings; custom chapter conventions may not be recognized.
- Unencrypted PDF and `.docx` cover documents: **80 MiB** per file; Word extraction is limited to **250 MiB**. Convert older `.doc` files to `.docx` first.
- EPUB and MOBI content is reflowed into the document layout; complex CSS and fixed layouts may not match the original. Complex Word layouts, headers, footers, and manual page breaks may also differ.
- No DRM decryption. EPUB / Word import does not support ZIP64 or split ZIP archives. Document scripts, audio / video, and scanned-PDF OCR are unsupported. Large image-heavy books may use substantial memory.
- The Windows release is an x64 ZIP. Other systems can run the web reader from source; no macOS app bundle or standalone single-file `.exe` is currently provided.

## Project layout

```text
src/PdfApp.tsx                 Reader, library, search, and mode switching
src/lib/book-import.ts         Reading format detection and import
src/lib/epub.ts                EPUB parsing, sanitization, and resources
src/lib/mobi.ts                MOBI parsing and text / image conversion
src/lib/txt.ts                 TXT encoding detection and chapter extraction
src/lib/reading-document.ts    Isolation between books and paper templates
src/lib/pagination.ts          A4 measurement and pagination
src/lib/reading-position.ts    Source text anchors and position restoration
src/lib/reader-marks.ts        Bookmarks, highlights, notes, and backups
src/lib/pdf-navigation.ts      PDF outlines, links, and text search
src/lib/cover-document.ts      PDF / Word import
scripts/reader-tray.ps1        Windows tray and server lifecycle
scripts/reader-server.mjs      Local production server
```

A [sample EPUB](public/samples/paperleaf-sample.epub) is included for checking chapter links, text, and illustrations. See the [icon notice](assets/icons/NOTICE.md) for its source and license.
