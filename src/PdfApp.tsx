import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
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
  PanelLeft,
  Plus,
  Printer,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { paperDemoBook } from "./data/paper-demo";
import { parseEpub, releaseBook } from "./lib/epub";
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
import { PdfCanvasPage } from "./components/CoverPdfPages";

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

function PageSheet({
  page,
  index,
  total,
  scale,
  metadata,
  query,
  onContentClick,
  sourceFilename,
}: {
  page: DocumentPage;
  index: number;
  total: number;
  scale: number;
  metadata: DocumentMetadata;
  query: string;
  onContentClick: (event: React.MouseEvent<HTMLElement>) => void;
  sourceFilename?: string;
}) {
  const html = useMemo(
    () => highlightHtml(page.html, query),
    [page.html, query],
  );
  return (
    <div
      className="pdf-page-frame"
      data-page-index={index}
      style={{ width: PAGE_WIDTH * scale, height: PAGE_HEIGHT * scale }}
    >
      <article
        className="pdf-sheet"
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
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <footer className="pdf-page-footer">{index + 1}</footer>
      </article>
    </div>
  );
}

export default function PdfApp() {
  const [book, setBook] = useState<Book>(paperDemoBook);
  const [library, setLibrary] = useState<SavedBook[]>([]);
  const [metadata, setMetadata] = useState<DocumentMetadata>(readMetadata);
  const [draft, setDraft] = useState<DocumentMetadata>(metadata);
  const [documentState, setDocumentState] = useState<{
    id: string;
    pages: DocumentPage[];
  }>({ id: "", pages: [] });
  const [referencePages, setReferencePages] = useState<DocumentPage[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const [zoom, setZoom] = useState(get("paper-pdf-zoom") || "auto");
  const [spread, setSpread] = useState(get("paper-pdf-spread") !== "false");
  const [showFigures, setShowFigures] = useState(
    get("paper-pdf-figures") !== "false",
  );
  const [showImages, setShowImages] = useState(get("paper-pdf-images") !== "false");
  const [viewport, setViewport] = useState({
    width: innerWidth,
    height: innerHeight - 44,
  });
  const [sidebar, setSidebar] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"outline" | "files">("outline");
  const [menuOpen, setMenuOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [coverSettingsOpen, setCoverSettingsOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [concealed, setConcealed] = useState(false);
  const [importing, setImporting] = useState(false);
  const [paginating, setPaginating] = useState(true);
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
  const loadingRef = useRef(false);
  const desiredPage = useRef<number | null>(0);
  const desiredChapter = useRef<number | null>(null);
  const dragDepth = useRef(0);
  const scrollFrame = useRef(0);
  const pendingReadingAnchor = useRef<ReadingAnchor | null>(null);
  const pendingCoverAnchor = useRef<ReadingAnchor | null>(null);
  const originalPosition = useRef<{ fraction: number; page: number; anchor: ReadingAnchor | null }>({ fraction: 0, page: 0, anchor: null });
  const coverPosition = useRef<{ fraction: number; page: number; anchor: ReadingAnchor | null }>({ fraction: 0, page: 0, anchor: null });
  const notify = useCallback((text: string) => setNotice(text), []);
  const { cover, loading: coverLoading, importCover, resetCover } = useCoverDocument(notify);
  const wordPages = useWordPages(cover?.document ?? null, showImages, notify);
  const chosenCoverPages = useMemo(() => cover?.document.kind === "pdf"
    ? Array.from({ length: cover.document.pdf.numPages }, () => ({ html: "", chapterIndex: 0, chapterIndices: [0] }))
    : cover?.document.kind === "docx" ? wordPages.pages : referencePages, [cover, wordPages.pages, referencePages]);
  const effectiveMetadata = concealed ? DEFAULT_DOCUMENT_METADATA : metadata;
  const pages = concealed ? chosenCoverPages : documentState.pages;
  const ready = concealed
    ? chosenCoverPages.length > 0
    : documentState.id === book.id && documentState.pages.length > 0;
  const columns = spread && viewport.width >= 760 ? 2 : 1;
  const fitWidth = Math.max(
    0.15,
    (viewport.width - 36 - (columns - 1) * 12) / columns / PAGE_WIDTH,
  );
  const scale =
    zoom === "auto" || zoom === "width"
      ? fitWidth
      : zoom === "page"
        ? Math.min(fitWidth, (viewport.height - 26) / PAGE_HEIGHT)
        : Math.max(0.25, Math.min(2.5, Number(zoom) / 100 || fitWidth));
  const pageTotal = pages.length;
  const coverIsPdf = concealed && cover?.document.kind === "pdf";
  const activePaginating = concealed ? cover?.document.kind === "docx" && wordPages.paginating : paginating;
  const imageToggleDisabled = coverIsPdf || (concealed && !cover) || activePaginating || !ready;
  const previousLayout = useRef({ scale, columns });

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
  useEffect(() => { put("paper-pdf-images", String(showImages)); }, [showImages]);
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
          const parsed = await parseEpub(saved.file);
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
      buildDocumentBlocks(paperDemoBook, DEFAULT_DOCUMENT_METADATA, true),
      { signal: controller.signal },
    )
      .then(setReferencePages)
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setPaginating(true);
    setPaginationProgress(0);
    const stamped = stampReadingAnchors(buildDocumentBlocks(book, metadata, true));
    paginateBlocks(applyFigureVisibility(stamped, { images: showImages, generated: showFigures }), {
      signal: controller.signal,
      onProgress: setPaginationProgress,
    })
      .then((nextPages) => {
        if (!controller.signal.aborted) {
          setDocumentState({ id: book.id, pages: nextPages });
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
  }, [book, metadata, showFigures, showImages, notify]);

  const goToPage = useCallback(
    (value: number, behavior: ScrollBehavior = "auto") => {
      const index = Math.max(0, Math.min(value, pages.length - 1));
      if (!pages.length) return;
      viewportRef.current?.scrollTo({
        top: Math.floor(index / columns) * (PAGE_HEIGHT * scale + 12),
        behavior,
      });
      setCurrentPage(index);
      setPageInput(String(index + 1));
    },
    [pages.length, columns, scale],
  );

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
  useEffect(() => {
    if (
      concealed ||
      !ready ||
      paginating ||
      importing ||
      documentState.id !== book.id
    )
      return;
    const page = documentState.pages[currentPage];
    if (!page) return;
    const timer = setTimeout(() => {
      put(`paper-pdf-position:${book.id}`, String(currentPage + 1));
      const anchor = viewportRef.current && captureReadingAnchor(viewportRef.current);
      if (anchor) put(`paper-pdf-anchor:${book.id}`, JSON.stringify(anchor));
      if (!book.isDemo)
        savePosition(book.id, Math.max(0, page.chapterIndex)).catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [
    currentPage,
    book.id,
    book.isDemo,
    ready,
    paginating,
    importing,
    concealed,
    documentState,
  ]);

  const toggleReference = useCallback(() => {
    setMenuOpen(false);
    setFindOpen(false);
    setPropertiesOpen(false);
    setCoverSettingsOpen(false);
    setSidebar(false);
    setImage(null);
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
  }, [concealed, currentPage, scale, columns, chosenCoverPages.length, cover]);

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
        if (!coverIsPdf) setFindOpen(true);
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
    if (!propertiesOpen && !image && !coverSettingsOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const elements = () => [
      ...(dialog?.querySelectorAll<HTMLElement>(
        "button:not([disabled]),input,a[href]",
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
  }, [propertiesOpen, image, coverSettingsOpen]);

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    return pages.flatMap((page, index) =>
      findHtmlMatches(page.html, query).map((match) => ({
        page: index,
        occurrence: match.id,
      })),
    );
  }, [pages, query]);
  const jumpToMatch = useCallback(
    (index: number) => {
      if (!matches.length) return;
      const next = (index + matches.length) % matches.length;
      setMatchIndex(next);
      goToPage(matches[next].page);
      requestAnimationFrame(() =>
        viewportRef.current
          ?.querySelector(
            `[data-page-index="${matches[next].page}"] [data-search-match="${matches[next].occurrence}"]`,
          )
          ?.scrollIntoView({ block: "center", inline: "nearest" }),
      );
    },
    [matches, goToPage],
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
      const parsed = await parseEpub(saved.file);
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
    if (!file.name.toLowerCase().endsWith(".epub")) {
      notify("请选择 EPUB 格式的文件。");
      return;
    }
    loadingRef.current = true;
    setImporting(true);
    setMenuOpen(false);
    try {
      const parsed = await parseEpub(file);
      pendingReadingAnchor.current = null;
      desiredPage.current = 0;
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
    pendingReadingAnchor.current = viewportRef.current ? captureReadingAnchor(viewportRef.current) : null;
    desiredPage.current = currentPage;
    desiredChapter.current = null;
    setFindOpen(false);
    setQuery("");
    setImage(null);
  };
  const toggleImages = () => {
    if (imageToggleDisabled) return;
    if (concealed) {
      pendingCoverAnchor.current = viewportRef.current ? captureReadingAnchor(viewportRef.current) : null;
      setFindOpen(false);
      setQuery("");
      setImage(null);
    } else preserveReadingPosition();
    setShowImages(value => !value);
    setMenuOpen(false);
  };
  const openCoverSettings = () => { setCoverSettingsOpen(true); setMenuOpen(false); };
  const printCurrentDocument = () => {
    if (coverIsPdf && cover) {
      const url = URL.createObjectURL(cover.source.blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } else window.print();
  };
  const downloadCurrentDocument = () => {
    if (!coverIsPdf || !cover) { printCurrentDocument(); return; }
    const url = URL.createObjectURL(cover.source.blob);
    const link = document.createElement("a");
    link.href = url; link.download = cover.document.filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  useEffect(() => {
    coverPosition.current = { fraction: 0, page: 0, anchor: null };
    pendingCoverAnchor.current = null;
    if (concealed) { setCurrentPage(0); viewportRef.current?.scrollTo({ top: 0 }); }
  }, [cover]);
  const changeZoom = (delta: number) => {
    const percent = Math.round(scale * 10) * 10;
    setZoom(String(Math.max(25, Math.min(250, percent + delta))));
  };
  const outline = (concealed ? cover ? { toc: [] } : paperDemoBook : book).toc;
  const chapterPage = (id: string, fragment?: string) => {
    const currentBook = concealed ? paperDemoBook : book;
    const index = currentBook.chapters.findIndex(
      (chapter) => chapter.id === id,
    );
    const first = pages.findIndex((page) =>
      page.chapterIndices.includes(index),
    );
    if (first >= 0) goToPage(first);
    if (fragment)
      requestAnimationFrame(() =>
        [...(viewportRef.current?.querySelectorAll("[id]") || [])]
          .find((element) => element.id === fragment)
          ?.scrollIntoView({ block: "start", inline: "nearest" }),
      );
    if (innerWidth < 760) setSidebar(false);
  };
  const contentClick = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as Element;
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
      else if (link.getAttribute("href")?.startsWith("#"))
        [...(viewportRef.current?.querySelectorAll("[id]") || [])]
          .find((element) => element.id === link.getAttribute("href")!.slice(1))
          ?.scrollIntoView({ block: "start", inline: "nearest" });
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

  return (
    <div
      className="document-viewer"
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
        accept=".epub,application/epub+zip"
        ref={fileRef}
        className="sr-only"
        aria-label="选择 EPUB 文件"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
        }}
      />
      <input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" ref={coverFileRef} className="sr-only" aria-label="选择遮挡 PDF 或 Word" onChange={event => { const file = event.target.files?.[0]; if (file) void importCover(file); event.target.value = ""; }} />
      <header className="pdf-toolbar" aria-label="文档工具栏">
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
            ].includes(zoom) && <option value={zoom}>{zoom}%</option>}
          </select>
        </div>
        <div className="toolbar-right">
          <button
            className={`pdf-tool ${findOpen ? "pressed" : ""}`}
            aria-label="查找"
            title="查找 (Ctrl+F)"
            disabled={coverIsPdf}
            onClick={() => setFindOpen((value) => !value)}
          >
            <Search size={19} />
          </button>
          <button className={`pdf-tool image-visibility-tool ${showImages ? "pressed" : ""}`} aria-label={showImages ? "隐藏图片" : "显示图片"} title={coverIsPdf ? "PDF 原始版式不支持去除图片" : showImages ? "隐藏 EPUB / Word 正文图片" : "显示 EPUB / Word 正文图片"} aria-pressed={showImages} disabled={imageToggleDisabled} onClick={toggleImages}>
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
            onClick={printCurrentDocument}
            disabled={!ready || activePaginating}
          >
            <Printer size={19} />
          </button>
          <button
            className="pdf-tool optional-tool"
            aria-label="另存为 PDF"
            title="另存为 PDF"
            onClick={downloadCurrentDocument}
            disabled={!ready || activePaginating}
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
            {query.trim()
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
              打开 EPUB 文件…<kbd>Ctrl O</kbd>
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
            <button role="menuitem" onClick={openCoverSettings}><FolderOpen size={16} />选择遮挡文档…</button>
            <hr />
            <button role="menuitemcheckbox" aria-checked={showImages} onClick={toggleImages} disabled={imageToggleDisabled}><span className="menu-check">{showImages ? "✓" : ""}</span>显示 EPUB / Word 正文图片</button>
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
                  {concealed && cover && pages.map((_, index) => <button key={index} className="outline-item" onClick={() => { goToPage(index); if (innerWidth < 760) setSidebar(false); }}><span>第 {index + 1} 页</span><small>{index + 1}</small></button>)}
                  {outline.map((item, index) => (
                    <button
                      key={`${item.chapterId}-${index}`}
                      className="outline-item"
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
              ) : (
                <div className="file-library">
                  <button
                    className="open-document"
                    onClick={() => fileRef.current?.click()}
                    disabled={importing}
                  >
                    <FolderOpen size={16} />
                    打开 EPUB 文件
                  </button>
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
                  {library.map((saved) => (
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
                          <small>{saved.author}</small>
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
                  <p className="library-note">
                    文件仅保存在此浏览器中。拖入 EPUB 也可打开。
                    <br />
                    Q 可临时切换到参考文档，再按一次返回。
                  </p>
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
                <div className="pdf-page-frame" key={`cover-pdf-${index}`} data-page-index={index} style={{ width: PAGE_WIDTH * scale, height: PAGE_HEIGHT * scale }}><PdfCanvasPage pdf={cover.document.pdf} index={index} scale={scale} /></div>
              ) : (
                <PageSheet
                  key={`${concealed ? "reference" : book.id}-${index}`}
                  page={page}
                  index={index}
                  total={pages.length}
                  scale={scale}
                  metadata={effectiveMetadata}
                  query={findOpen ? query.trim() : ""}
                  onContentClick={contentClick}
                  sourceFilename={concealed && cover ? cover.document.filename : undefined}
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
      {notice && (!concealed || coverSettingsOpen) && (
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
          <span>松开鼠标以载入 EPUB 文件</span>
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
                desiredPage.current = currentPage;
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
