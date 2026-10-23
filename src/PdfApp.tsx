import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  ChevronDown,
  ChevronUp,
  ChevronsRight,
  Columns2,
  Download,
  FileCheck2,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  ImageOff,
  List,
  LoaderCircle,
  Minus,
  MoreHorizontal,
  PanelBottom,
  PanelLeft,
  Plus,
  Printer,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { paperDemoBook } from "./data/paper-demo";
import { releaseBook } from "./lib/epub";
import { BOOK_FILE_ACCEPT, detectBookFormat, parseBook } from "./lib/book-import";
import { listBooks, removeBook, saveBook, savePosition } from "./lib/storage";
import { findHtmlMatches, highlightHtml } from "./lib/reading";
import {
  buildDocumentBlocks,
  DEFAULT_DOCUMENT_METADATA,
  type DocumentMetadata,
} from "./lib/document";
import {
  paginateBlocks,
  PAGE_WIDTH,
  PAGE_HEIGHT,
  type DocumentPage,
} from "./lib/pagination";
import type { Book, SavedBook } from "./types";
import { applyFigureVisibility } from "./lib/figure-visibility";
import { captureReadingAnchor, restoreReadingAnchor, stampReadingAnchors, type ReadingAnchor } from "./lib/reading-position";
import { useCoverDocument } from "./lib/use-cover-document";
import { useWordPages } from "./lib/use-word-pages";
import { canAutoCoverOnPointerLeave } from "./lib/auto-cover";
import { PdfCanvasPage } from "./components/CoverPdfPages";
import { buildReadingBlocks } from "./lib/reading-document";
import { loadPdfOutline, searchPdfDocument, type PdfOutlineItem, type PdfSearchMatch, type PdfDestination } from "./lib/pdf-navigation";
import { waitForPdfPrintReady } from "./lib/print-readiness";
import { ReaderPreferencesDialog } from "./components/ReaderPreferencesDialog";
import { documentScale, useBrowserZoom } from "./lib/use-browser-zoom";
import { readReaderPreferences, writeReaderPreferences, typographyStyle, type ReaderPreferences } from "./lib/reader-preferences";
import { ReaderMarksPanel } from "./components/ReaderMarksPanel";
import { applyMarksToHtml, captureTextSelection, createBookmark, createHighlight, readMarks, writeMarks, exportMarksMarkdown, serializeMarks, importMarks, MAX_MARKS_BACKUP_BYTES, MAX_READER_MARKS, type CapturedTextSelection, type ReaderMark } from "./lib/reader-marks";
import { findChapterFragment, findChapterTarget, pageHorizontalScroll, readReadingProgress, writeReadingProgress, pageToProgress, progressToPage } from "./lib/reader-navigation";
import "./reader-tools.css";

const NO_MARKS: ReaderMark[] = [];
interface NavigationLocation { anchor: ReadingAnchor | null; page: number }

const get = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const put = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Session reading works without persistence. */
  }
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "无法打开文档，请重试。";
function readMetadata(): DocumentMetadata {
  try {
    const value = JSON.parse(get("paper-pdf-metadata") || "null");
    return Object.fromEntries(
      Object.entries(DEFAULT_DOCUMENT_METADATA).map(([key, fallback]) => [
        key,
        typeof value?.[key] === "string" && value[key].trim()
          ? value[key].trim().slice(0, 400)
          : fallback,
      ]),
    ) as unknown as DocumentMetadata;
  } catch {
    return { ...DEFAULT_DOCUMENT_METADATA };
  }
}

function readAnchor(bookId: string): ReadingAnchor | null {
  try {
    const anchor = JSON.parse(get(`paper-pdf-anchor:${bookId}`) || "null");
    return anchor && typeof anchor.id === "string" && Number.isFinite(anchor.offset) && Number.isFinite(anchor.viewportY) ? anchor : null;
  } catch { return null; }
}

const PageSheet = memo(function PageSheet({
  page,
  index,
  total,
  scale,
  metadata,
  query,
  onContentClick,
  sourceFilename,
  preferences,
  marks,
}: {
  page: DocumentPage;
  index: number;
  total: number;
  scale: number;
  metadata: DocumentMetadata;
  query: string;
  onContentClick: (event: React.MouseEvent<HTMLElement>) => void;
  sourceFilename?: string;
  preferences?: ReaderPreferences;
  marks: ReaderMark[];
}) {
  const html = useMemo(
    () => highlightHtml(applyMarksToHtml(page.html, marks), query),
    [page.html, query, marks],
  );
  return (
    <div
      className="pdf-page-frame"
      data-page-index={index}
      style={{ width: PAGE_WIDTH * scale, height: PAGE_HEIGHT * scale }}
    >
      <article
        className={`pdf-sheet ${preferences ? "reader-book-page" : ""}`}
        aria-label={`第 ${index + 1} 页，共 ${total} 页`}
        style={{ transform: `scale(${scale})` }}
        onClick={onContentClick}
      >
        {index > 0 && (
          <header className="pdf-running-header">
            <span>
              {sourceFilename || <>{metadata.journal} <strong>{metadata.year}</strong></>}
            </span>
            <span>
              {index + 1} of {total}
            </span>
          </header>
        )}
        <div
          className={`pdf-page-body pdf-typeset ${index === 0 ? "is-first-page" : ""}`}
          style={preferences ? typographyStyle(preferences) : undefined}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <footer className="pdf-page-footer">{index + 1}</footer>
      </article>
    </div>
  );
});

export default function PdfApp() {
  const [book, setBook] = useState<Book>(paperDemoBook);
  const [library, setLibrary] = useState<SavedBook[]>([]);
  const [metadata, setMetadata] = useState<DocumentMetadata>(readMetadata);
  const [preferences, setPreferences] = useState(readReaderPreferences);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [readerToolbarOpen, setReaderToolbarOpen] = useState(false);
  const typography = useMemo(() => ({ fontSize: preferences.fontSize, lineHeight: preferences.lineHeight, fontFamily: preferences.fontFamily }), [preferences.fontSize, preferences.lineHeight, preferences.fontFamily]);
  const [draft, setDraft] = useState<DocumentMetadata>(metadata);
  const [documentState, setDocumentState] = useState<{
    id: string;
    pages: DocumentPage[];
    layoutKey: string;
  }>({ id: "", pages: [], layoutKey: "" });
  const [referencePages, setReferencePages] = useState<DocumentPage[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const [zoom, setZoom] = useState(get("paper-pdf-zoom") || "auto");
  const [spread, setSpread] = useState(get("paper-pdf-spread") !== "false");
  const [showFigures, setShowFigures] = useState(
    get("paper-pdf-figures") !== "false",
  );
  const [bookShowImages, setBookShowImages] = useState(get("paper-pdf-images") !== "false");
  const [coverShowImages, setCoverShowImages] = useState(get("paper-pdf-cover-images") !== "false");
  const [printing, setPrinting] = useState(false);
  const printController = useRef<AbortController | null>(null);
  const [pdfOutline, setPdfOutline] = useState<PdfOutlineItem[]>([]);
  const [pdfOutlineLoading, setPdfOutlineLoading] = useState(false);
  const [pdfSearchState, setPdfSearchState] = useState<{ source: unknown; query: string; matches: PdfSearchMatch[]; loading: boolean }>({ source: null, query: "", matches: [], loading: false });
  const [autoCoverEnabled, setAutoCoverEnabled] = useState(
    get("paper-pdf-auto-cover") !== "false",
  );
  const [viewport, setViewport] = useState({
    width: innerWidth,
    height: innerHeight - 44,
  });
  const [sidebar, setSidebar] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"outline" | "files" | "marks">("outline");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySort, setLibrarySort] = useState("recent");
  const [progressRevision, setProgressRevision] = useState(0);
  const [markState, setMarkState] = useState<{ bookId: string; marks: ReaderMark[] }>(() => ({ bookId: paperDemoBook.id, marks: readMarks(paperDemoBook.id) }));
  const [selectedMark, setSelectedMark] = useState<string>();
  const [textSelection, setTextSelection] = useState<CapturedTextSelection | null>(null);
  const marks = markState.bookId === book.id ? markState.marks : NO_MARKS;
  const [backStack, setBackStack] = useState<NavigationLocation[]>([]);
  const [forwardStack, setForwardStack] = useState<NavigationLocation[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [coverSettingsOpen, setCoverSettingsOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [matchIndex, setMatchIndex] = useState(0);
  const [concealed, setConcealed] = useState(false);
  const [importing, setImporting] = useState(false);
  const [paginationRunning, setPaginating] = useState(true);
  const [paginationProgress, setPaginationProgress] = useState(0);
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [image, setImage] = useState<{ src: string; caption: string } | null>(
    null,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const coverFileRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const readerToolbarToggleRef = useRef<HTMLButtonElement>(null);
  const loadingRef = useRef(false);
  const desiredPage = useRef<number | null>(0);
  const desiredChapter = useRef<number | null>(null);
  const dragDepth = useRef(0);
  const scrollFrame = useRef(0);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedChapter = useRef("");
  const contentClickRef = useRef<(event: React.MouseEvent<HTMLElement>) => void>(() => {});
  const handleContentClick = useCallback((event: React.MouseEvent<HTMLElement>) => contentClickRef.current(event), []);
  const pendingReadingAnchor = useRef<ReadingAnchor | null>(null);
  const pendingMarkJump = useRef<ReaderMark | null>(null);
  const [markJumpRevision, setMarkJumpRevision] = useState(0);
  const pendingCoverAnchor = useRef<ReadingAnchor | null>(null);
  const originalPosition = useRef<{ fraction: number; page: number; anchor: ReadingAnchor | null }>({ fraction: 0, page: 0, anchor: null });
  const coverPosition = useRef<{ fraction: number; page: number; anchor: ReadingAnchor | null }>({ fraction: 0, page: 0, anchor: null });
  const notify = useCallback((text: string) => setNotice(text), []);
  const { cover, loading: coverLoading, importCover, resetCover } = useCoverDocument(notify);
  const wordPages = useWordPages(cover?.document ?? null, coverShowImages, notify);
  const showImages = concealed ? coverShowImages : bookShowImages;
  const chosenCoverPages = useMemo(() => cover?.document.kind === "pdf"
    ? Array.from({ length: cover.document.pdf.numPages }, () => ({ html: "", chapterIndex: 0, chapterIndices: [0] }))
    : cover?.document.kind === "docx" ? wordPages.pages : referencePages, [cover, wordPages.pages, referencePages]);
  const effectiveMetadata = metadata;
  const pages = concealed ? chosenCoverPages : documentState.pages;
  const ready = concealed
    ? chosenCoverPages.length > 0
    : documentState.id === book.id && documentState.pages.length > 0;
  const bookLayoutKey = JSON.stringify([book.id, showFigures, bookShowImages, typography]);
  const paginating = paginationRunning || documentState.layoutKey !== bookLayoutKey;
  const columns = spread && viewport.width >= 760 ? 2 : 1;
  const fitWidth = Math.max(
    0.15,
    (viewport.width - 36 - (columns - 1) * 12) / columns / PAGE_WIDTH,
  );
  const scale = documentScale(zoom, fitWidth, (viewport.height - 26) / PAGE_HEIGHT);
  useBrowserZoom(zoom, scale, setZoom);
  const pageTotal = pages.length;
  const coverIsPdf = concealed && cover?.document.kind === "pdf";
  const selectedPdf = cover?.document.kind === "pdf" ? cover.document.pdf : null;
  const activePdf = coverIsPdf ? selectedPdf : null;
  const activePaginating = concealed ? cover?.document.kind === "docx" && wordPages.paginating : paginating;
  const imageToggleDisabled = coverIsPdf || (concealed && !cover) || activePaginating || !ready;
  const coverReady = chosenCoverPages.length > 0 && !(
    cover?.document.kind === "docx" && wordPages.paginating
  );
  const previousLayout = useRef({ scale, columns });
  const readingPercent = pageToProgress(currentPage, pageTotal);
  const currentChapterIndex = Math.max(0, pages[currentPage]?.chapterIndex ?? 0);
  const visibleLibrary = useMemo(() => {
    const term = libraryQuery.trim().toLocaleLowerCase();
    return library.filter(saved => `${saved.title} ${saved.author}`.toLocaleLowerCase().includes(term)).sort((a, b) => librarySort === "title" ? a.title.localeCompare(b.title, "zh") : librarySort === "added" ? b.addedAt - a.addedAt : (readReadingProgress(b.id)?.updatedAt ?? b.addedAt) - (readReadingProgress(a.id)?.updatedAt ?? a.addedAt));
  }, [library, libraryQuery, librarySort, progressRevision]);

  useEffect(() => {
    document.documentElement.removeAttribute("data-theme");
  }, []);
  useEffect(() => {
    document.title = concealed && cover ? cover.document.filename : effectiveMetadata.filename.toLowerCase().endsWith(".pdf")
      ? effectiveMetadata.filename
      : `${effectiveMetadata.filename}.pdf`;
  }, [effectiveMetadata.filename, concealed, cover]);
  useEffect(() => {
    put("paper-pdf-metadata", JSON.stringify(metadata));
  }, [metadata]);
  useEffect(() => {
    put("paper-pdf-zoom", zoom);
  }, [zoom]);
  useEffect(() => {
    put("paper-pdf-spread", String(spread));
  }, [spread]);
  useEffect(() => {
    put("paper-pdf-figures", String(showFigures));
  }, [showFigures]);
  useEffect(() => { put("paper-pdf-images", String(bookShowImages)); }, [bookShowImages]);
  useEffect(() => { put("paper-pdf-cover-images", String(coverShowImages)); }, [coverShowImages]);
  useEffect(() => { put("paper-pdf-auto-cover", String(autoCoverEnabled)); }, [autoCoverEnabled]);
  useEffect(() => {
    setMarkState({ bookId: book.id, marks: readMarks(book.id) });
    setSelectedMark(undefined);
    setBackStack([]);
    setForwardStack([]);
  }, [book.id]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 6500);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => () => releaseBook(book), [book]);
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setViewport({ width: element.clientWidth, height: element.clientHeight }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    listBooks()
      .then(async (files) => {
        if (cancelled) return;
        setLibrary(files);
        const saved = files.find(
          (file) => file.id === get("paperleaf-active-book"),
        );
        if (!saved || loadingRef.current) return;
        loadingRef.current = true;
        setImporting(true);
        try {
          const parsed = await parseBook(saved.file, { format: saved.format, filename: saved.filename });
          if (cancelled) releaseBook(parsed);
          else {
            const storedPage = Number(get(`paper-pdf-position:${parsed.id}`));
            pendingReadingAnchor.current = readAnchor(parsed.id);
            desiredPage.current = storedPage > 0 ? storedPage - 1 : null;
            desiredChapter.current = saved.chapterIndex;
            setBook(parsed);
          }
        } catch (error) {
          if (!cancelled) notify(errorText(error));
        } finally {
          loadingRef.current = false;
          if (!cancelled) setImporting(false);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [notify]);
  useEffect(() => {
    const controller = new AbortController();
    paginateBlocks(
      stampReadingAnchors(buildDocumentBlocks(paperDemoBook, metadata, true)),
      { signal: controller.signal },
    )
      .then(setReferencePages)
      .catch(() => {});
    return () => controller.abort();
  }, [metadata]);
  useEffect(() => {
    const controller = new AbortController();
    setPaginating(true);
    setPaginationProgress(0);
    const stamped = buildReadingBlocks(book);
    paginateBlocks(applyFigureVisibility(stamped, { images: bookShowImages, generated: showFigures }), {
      signal: controller.signal,
      onProgress: setPaginationProgress,
      typography,
    })
      .then((nextPages) => {
        if (!controller.signal.aborted) {
          setDocumentState({ id: book.id, pages: nextPages, layoutKey: bookLayoutKey });
          setPaginating(false);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setPaginating(false);
          notify(errorText(error));
        }
      });
    return () => controller.abort();
  }, [book, showFigures, bookShowImages, typography, bookLayoutKey, notify]);

  const goToPage = useCallback(
    (value: number, behavior: ScrollBehavior = "auto") => {
      const index = Math.max(0, Math.min(value, pages.length - 1));
      if (!pages.length) return;
      viewportRef.current?.scrollTo({
        top: Math.floor(index / columns) * (PAGE_HEIGHT * scale + 12),
        left: pageHorizontalScroll(viewportRef.current, index),
        behavior,
      });
      setCurrentPage(index);
      setPageInput(String(index + 1));
    },
    [pages.length, columns, scale],
  );

  const goToPdfDestination = useCallback((target: PdfDestination) => {
    const index = Math.max(0, Math.min(pages.length - 1, target.page));
    const top = Math.max(0, Math.min(1, target.top ?? 0));
    viewportRef.current?.scrollTo({ top: Math.floor(index / columns) * (PAGE_HEIGHT * scale + 12) + top * PAGE_HEIGHT * scale, left: pageHorizontalScroll(viewportRef.current, index) });
    setCurrentPage(index);
    setPageInput(String(index + 1));
  }, [pages.length, columns, scale]);

  useEffect(() => {
    const controller = new AbortController();
    setPdfOutline([]);
    if (!selectedPdf) { setPdfOutlineLoading(false); return; }
    setPdfOutlineLoading(true);
    void loadPdfOutline(selectedPdf, controller.signal).then(items => {
      if (!controller.signal.aborted) setPdfOutline(items);
    }).catch(error => { if (!controller.signal.aborted) notify(errorText(error)); })
      .finally(() => { if (!controller.signal.aborted) setPdfOutlineLoading(false); });
    return () => controller.abort();
  }, [selectedPdf, notify]);

  useEffect(() => {
    const controller = new AbortController();
    if (!activePdf || !findOpen || !deferredQuery) {
      setPdfSearchState({ source: activePdf, query: deferredQuery, matches: [], loading: false });
      return;
    }
    setPdfSearchState({ source: activePdf, query: deferredQuery, matches: [], loading: true });
    const timer = setTimeout(() => {
      void searchPdfDocument(activePdf, deferredQuery, controller.signal).then(matches => {
        if (!controller.signal.aborted) setPdfSearchState({ source: activePdf, query: deferredQuery, matches, loading: false });
      }).catch(error => {
        if (!controller.signal.aborted) {
          setPdfSearchState({ source: activePdf, query: deferredQuery, matches: [], loading: false });
          notify(errorText(error));
        }
      });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [activePdf, findOpen, deferredQuery, notify]);

  useLayoutEffect(() => {
    if (!concealed || cover?.document.kind !== "docx" || !ready || wordPages.paginating) return;
    if (pendingCoverAnchor.current && viewportRef.current) {
      const index = restoreReadingAnchor(viewportRef.current, pendingCoverAnchor.current);
      pendingCoverAnchor.current = null;
      if (index !== null) {
        setCurrentPage(index);
        setPageInput(String(index + 1));
        return;
      }
    }
    setCurrentPage(value => Math.min(value, pages.length - 1));
  }, [concealed, cover, ready, wordPages.paginating, pages]);

  useLayoutEffect(() => {
    const previous = previousLayout.current;
    previousLayout.current = { scale, columns };
    const element = viewportRef.current;
    if (
      !element ||
      !ready ||
      (previous.scale === scale && previous.columns === columns)
    )
      return;
    const previousStep = PAGE_HEIGHT * previous.scale + 12;
    const fraction = Math.max(
      0,
      Math.min(
        1,
        element.scrollTop / previousStep -
          Math.floor(currentPage / previous.columns),
      ),
    );
    element.scrollTop =
      (Math.floor(currentPage / columns) + fraction) *
      (PAGE_HEIGHT * scale + 12);
  }, [scale, columns, ready, currentPage]);

  useLayoutEffect(() => {
    if (!ready || concealed || paginating) return;
    if (pendingReadingAnchor.current && viewportRef.current) {
      const restored = restoreReadingAnchor(viewportRef.current, pendingReadingAnchor.current);
      pendingReadingAnchor.current = null;
      if (restored !== null) {
        desiredPage.current = null;
        desiredChapter.current = null;
        setCurrentPage(restored);
        setPageInput(String(restored + 1));
        return;
      }
    }
    if (desiredPage.current !== null || desiredChapter.current !== null) {
      const index =
        desiredPage.current ??
        Math.max(
          0,
          pages.findIndex((page) =>
            page.chapterIndices.includes(desiredChapter.current!),
          ),
        );
      const frame = requestAnimationFrame(() => {
        goToPage(index);
        desiredPage.current = null;
        desiredChapter.current = null;
      });
      return () => cancelAnimationFrame(frame);
    }
    setCurrentPage((value) => Math.min(value, pages.length - 1));
  }, [ready, pages, concealed, goToPage, paginating]);
  useEffect(() => {
    setPageInput(String(currentPage + 1));
  }, [currentPage]);
  const saveCurrentProgress = useCallback(() => {
    if (
      concealed ||
      !ready ||
      paginating ||
      importing ||
      documentState.id !== book.id
    )
      return;
    const element = viewportRef.current;
    if (!element || element.dataset.readingBookId !== book.id) return;
    const index = Math.max(0, Number(element.dataset.readingCurrentPage) || 0);
    const page = documentState.pages[index];
    if (!page) return;
    writeReadingProgress(book.id, { page: index, chapterIndex: Math.max(0, page.chapterIndex), percent: pageToProgress(index, documentState.pages.length), anchor: captureReadingAnchor(element), updatedAt: Date.now() });
    setProgressRevision(value => value + 1);
    const key = `${book.id}:${page.chapterIndex}`;
    if (!book.isDemo && savedChapter.current !== key) {
      savedChapter.current = key;
      void savePosition(book.id, Math.max(0, page.chapterIndex)).catch(() => {});
    }
  }, [book.id, book.isDemo, ready, paginating, importing, concealed, documentState]);

  useEffect(() => {
    const element = viewportRef.current;
    const schedule = () => {
      clearTimeout(progressTimer.current);
      progressTimer.current = setTimeout(saveCurrentProgress, 300);
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") saveCurrentProgress(); };
    schedule();
    element?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("pagehide", saveCurrentProgress);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(progressTimer.current);
      element?.removeEventListener("scroll", schedule);
      window.removeEventListener("pagehide", saveCurrentProgress);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [saveCurrentProgress]);

  const captureLocation = useCallback((): NavigationLocation => ({
    anchor: viewportRef.current ? captureReadingAnchor(viewportRef.current) : null,
    page: currentPage,
  }), [currentPage]);
  const rememberLocation = useCallback(() => {
    if (concealed || !ready || paginating) return;
    const location = captureLocation();
    setBackStack(value => [...value.slice(-49), location]);
    setForwardStack([]);
  }, [concealed, ready, paginating, captureLocation]);
  const restoreLocation = useCallback((location: NavigationLocation) => {
    const index = location.anchor && viewportRef.current
      ? restoreReadingAnchor(viewportRef.current, location.anchor) : null;
    if (index !== null) setCurrentPage(index);
    else goToPage(location.page);
  }, [goToPage]);

  useLayoutEffect(() => {
    if (!pendingMarkJump.current || concealed || paginating || !ready) return;
    let secondFrame = 0;
    const frame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const mark = pendingMarkJump.current;
        const root = viewportRef.current;
        if (!mark || !root) return;
        pendingMarkJump.current = null;
        const index = restoreReadingAnchor(root, mark.anchor);
        if (index !== null) setCurrentPage(index);
        else {
          const heading = findChapterTarget(root, mark.chapterIndex);
          if (heading) { heading.scrollIntoView({ block: "start", inline: "nearest" }); setCurrentPage(Number(heading.closest<HTMLElement>("[data-page-index]")?.dataset.pageIndex) || 0); }
          else goToPage(Math.max(0, pages.findIndex(page => page.chapterIndices.includes(mark.chapterIndex))));
          notify("旧书签的文字位置已失效，已定位到对应章节。请重新添加此书签。");
        }
      });
    });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(secondFrame); };
  }, [markJumpRevision, scale, columns, sidebar, concealed, paginating, ready, pages, goToPage, notify]);
  const navigateHistory = useCallback((direction: "back" | "forward") => {
    const stack = direction === "back" ? backStack : forwardStack;
    const location = stack.at(-1);
    if (!location || concealed || paginating) return;
    const current = captureLocation();
    if (direction === "back") {
      setBackStack(stack.slice(0, -1));
      setForwardStack(value => [...value.slice(-49), current]);
    } else {
      setForwardStack(stack.slice(0, -1));
      setBackStack(value => [...value.slice(-49), current]);
    }
    restoreLocation(location);
  }, [backStack, forwardStack, concealed, paginating, captureLocation, restoreLocation]);

  useEffect(() => {
    setTextSelection(null);
    const onSelection = () => {
      const selection = window.getSelection();
      if (concealed || paginating || !selection || !viewportRef.current) {
        setTextSelection(null);
        return;
      }
      setTextSelection(captureTextSelection(viewportRef.current, selection));
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, [book.id, concealed, paginating]);

  const updateMarks = (next: ReaderMark[]) => {
    if (next.length > MAX_READER_MARKS) { notify("每本书最多保存 1000 条书签和批注，请先导出并整理。"); return; }
    setMarkState({ bookId: book.id, marks: next });
    if (!writeMarks(book.id, next)) notify("批注暂时保存在本次页面中，浏览器空间不足，请导出备份。");
  };
  const addBookmark = () => {
    if (concealed || !ready || paginating || !viewportRef.current) return;
    const anchor = captureReadingAnchor(viewportRef.current);
    if (!anchor) { notify("当前位置没有可保存的正文，请滚动到文字后添加书签。"); return; }
    const node = [...viewportRef.current.querySelectorAll<HTMLElement>("[data-reading-anchor]")]
      .find(element => element.dataset.readingAnchor === anchor.id &&
        (Number(element.dataset.readingStart) || 0) <= anchor.offset &&
        (Number(element.dataset.readingStart) || 0) + (element.textContent?.length || 0) > anchor.offset);
    const quote = (node?.textContent || "").slice(Math.max(0, anchor.offset - (Number(node?.dataset.readingStart) || 0)), Math.max(0, anchor.offset - (Number(node?.dataset.readingStart) || 0)) + 140);
    const existing = marks.find(mark => mark.kind === "bookmark" && mark.anchor.id === anchor.id && Math.abs(mark.anchor.offset - anchor.offset) < 10);
    const sourceChapter = /^c(\d+)-/.exec(anchor.id);
    const mark = existing || createBookmark(anchor, sourceChapter ? Number(sourceChapter[1]) : currentChapterIndex, quote);
    if (!existing) updateMarks([...marks, mark]);
    setSelectedMark(mark.id); setSidebarTab("marks"); setSidebar(true);
  };
  const addSelection = () => {
    if (concealed || paginating) return;
    const selection = viewportRef.current && window.getSelection()
      ? captureTextSelection(viewportRef.current, window.getSelection()!) : textSelection;
    if (!selection) { notify("请先用鼠标选中正文（最多 12000 字），再添加划线。"); return; }
    const source = /^c(-?\d+)-/.exec(selection.anchor.id);
    const mark = createHighlight(selection, source ? Math.max(0, Number(source[1])) : currentChapterIndex);
    updateMarks([...marks, mark]);
    window.getSelection()?.removeAllRanges(); setTextSelection(null);
    setSelectedMark(mark.id); setSidebarTab("marks"); setSidebar(true);
  };
  const exportNotes = (format: "markdown" | "json") => {
    let text: string;
    try { text = format === "json" ? serializeMarks(book.id, book.title, marks) : exportMarksMarkdown(book.title, marks, book.chapters.map(chapter => chapter.title)); }
    catch (error) { notify(errorText(error)); return; }
    const url = URL.createObjectURL(new Blob([text], { type: format === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `${book.title.replace(/[<>:"/\\|?*]/g, "_")}-笔记.${format === "json" ? "json" : "md"}`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importNotes = async (file: File) => {
    const id = book.id;
    if (file.size > MAX_MARKS_BACKUP_BYTES) { notify("备份文件过大，请选择 20 MB 以内的 JSON 文件。"); return; }
    try {
      const value = importMarks(await file.text(), id, readMarks(id));
      if (!writeMarks(id, value)) throw new Error("浏览器无法保存批注，请检查存储空间。");
      setMarkState(current => current.bookId === id ? { bookId: id, marks: value } : current);
      notify(`已合并批注备份，共 ${value.length} 条。`);
    } catch (error) { notify(errorText(error)); }
  };

  const toggleReference = useCallback(() => {
    printController.current?.abort();
    setPrinting(false);
    pendingMarkJump.current = null;
    saveCurrentProgress();
    setMenuOpen(false);
    setFindOpen(false);
    setPropertiesOpen(false);
    setCoverSettingsOpen(false);
    setPreferencesOpen(false);
    setSidebar(false);
    setImage(null);
    setTextSelection(null);
    window.getSelection()?.removeAllRanges();
    setQuery("");
    setNotice("");
    if (!concealed) {
      const fraction =
        (viewportRef.current?.scrollTop || 0) / (PAGE_HEIGHT * scale + 12) -
        Math.floor(currentPage / columns);
      originalPosition.current = {
        fraction: Math.max(0, Math.min(1, fraction)),
        page: currentPage,
        anchor: pendingReadingAnchor.current || (viewportRef.current ? captureReadingAnchor(viewportRef.current, { nearest: false }) : null),
      };
      setConcealed(true);
      const targetPage = Math.min(coverPosition.current.page, chosenCoverPages.length - 1);
      setCurrentPage(Math.max(0, targetPage));
      pendingCoverAnchor.current = coverPosition.current.anchor;
      if (!coverPosition.current.anchor) requestAnimationFrame(() => viewportRef.current?.scrollTo({ top: (Math.floor(Math.max(0, targetPage) / columns) + coverPosition.current.fraction) * (PAGE_HEIGHT * scale + 12) }));
    } else {
      coverPosition.current = {
        page: currentPage,
        fraction: Math.max(0, Math.min(1, (viewportRef.current?.scrollTop || 0) / (PAGE_HEIGHT * scale + 12) - Math.floor(currentPage / columns))),
        anchor: pendingCoverAnchor.current || (cover?.document.kind === "docx" && viewportRef.current ? captureReadingAnchor(viewportRef.current, { nearest: false }) : null),
      };
      pendingReadingAnchor.current = originalPosition.current.anchor;
      setConcealed(false);
      setCurrentPage(originalPosition.current.page);
      if (!originalPosition.current.anchor) requestAnimationFrame(() =>
        viewportRef.current?.scrollTo({
          top:
            (Math.floor(originalPosition.current.page / columns) +
              originalPosition.current.fraction) *
            (PAGE_HEIGHT * scale + 12),
        }),
      );
    }
  }, [concealed, currentPage, scale, columns, chosenCoverPages.length, cover, saveCurrentProgress]);

  useEffect(() => {
    const root = document.documentElement;
    const onPointerLeave = (event: PointerEvent) => {
      if (!canAutoCoverOnPointerLeave({
        enabled: autoCoverEnabled,
        concealed,
        bookReady: !concealed && ready && !paginating,
        coverReady,
        importing,
        coverLoading,
        coverSettingsOpen,
        propertiesOpen: propertiesOpen || preferencesOpen || printing,
        imageOpen: Boolean(image),
        dragging,
      }, event)) return;
      toggleReference();
    };
    root.addEventListener("pointerleave", onPointerLeave);
    return () => root.removeEventListener("pointerleave", onPointerLeave);
  }, [
    autoCoverEnabled,
    concealed,
    ready,
    paginating,
    coverReady,
    importing,
    coverLoading,
    coverSettingsOpen,
    propertiesOpen,
    preferencesOpen,
    printing,
    image,
    dragging,
    toggleReference,
  ]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest(
        "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
      );
      if (
        event.key.toLowerCase() === "q" &&
        !typing &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.repeat &&
        !event.isComposing
      ) {
        event.preventDefault();
        toggleReference();
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        ["f", "k"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        setFindOpen(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        fileRef.current?.click();
      }
      if (event.key === "Escape") {
        setFindOpen(false);
        setMenuOpen(false);
        setPropertiesOpen(false);
        setCoverSettingsOpen(false);
        setPreferencesOpen(false);
        setImage(null);
        setSidebar(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleReference, coverIsPdf]);
  useEffect(() => {
    if (findOpen) requestAnimationFrame(() => findRef.current?.focus());
  }, [findOpen]);
  useEffect(() => {
    if (!propertiesOpen && !image && !coverSettingsOpen && !preferencesOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const elements = () => [
      ...(dialog?.querySelectorAll<HTMLElement>(
        "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]",
      ) || []),
    ];
    elements()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      const all = elements();
      if (event.key !== "Tab" || !all.length) return;
      if (event.shiftKey && document.activeElement === all[0]) {
        event.preventDefault();
        all[all.length - 1].focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === all[all.length - 1]
      ) {
        event.preventDefault();
        all[0].focus();
      }
    };
    dialog?.addEventListener("keydown", trap);
    return () => {
      dialog?.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [propertiesOpen, image, coverSettingsOpen, preferencesOpen]);

  const pdfSearching = Boolean(activePdf && findOpen && deferredQuery && (pdfSearchState.source !== activePdf || pdfSearchState.query !== deferredQuery || pdfSearchState.loading));
  const matches = useMemo((): { page: number; occurrence: number; top?: number }[] => {
    if (!deferredQuery) return [];
    if (activePdf) return pdfSearchState.source === activePdf && pdfSearchState.query === deferredQuery ? pdfSearchState.matches : [];
    return pages.flatMap((page, index) =>
      findHtmlMatches(page.html, deferredQuery).map((match) => ({
        page: index,
        occurrence: match.id,
      })),
    );
  }, [pages, deferredQuery, activePdf, pdfSearchState]);
  const jumpToMatch = useCallback(
    (index: number) => {
      if (!matches.length) return;
      rememberLocation();
      const next = (index + matches.length) % matches.length;
      setMatchIndex(next);
      if (activePdf) { goToPdfDestination(matches[next]); return; }
      goToPage(matches[next].page);
      requestAnimationFrame(() =>
        viewportRef.current
          ?.querySelector(
            `[data-page-index="${matches[next].page}"] [data-search-match="${matches[next].occurrence}"]`,
          )
          ?.scrollIntoView({ block: "center", inline: "nearest" }),
      );
    },
    [matches, goToPage, rememberLocation, activePdf, goToPdfDestination],
  );
  const previousMatches = useRef(matches);
  useEffect(() => {
    // Zoom changes navigation geometry while keeping the same search results.
    if (previousMatches.current === matches) return;
    previousMatches.current = matches;
    setMatchIndex(0);
    if (matches.length) jumpToMatch(0);
  }, [matches, jumpToMatch]);

  const openSaved = async (saved?: SavedBook) => {
    if (loadingRef.current) return;
    saveCurrentProgress();
    setConcealed(false);
    setQuery("");
    setMenuOpen(false);
    pendingReadingAnchor.current = null;
    if (!saved) {
      desiredPage.current = 0;
      desiredChapter.current = null;
      if (book === paperDemoBook) {
        goToPage(0);
        desiredPage.current = null;
      } else setBook(paperDemoBook);
      put("paperleaf-active-book", "reference-paper");
      return;
    }
    loadingRef.current = true;
    setImporting(true);
    try {
      const parsed = await parseBook(saved.file, { format: saved.format, filename: saved.filename });
      pendingReadingAnchor.current = readAnchor(parsed.id);
      const stored = Number(get(`paper-pdf-position:${parsed.id}`));
      desiredPage.current = stored > 0 ? stored - 1 : null;
      desiredChapter.current = saved.chapterIndex;
      setBook(parsed);
      put("paperleaf-active-book", parsed.id);
    } catch (error) {
      notify(errorText(error));
    } finally {
      loadingRef.current = false;
      setImporting(false);
    }
  };
  const importFile = async (file: File) => {
    if (loadingRef.current) return;
    if (!detectBookFormat(file)) {
      notify("请选择 EPUB、MOBI 或 TXT 格式的文件。");
      return;
    }
    saveCurrentProgress();
    loadingRef.current = true;
    setImporting(true);
    setMenuOpen(false);
    try {
      const parsed = await parseBook(file);
      pendingReadingAnchor.current = readAnchor(parsed.id);
      const progress = readReadingProgress(parsed.id);
      desiredPage.current = progress?.page ?? 0;
      desiredChapter.current = null;
      setConcealed(false);
      setQuery("");
      setBook(parsed);
      put("paperleaf-active-book", parsed.id);
      try {
        await saveBook({
          id: parsed.id,
          title: parsed.title,
          author: parsed.author,
          format: parsed.format,
          filename: file.name,
          file,
          addedAt: Date.now(),
          chapterIndex: 0,
        });
        setLibrary(await listBooks());
      } catch {
        notify("文档已打开，但浏览器无法保存文件。刷新后需重新打开。");
      }
    } catch (error) {
      notify(errorText(error));
    } finally {
      loadingRef.current = false;
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const deleteSaved = async (saved: SavedBook) => {
    if (loadingRef.current) return;
    try {
      await removeBook(saved.id);
      setLibrary((value) => value.filter((file) => file.id !== saved.id));
      if (book.id === saved.id) void openSaved();
    } catch (error) {
      notify(errorText(error));
    }
  };
  const openProperties = () => {
    setDraft(metadata);
    setPropertiesOpen(true);
    setMenuOpen(false);
  };
  const preserveReadingPosition = () => {
    saveCurrentProgress();
    pendingReadingAnchor.current = viewportRef.current ? captureReadingAnchor(viewportRef.current) : null;
    desiredPage.current = currentPage;
    desiredChapter.current = null;
    setFindOpen(false);
    setQuery("");
    setImage(null);
    setTextSelection(null);
  };
  const toggleImages = () => {
    if (imageToggleDisabled) return;
    if (concealed) {
      pendingCoverAnchor.current = viewportRef.current ? captureReadingAnchor(viewportRef.current) : null;
      setFindOpen(false);
      setQuery("");
      setImage(null);
    } else preserveReadingPosition();
    if (concealed) setCoverShowImages(value => !value);
    else setBookShowImages(value => !value);
    setMenuOpen(false);
  };
  const openCoverSettings = () => { setCoverSettingsOpen(true); setMenuOpen(false); };
  const printCurrentDocument = async () => {
    if (printing || !ready || activePaginating) return;
    const controller = new AbortController();
    printController.current?.abort();
    printController.current = controller;
    setPrinting(true);
    try {
      if (activePdf && viewportRef.current) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        await waitForPdfPrintReady(viewportRef.current, activePdf.numPages, controller.signal);
      }
      if (!controller.signal.aborted) window.print();
    } catch (error) { if (!controller.signal.aborted) notify(errorText(error)); }
    finally { if (printController.current === controller) { printController.current = null; setPrinting(false); } }
  };
  const downloadCurrentDocument = () => {
    if (!coverIsPdf || !cover) { void printCurrentDocument(); return; }
    const url = URL.createObjectURL(cover.source.blob);
    const link = document.createElement("a");
    link.href = url; link.download = cover.document.filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  useEffect(() => {
    printController.current?.abort();
    setPrinting(false);
    coverPosition.current = { fraction: 0, page: 0, anchor: null };
    pendingCoverAnchor.current = null;
    if (concealed) { setCurrentPage(0); viewportRef.current?.scrollTo({ top: 0 }); }
  }, [cover]);
  const changeZoom = (delta: number) => {
    const percent = Math.round(scale * 10) * 10;
    setZoom(String(Math.max(25, Math.min(250, percent + delta))));
  };
  const outline = (concealed ? cover ? { toc: [] } : paperDemoBook : book).toc;
  const wordOutline = useMemo(() => {
    if (cover?.document.kind !== "docx") return [];
    const seen = new Set<string>();
    return wordPages.pages.flatMap((page, pageIndex) => {
      const template = document.createElement("template"); template.innerHTML = page.html;
      return [...template.content.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")].flatMap(heading => {
        const anchor = heading.dataset.readingAnchor;
        if (!anchor || seen.has(anchor)) return [];
        seen.add(anchor);
        return [{ title: heading.textContent?.trim() || "未命名标题", page: pageIndex, anchor, depth: Number(heading.tagName.slice(1)) - 1 }];
      });
    });
  }, [cover, wordPages.pages]);
  const chapterPage = (id: string, fragment?: string) => {
    const currentBook = concealed ? paperDemoBook : book;
    const index = currentBook.chapters.findIndex(
      (chapter) => chapter.id === id,
    );
    const first = pages.findIndex((page) =>
      page.chapterIndices.includes(index),
    );
    const target = viewportRef.current ? findChapterTarget(viewportRef.current, index, fragment) : null;
    if (first < 0 && !target) return;
    rememberLocation();
    if (target) {
      target.scrollIntoView({ block: "start", inline: "nearest" });
      setCurrentPage(Number(target.closest<HTMLElement>("[data-page-index]")?.dataset.pageIndex) || 0);
    } else goToPage(first);
    if (innerWidth < 760) setSidebar(false);
  };
  const contentClick = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as Element;
    const marked = target.closest<HTMLElement>("[data-reader-mark]");
    if (marked && !concealed) {
      setSelectedMark(marked.dataset.readerMark); setSidebarTab("marks"); setSidebar(true);
    }
    const link = target.closest("a");
    if (link) {
      if (/^https?:\/\//i.test(link.getAttribute("href") || "")) {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
        return;
      }
      event.preventDefault();
      if (link.dataset.chapterId)
        chapterPage(link.dataset.chapterId, link.dataset.fragment);
      else if (link.getAttribute("href")?.startsWith("#") && viewportRef.current) {
        const chapter = Number(link.closest<HTMLElement>("[data-source-chapter]")?.dataset.sourceChapter ?? pages[currentPage]?.chapterIndex ?? 0);
        const rawFragment = link.getAttribute("href")!.slice(1);
        let fragment = rawFragment;
        try { fragment = decodeURIComponent(rawFragment); } catch { /* keep the literal fragment */ }
        const node = findChapterFragment(viewportRef.current, chapter, fragment);
        if (node) { rememberLocation(); node.scrollIntoView({ block: "start", inline: "nearest" }); setCurrentPage(Number(node.closest<HTMLElement>("[data-page-index]")?.dataset.pageIndex) || 0); }
      }
      return;
    }
    const img = target.closest("img") as HTMLImageElement | null;
    const svg = target.closest("figure svg") as SVGElement | null;
    if (img)
      setImage({
        src: img.src,
        caption:
          img.closest("figure")?.querySelector("figcaption")?.textContent ||
          img.alt ||
          "Figure",
      });
    else if (svg)
      setImage({
        src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`,
        caption:
          svg.closest("figure")?.querySelector("figcaption")?.textContent ||
          "Figure",
      });
  };
  useLayoutEffect(() => { contentClickRef.current = contentClick; });

  const moveChapter = (delta: number) => {
    const chapterIndices = [...new Set(pages.flatMap(page => page.chapterIndices))].filter(index => index >= 0).sort((a, b) => a - b);
    const position = chapterIndices.indexOf(currentChapterIndex);
    const index = chapterIndices[position + delta];
    if (index === undefined) return;
    const chapter = book.chapters[index];
    if (chapter) chapterPage(chapter.id);
  };
  useEffect(() => {
    const onReadingKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") { event.preventDefault(); void printCurrentDocument(); return; }
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.isComposing || target?.closest("input,textarea,select,button,a,[contenteditable]:not([contenteditable='false'])") || propertiesOpen || preferencesOpen || coverSettingsOpen || image || !ready || activePaginating) return;
      const key = event.key;
      if (!concealed && (event.ctrlKey || event.metaKey) && key.toLowerCase() === "d") { event.preventDefault(); addBookmark(); return; }
      if (!concealed && event.altKey && ["ArrowLeft", "ArrowRight"].includes(key)) { event.preventDefault(); navigateHistory(key === "ArrowLeft" ? "back" : "forward"); return; }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (["ArrowLeft", "ArrowRight", "PageUp", "PageDown", " ", "Home", "End"].includes(key)) {
        event.preventDefault();
        if (key === "Home" || key === "End") { rememberLocation(); goToPage(key === "Home" ? 0 : pageTotal - 1); }
        else goToPage(currentPage + (["ArrowLeft", "PageUp"].includes(key) || (key === " " && event.shiftKey) ? -1 : 1));
      }
    };
    window.addEventListener("keydown", onReadingKey);
    return () => window.removeEventListener("keydown", onReadingKey);
  });

  return (
    <div
      className="document-viewer"
      data-reader-theme={concealed ? "paper" : preferences.theme}
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        if (--dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) void importFile(file);
      }}
    >
      <input
        type="file"
        accept={BOOK_FILE_ACCEPT}
        ref={fileRef}
        className="sr-only"
        aria-label="选择 EPUB、MOBI 或 TXT 文件"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
        }}
      />
      <input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" ref={coverFileRef} className="sr-only" aria-label="选择遮挡 PDF 或 Word" onChange={event => { const file = event.target.files?.[0]; if (file) void importCover(file); event.target.value = ""; }} />
      <header className={`pdf-toolbar${concealed ? "" : " reader-toolbar"}`} aria-label="文档工具栏">
        <div className="toolbar-left">
          <button
            className={`pdf-tool ${sidebar ? "pressed" : ""}`}
            aria-label="切换侧栏"
            title="切换侧栏"
            onClick={() => setSidebar((value) => !value)}
          >
            <PanelLeft size={18} />
          </button>
          <span className="pdf-separator" />
          <button
            className="pdf-tool"
            aria-label="上一页"
            title="上一页"
            disabled={!currentPage || !ready}
            onClick={() => goToPage(currentPage - 1)}
          >
            <ChevronUp size={19} />
          </button>
          <button
            className="pdf-tool"
            aria-label="下一页"
            title="下一页"
            disabled={!ready || currentPage >= pageTotal - 1}
            onClick={() => goToPage(currentPage + 1)}
          >
            <ChevronDown size={19} />
          </button>
          <form
            className="page-number-form"
            onSubmit={(event) => {
              event.preventDefault();
              goToPage(Math.round(Number(pageInput)) - 1 || 0);
            }}
          >
            <input
              aria-label="页码"
              inputMode="numeric"
              value={pageInput}
              onFocus={(event) => event.target.select()}
              onChange={(event) =>
                setPageInput(event.target.value.replace(/\D/g, ""))
              }
              onBlur={() => {
                if (pageInput) goToPage(Math.round(Number(pageInput)) - 1);
                else setPageInput(String(currentPage + 1));
              }}
            />
            <span>/ {pageTotal || "–"}</span>
          </form>
          {(importing || activePaginating) && (
            <LoaderCircle
              size={15}
              className="loading-spin"
              aria-label="正在排版"
            />
          )}
        </div>
        <div className="toolbar-center">
          <button
            className="pdf-tool"
            aria-label="缩小"
            title="缩小"
            onClick={() => changeZoom(-10)}
            disabled={scale <= 0.25}
          >
            <Minus size={20} />
          </button>
          <span className="pdf-separator" />
          <button
            className="pdf-tool"
            aria-label="放大"
            title="放大"
            onClick={() => changeZoom(10)}
            disabled={scale >= 2.5}
          >
            <Plus size={21} />
          </button>
          <select
            aria-label="缩放"
            value={zoom}
            onChange={(event) => setZoom(event.target.value)}
          >
            <option value="auto">自动缩放</option>
            <option value="page">适合页面</option>
            <option value="width">适合页宽</option>
            {[25, 50, 75, 100, 125, 150, 175, 200, 250].map((value) => (
              <option key={value} value={String(value)}>
                {value}%
              </option>
            ))}
            {![
              "auto",
              "page",
              "width",
              "25",
              "50",
              "75",
              "100",
              "125",
              "150",
              "175",
              "200",
              "250",
            ].includes(zoom) && <option value={zoom}>{Math.round(Number(zoom) * 100) / 100}%</option>}
          </select>
        </div>
        <div className="toolbar-right">
          {!concealed && <>
            <button
              className="pdf-tool reader-typography-tool"
              aria-label="字体与排版"
              title="字号、字体与行距"
              disabled={!ready || paginating}
              onClick={() => setPreferencesOpen(true)}
            >
              <span className="reader-typography-symbol" aria-hidden="true">Aa</span>
              <span className="reader-toolbar-tool-label">字体排版</span>
            </button>
            <button
              ref={readerToolbarToggleRef}
              className={`pdf-tool reader-tools-toggle ${readerToolbarOpen ? "pressed" : ""}`}
              aria-label="切换阅读工具栏"
              title="阅读工具栏"
              aria-expanded={readerToolbarOpen}
              aria-controls="reader-navigation-bar"
              onClick={() => setReaderToolbarOpen(value => !value)}
            >
              <PanelBottom size={18} />
              <span className="reader-toolbar-tool-label">阅读工具栏</span>
            </button>
          </>}
          <button
            className={`pdf-tool ${findOpen ? "pressed" : ""}`}
            aria-label="查找"
            title="查找 (Ctrl+F)"
            disabled={!ready}
            onClick={() => setFindOpen((value) => !value)}
          >
            <Search size={19} />
          </button>
          <button className={`pdf-tool image-visibility-tool ${showImages ? "pressed" : ""}`} aria-label={showImages ? "隐藏图片" : "显示图片"} title={coverIsPdf ? "PDF 原始版式不支持去除图片" : showImages ? "隐藏原书 / Word 正文图片" : "显示原书 / Word 正文图片"} aria-pressed={showImages} disabled={imageToggleDisabled} onClick={toggleImages}>
            {showImages ? <ImageIcon size={18} /> : <ImageOff size={18} />}
          </button>
          <button className="pdf-tool optional-tool" aria-label="选择遮挡文档" title="选择遮挡文档（PDF / Word）" onClick={openCoverSettings}><FolderOpen size={18} /></button>
          <button
            className={`pdf-tool optional-tool ${spread ? "pressed" : ""}`}
            aria-label="双页并排"
            title="双页并排"
            aria-pressed={spread}
            onClick={() => setSpread((value) => !value)}
          >
            <Columns2 size={18} />
          </button>
          <button
            className="pdf-tool optional-tool"
            aria-label="文档属性"
            title="文档属性"
            onClick={openProperties}
          >
            <Settings2 size={18} />
          </button>
          <button
            className="pdf-tool optional-tool"
            aria-label="备用文档"
            title="切换备用文档 (Q)"
            onClick={toggleReference}
          >
            <FileCheck2 size={18} />
          </button>
          <span className="pdf-separator" />
          <button
            className="pdf-tool"
            aria-label="打印"
            title="打印"
            onClick={() => void printCurrentDocument()}
            disabled={!ready || activePaginating || printing}
          >
            {printing ? <LoaderCircle size={19} className="loading-spin" /> : <Printer size={19} />}
          </button>
          <button
            className="pdf-tool optional-tool"
            aria-label="另存为 PDF"
            title="另存为 PDF"
            onClick={downloadCurrentDocument}
            disabled={!ready || activePaginating || printing}
          >
            <Download size={19} />
          </button>
          <button
            className={`pdf-tool ${menuOpen ? "pressed" : ""}`}
            aria-label="更多工具"
            title="更多工具"
            onClick={() => setMenuOpen((value) => !value)}
          >
            <ChevronsRight size={20} />
          </button>
        </div>
      </header>
      {findOpen && (
        <section className="pdf-findbar" aria-label="查找文本">
          <Search size={15} />
          <input
            ref={findRef}
            aria-label="查找内容"
            placeholder="在文档中查找"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                jumpToMatch(matchIndex + (event.shiftKey ? -1 : 1));
              }
            }}
          />
          <span className="find-count">
            {pdfSearching ? "查找中…" : query.trim()
              ? matches.length
                ? `${matchIndex + 1} / ${matches.length}`
                : "未找到"
              : ""}
          </span>
          <button
            className="pdf-tool"
            aria-label="上一个匹配"
            disabled={!matches.length}
            onClick={() => jumpToMatch(matchIndex - 1)}
          >
            <ChevronUp size={16} />
          </button>
          <button
            className="pdf-tool"
            aria-label="下一个匹配"
            disabled={!matches.length}
            onClick={() => jumpToMatch(matchIndex + 1)}
          >
            <ChevronDown size={16} />
          </button>
          <button
            className="pdf-tool"
            aria-label="关闭查找"
            onClick={() => {
              setFindOpen(false);
              setQuery("");
            }}
          >
            <X size={16} />
          </button>
        </section>
      )}
      {menuOpen && (
        <>
          <button
            className="menu-dismiss"
            aria-label="关闭菜单"
            onClick={() => setMenuOpen(false)}
          />
          <div className="pdf-menu" role="menu">
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                fileRef.current?.click();
              }}
            >
              <FolderOpen size={16} />
              打开电子书…<kbd>Ctrl O</kbd>
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setSidebar(true);
                setSidebarTab("files");
                setMenuOpen(false);
              }}
            >
              <FileText size={16} />
              文档库
            </button>
            <button role="menuitem" onClick={openProperties}>
              <Settings2 size={16} />
              文档属性…
            </button>
            {!concealed && <button role="menuitem" disabled={paginating || !ready} onClick={() => { setPreferencesOpen(true); setMenuOpen(false); }}><Settings2 size={16} />阅读设置…</button>}
            {!concealed && <button role="menuitem" onClick={() => { setSidebarTab("marks"); setSidebar(true); setMenuOpen(false); }}><BookmarkPlus size={16} />书签与批注</button>}
            <button role="menuitem" onClick={openCoverSettings}><FolderOpen size={16} />选择遮挡文档…</button>
            <hr />
            {!concealed && <button role="menuitemcheckbox" aria-checked={readerToolbarOpen} onClick={() => { setReaderToolbarOpen(value => !value); setMenuOpen(false); }}><span className="menu-check">{readerToolbarOpen ? "✓" : ""}</span>显示阅读工具栏</button>}
            <button role="menuitemcheckbox" aria-checked={showImages} onClick={toggleImages} disabled={imageToggleDisabled}><span className="menu-check">{showImages ? "✓" : ""}</span>显示原书 / Word 正文图片</button>
            <button
              role="menuitemcheckbox"
              aria-checked={autoCoverEnabled}
              onClick={() => {
                setAutoCoverEnabled(value => !value);
                setMenuOpen(false);
              }}
            >
              <span className="menu-check">{autoCoverEnabled ? "✓" : ""}</span>
              鼠标移出自动覆盖
            </button>
            <button
              role="menuitemcheckbox"
              aria-checked={showFigures}
              disabled={concealed || paginating || !ready}
              onClick={() => {
                preserveReadingPosition();
                setShowFigures((value) => !value);
                setMenuOpen(false);
              }}
            >
              <span className="menu-check">{showFigures ? "✓" : ""}</span>
              附加统计图与结构图
            </button>
            <button
              role="menuitemcheckbox"
              aria-checked={spread}
              onClick={() => {
                setSpread((value) => !value);
                setMenuOpen(false);
              }}
            >
              <Columns2 size={16} />
              双页并排
            </button>
            <hr />
            <button role="menuitem" onClick={toggleReference}>
              <FileCheck2 size={16} />
              切换备用文档<kbd>Q</kbd>
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setZoom("auto");
                setMenuOpen(false);
              }}
            >
              <MoreHorizontal size={16} />
              自动缩放
            </button>
          </div>
        </>
      )}
      <div className="pdf-workspace">
        {sidebar && (
          <>
            <button
              className="sidebar-backdrop"
              aria-label="关闭侧栏"
              onClick={() => setSidebar(false)}
            />
            <aside className="pdf-sidebar">
              <div className="sidebar-tabs">
                <button
                  className={sidebarTab === "outline" ? "selected" : ""}
                  onClick={() => setSidebarTab("outline")}
                >
                  <List size={15} />
                  大纲
                </button>
                <button
                  className={sidebarTab === "files" ? "selected" : ""}
                  onClick={() => setSidebarTab("files")}
                >
                  <FileText size={15} />
                  文件
                </button>
                {!concealed && <button className={sidebarTab === "marks" ? "selected" : ""} onClick={() => setSidebarTab("marks")}><BookmarkPlus size={15} />批注</button>}
                <button
                  className="pdf-tool"
                  aria-label="关闭侧栏"
                  onClick={() => setSidebar(false)}
                >
                  <X size={16} />
                </button>
              </div>
              {sidebarTab === "outline" ? (
                <nav aria-label="文档大纲">
                  {coverIsPdf && pdfOutlineLoading && <p className="reader-search-status" role="status">正在读取 PDF 目录…</p>}
                  {coverIsPdf && pdfOutline.map(item => <button key={item.id} className="outline-item" aria-current={currentPage === item.page ? "location" : undefined} style={{ paddingLeft: 15 + item.depth * 13 }} onClick={() => { goToPdfDestination(item); if (innerWidth < 760) setSidebar(false); }}><span>{item.title}</span><small>{item.page + 1}</small></button>)}
                  {concealed && cover?.document.kind === "docx" && wordOutline.map(item => <button key={item.anchor} className="outline-item" style={{ paddingLeft: 15 + item.depth * 13 }} onClick={() => { const index = viewportRef.current ? restoreReadingAnchor(viewportRef.current, { id: item.anchor, offset: 0, viewportY: 0 }) : null; if (index !== null) setCurrentPage(index); else goToPage(item.page); if (innerWidth < 760) setSidebar(false); }}><span>{item.title}</span><small>{item.page + 1}</small></button>)}
                  {concealed && cover && !pdfOutlineLoading && (coverIsPdf ? !pdfOutline.length : !wordOutline.length) && <><p className="reader-search-status">此文档没有内置目录，按页浏览。</p>{pages.map((_, index) => <button key={index} className="outline-item" onClick={() => { goToPage(index); if (innerWidth < 760) setSidebar(false); }}><span>第 {index + 1} 页</span><small>{index + 1}</small></button>)}</>}
                  {outline.map((item, index) => (
                    <button
                      key={`${item.chapterId}-${index}`}
                      className="outline-item"
                      aria-current={(concealed ? paperDemoBook : book).chapters[currentChapterIndex]?.id === item.chapterId ? "location" : undefined}
                      style={{ paddingLeft: 15 + item.level * 13 }}
                      onClick={() => chapterPage(item.chapterId, item.fragment)}
                    >
                      <span>{item.title}</span>
                      <small>
                        {Math.max(
                          1,
                          pages.findIndex((page) =>
                            page.chapterIndices.includes(
                              (concealed
                                ? paperDemoBook
                                : book
                              ).chapters.findIndex(
                                (chapter) => chapter.id === item.chapterId,
                              ),
                            ),
                          ) + 1,
                        )}
                      </small>
                    </button>
                  ))}
                </nav>
              ) : sidebarTab === "marks" && !concealed ? (
                <ReaderMarksPanel marks={marks} chapterNames={book.chapters.map(chapter => chapter.title)} selectedId={selectedMark}
                  onSelect={id => setSelectedMark(id ?? undefined)}
                  onJump={mark => { rememberLocation(); pendingMarkJump.current = mark; setMarkJumpRevision(value => value + 1); if (innerWidth < 760) setSidebar(false); }}
                  onRemove={id => { updateMarks(marks.filter(mark => mark.id !== id)); if (selectedMark === id) setSelectedMark(undefined); }}
                  onUpdate={(id, patch) => { updateMarks(marks.map(mark => mark.id === id ? { ...mark, ...patch } : mark)); notify("批注已保存。"); }}
                  onAddBookmark={addBookmark} onAddSelection={addSelection} onExport={exportNotes} onImport={file => void importNotes(file)} disabled={paginating || !ready} />
              ) : (
                <div className="file-library">
                  <button
                    className="open-document"
                    onClick={() => fileRef.current?.click()}
                    disabled={importing}
                  >
                    <FolderOpen size={16} />
                    打开 EPUB / MOBI / TXT
                  </button>
                  <div className="reader-library-controls">
                    <input type="search" aria-label="筛选书库" placeholder="按书名或作者查找" value={libraryQuery} onChange={event => setLibraryQuery(event.target.value)} />
                    <select aria-label="书库排序" value={librarySort} onChange={event => setLibrarySort(event.target.value)}><option value="recent">最近阅读</option><option value="title">按书名</option><option value="added">最近添加</option></select>
                  </div>
                  <button
                    className={`library-document ${book.isDemo ? "selected" : ""}`}
                    onClick={() => void openSaved()}
                  >
                    <FileText size={17} />
                    <span>
                      参考文档
                      <small>{DEFAULT_DOCUMENT_METADATA.filename}</small>
                    </span>
                  </button>
                  {visibleLibrary.map((saved) => (
                    <div
                      className={`library-row ${saved.id === book.id ? "selected" : ""}`}
                      key={saved.id}
                    >
                      <button
                        className="library-document"
                        onClick={() => void openSaved(saved)}
                        disabled={importing}
                      >
                        <FileText size={17} />
                        <span>
                          {saved.title}
                          <small>{(saved.format || "epub").toUpperCase()} · {saved.author} · 已读 {Math.round(readReadingProgress(saved.id)?.percent ?? 0)}%</small>
                        </span>
                      </button>
                      <button
                        className="pdf-tool"
                        title="移除本地文件"
                        aria-label={`移除 ${saved.title}`}
                        onClick={() => void deleteSaved(saved)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  {!visibleLibrary.length && <p className="reader-library-empty">{library.length ? "没有找到匹配的书籍。" : "打开电子书后会保存在这里，可随时继续阅读。"}</p>}
                  <p className="library-note">
                    文件仅保存在此浏览器中。支持拖入 EPUB、MOBI 和 TXT。
                    <br />
                    Q 可临时切换到参考文档，再按一次返回。
                  </p>
                  <p className="reader-keyboard-help">← / →、PageUp / PageDown：翻页<br />空格：下一页，Shift + 空格：上一页<br />Home / End：开头 / 结尾<br />Ctrl + D：书签，Alt + ← / →：跳转历史<br />Ctrl + F：搜索，Esc：关闭面板</p>
                  <button className="open-document" onClick={openCoverSettings}><FolderOpen size={16} />选择遮挡 PDF / Word</button>
                  <a
                    className="sample-link"
                    href="/samples/paperleaf-sample.epub"
                    download
                  >
                    下载 EPUB 测试文件
                  </a>
                </div>
              )}
            </aside>
          </>
        )}
        <div
          className="pdf-viewport"
          ref={viewportRef}
          data-reading-current-page={currentPage}
          data-reading-book-id={concealed ? "" : book.id}
          onScroll={(event) => {
            const el = event.currentTarget;
            cancelAnimationFrame(scrollFrame.current);
            scrollFrame.current = requestAnimationFrame(() => {
              const row = Math.floor(
                (el.scrollTop + 50) / (PAGE_HEIGHT * scale + 12),
              );
              setCurrentPage((previous) =>
                Math.floor(previous / columns) === row
                  ? previous
                  : Math.max(0, Math.min(row * columns, pages.length - 1)),
              );
            });
          }}
        >
          {ready ? (
            <div
              className="pdf-page-grid"
              style={{ "--page-columns": columns } as CSSProperties}
            >
              {pages.map((page, index) => coverIsPdf && cover?.document.kind === "pdf" ? (
                <div className="pdf-page-frame" key={`cover-pdf-${index}`} data-page-index={index} style={{ width: PAGE_WIDTH * scale, height: PAGE_HEIGHT * scale }}><PdfCanvasPage pdf={cover.document.pdf} index={index} scale={scale} onNavigate={goToPdfDestination} query={findOpen ? deferredQuery : ""} activeMatch={matches[matchIndex]?.page === index ? matches[matchIndex].occurrence : undefined} forceRender={printing} /></div>
              ) : (
                <PageSheet
                  key={`${concealed ? "reference" : book.id}-${index}`}
                  page={page}
                  index={index}
                  total={pages.length}
                  scale={scale}
                  metadata={effectiveMetadata}
                  query={findOpen ? deferredQuery : ""}
                  onContentClick={handleContentClick}
                  marks={concealed ? NO_MARKS : marks}
                  preferences={concealed ? undefined : preferences}
                  sourceFilename={concealed && cover ? cover.document.filename : !concealed ? metadata.filename : undefined}
                />
              ))}
            </div>
          ) : (
            <div className="document-loading" role="status">
              <LoaderCircle size={24} className="loading-spin" />
              <span>正在准备文档…</span>
              {!concealed && (
                <small>{Math.round(paginationProgress * 100)}%</small>
              )}
            </div>
          )}
        </div>
      </div>
      {readerToolbarOpen && !concealed && <nav id="reader-navigation-bar" className="reader-navigation-bar" aria-label="阅读导航">
        <button aria-label="返回上次跳转位置" title="返回 (Alt+←)" disabled={!backStack.length || paginating} onClick={() => navigateHistory("back")}><ArrowLeft size={15} /></button>
        <button aria-label="前进到下次跳转位置" title="前进 (Alt+→)" disabled={!forwardStack.length || paginating} onClick={() => navigateHistory("forward")}><ArrowRight size={15} /></button>
        <button aria-label="上一章" disabled={!ready || paginating || currentChapterIndex <= 0} onClick={() => moveChapter(-1)}>上一章</button>
        <button aria-label="下一章" disabled={!ready || paginating || currentChapterIndex >= book.chapters.length - 1} onClick={() => moveChapter(1)}>下一章</button>
        <span className="reader-current-chapter" title={book.chapters[currentChapterIndex]?.title}>{book.chapters[currentChapterIndex]?.title || book.title}</span>
        <label className="reader-progress-control"><span className="reader-navigation-label">进度</span><input aria-label="阅读进度" type="range" min="0" max="100" step="0.1" value={readingPercent} disabled={!ready || paginating} onPointerDown={rememberLocation} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) rememberLocation(); }} onChange={event => goToPage(progressToPage(Number(event.target.value), pageTotal))} /><output>{Math.round(readingPercent)}%</output></label>
        <button aria-label="添加书签" title="添加书签 (Ctrl+D)" disabled={!ready || paginating} onClick={addBookmark}><BookmarkPlus size={15} /><span className="reader-navigation-label">书签</span></button>
        <button aria-label="书签与批注" onClick={() => { setSidebarTab("marks"); setSidebar(true); }}>批注 {marks.length || ""}</button>
        <button aria-label="阅读设置" disabled={!ready || paginating} onClick={() => setPreferencesOpen(true)}><Settings2 size={15} /><span className="reader-navigation-label">阅读设置</span></button>
        <button aria-label="关闭阅读工具栏" title="关闭阅读工具栏" onClick={() => { setReaderToolbarOpen(false); readerToolbarToggleRef.current?.focus(); }}><X size={15} /></button>
      </nav>}
      {!concealed && textSelection && !paginating && <div className="reader-selection-actions" aria-label="选文操作"><button onMouseDown={event => event.preventDefault()} onClick={addSelection}>划线并批注 · {textSelection.quote.length} 字</button><button aria-label="取消选文" onClick={() => { window.getSelection()?.removeAllRanges(); setTextSelection(null); }}><X size={14} /></button></div>}
      {preferencesOpen && !concealed && <ReaderPreferencesDialog value={preferences} onClose={() => setPreferencesOpen(false)} onApply={next => {
        if (next.fontSize !== preferences.fontSize || next.lineHeight !== preferences.lineHeight || next.fontFamily !== preferences.fontFamily) preserveReadingPosition();
        setPreferences(next); if (!writeReaderPreferences(next)) notify("阅读设置暂时无法持久保存。"); setPreferencesOpen(false);
      }} />}
      {notice && (
        <div className="pdf-notice" role="alert">
          <span>{notice}</span>
          <button
            className="pdf-tool"
            aria-label="关闭提示"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {dragging && (
        <div className="pdf-drop-overlay">
          <FolderOpen size={40} />
          <strong>打开文档</strong>
          <span>松开鼠标以载入 EPUB、MOBI 或 TXT 文件</span>
        </div>
      )}
      {coverSettingsOpen && (
        <div className="pdf-modal-backdrop" onClick={() => setCoverSettingsOpen(false)}>
          <section className="pdf-properties cover-properties" role="dialog" aria-modal="true" aria-label="遮挡文档" onClick={event => event.stopPropagation()}>
            <header><h2>遮挡文档</h2><button className="pdf-tool" aria-label="关闭遮挡文档设置" onClick={() => setCoverSettingsOpen(false)}><X size={18} /></button></header>
            <div className="cover-document-settings">
              <p className="properties-description">选择按 Q 时显示的 PDF 论文或 Word 文档。再按 Q 返回当前书籍。</p>
              <div className="selected-cover-file"><FileText size={28} /><div><strong>{cover?.document.filename || "内置英文参考论文"}</strong><span>{cover ? cover.document.kind === "pdf" ? `${cover.document.pdf.numPages} 页 · PDF 原始版式` : wordPages.paginating ? "Word 文档 · 正在排版…" : `${wordPages.pages.length} 页 · Word 文档` : "默认文档 · 无需导入"}</span></div></div>
              <button className="cover-import-button pdf-dialog-button primary" onClick={() => coverFileRef.current?.click()} disabled={coverLoading}><FolderOpen size={16} />{coverLoading ? "正在载入文档…" : "选择 PDF / Word (.docx)"}</button>
              <p className="cover-help">文件仅保存在此浏览器。Word 保留文字与插图并重新分页；旧版 .doc 请先另存为 .docx。</p>
              <div className="properties-actions"><button className="pdf-dialog-button" disabled={coverLoading || !cover} onClick={() => void resetCover()}>恢复内置论文</button><button className="pdf-dialog-button primary" disabled={coverLoading} onClick={() => { setCoverSettingsOpen(false); if (!concealed) toggleReference(); }}>查看遮挡文档</button></div>
            </div>
          </section>
        </div>
      )}
      {propertiesOpen && (
        <div
          className="pdf-modal-backdrop"
          onClick={() => setPropertiesOpen(false)}
        >
          <section
            className="pdf-properties"
            role="dialog"
            aria-modal="true"
            aria-label="文档属性"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <h2>文档属性</h2>
              <button
                className="pdf-tool"
                aria-label="关闭文档属性"
                onClick={() => setPropertiesOpen(false)}
              >
                <X size={18} />
              </button>
            </header>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const next = Object.fromEntries(
                  Object.entries(draft).map(([key, value]) => [
                    key,
                    value.trim() ||
                      DEFAULT_DOCUMENT_METADATA[key as keyof DocumentMetadata],
                  ]),
                ) as unknown as DocumentMetadata;
                setMetadata(next);
                setPropertiesOpen(false);
              }}
            >
              <div className="properties-description">
                设置标签页文件名和论文封面。正文保留原文。
              </div>
              {(
                [
                  { key: "filename", label: "文件名" },
                  { key: "title", label: "论文标题" },
                  { key: "journal", label: "期刊页眉" },
                  { key: "authors", label: "作者" },
                  { key: "affiliation", label: "单位" },
                  { key: "year", label: "年份" },
                ] as { key: keyof DocumentMetadata; label: string }[]
              ).map((field) => (
                <label key={field.key}>
                  <span>{field.label}</span>
                  <input
                    maxLength={field.key === "year" ? 4 : 400}
                    value={draft[field.key]}
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        [field.key]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
              <div className="properties-actions">
                <button
                  type="button"
                  className="pdf-dialog-button"
                  onClick={() => setPropertiesOpen(false)}
                >
                  取消
                </button>
                <button type="submit" className="pdf-dialog-button primary">
                  保存
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {image && (
        <div
          className="pdf-image-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="插图预览"
          onClick={() => setImage(null)}
        >
          <button
            className="pdf-tool image-close"
            aria-label="关闭插图预览"
            onClick={() => setImage(null)}
          >
            <X size={25} />
          </button>
          <figure onClick={(event) => event.stopPropagation()}>
            <img src={image.src} alt={image.caption} />
            <figcaption>{image.caption}</figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}
