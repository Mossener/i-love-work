import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  Columns2,
  FileText,
  Highlighter,
  Image as ImageIcon,
  Library,
  List,
  LoaderCircle,
  Menu,
  Minus,
  Moon,
  PanelLeftClose,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { demoBook } from "./data/demo";
import { parseEpub, releaseBook } from "./lib/epub";
import {
  listBooks,
  readSettings,
  removeBook,
  saveBook,
  savePosition,
  writeSettings,
} from "./lib/storage";
import { chapterParts, highlightHtml } from "./lib/reading";
import { PaperFigure, StructureFigure } from "./components/PaperFigures";
import type { Book, ReadingSettings, SavedBook, Theme } from "./types";

const number = (n: number) =>
  n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : n.toLocaleString();
const minutes = (n: number) => Math.max(1, Math.ceil(n / 400));
const message = (error: unknown) =>
  error instanceof Error ? error.message : "操作未完成，请重试。";

function safeGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Reading remains available without storage. */
  }
}

export default function App() {
  const [book, setBook] = useState<Book>(demoBook);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [library, setLibrary] = useState<SavedBook[]>([]);
  const [settings, setSettings] = useState<ReadingSettings>(readSettings);
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [activeFragment, setActiveFragment] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [imagePreview, setImagePreview] = useState<{
    src: string;
    caption: string;
  } | null>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [aboutOpen, setAboutOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);
  const loadingRef = useRef(false);
  const chapter = book.chapters[chapterIndex] || book.chapters[0];
  const progress = Math.round(
    ((chapterIndex + scrollProgress) / book.chapters.length) * 100,
  );
  const parts = useMemo(
    () => chapterParts(highlightHtml(chapter.html, activeQuery), chapter.title),
    [chapter.html, chapter.title, activeQuery],
  );
  const tocEntries = useMemo(() => {
    const items = book.toc.length
      ? book.toc
      : book.chapters.map((item) => ({
          title: item.title,
          chapterId: item.id,
          level: 0,
          fragment: undefined,
        }));
    return items
      .map((item) => ({
        ...item,
        index: book.chapters.findIndex(
          (chapter) => chapter.id === item.chapterId,
        ),
      }))
      .filter((item) => item.index >= 0);
  }, [book]);
  const updateSettings = (patch: Partial<ReadingSettings>) =>
    setSettings((value) => ({ ...value, ...patch }));
  const notify = useCallback(
    (text: string, error = false) => setNotice({ text, error }),
    [],
  );

  useEffect(() => {
    writeSettings(settings);
  }, [settings]);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);
  useEffect(() => {
    if (notice) {
      const timer = window.setTimeout(
        () => setNotice(null),
        notice.error ? 8000 : 4000,
      );
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => {
    let cancelled = false;
    listBooks()
      .then(async (items) => {
        if (cancelled) return;
        setLibrary(items);
        const last = items.find(
          (item) => item.id === safeGet("paperleaf-active-book"),
        );
        if (last && !loadingRef.current) {
          loadingRef.current = true;
          setBusy(true);
          try {
            const parsed = await parseEpub(last.file);
            if (cancelled) releaseBook(parsed);
            else {
              setBook(parsed);
              setChapterIndex(
                Math.max(
                  0,
                  Math.min(last.chapterIndex, parsed.chapters.length - 1),
                ),
              );
            }
          } catch (error) {
            if (!cancelled) notify(message(error), true);
          } finally {
            loadingRef.current = false;
            if (!cancelled) setBusy(false);
          }
        }
      })
      .catch(() => {
        /* Library errors are explained on import; the demo stays usable. */
      });
    return () => {
      cancelled = true;
    };
  }, [notify]);
  useEffect(() => () => releaseBook(book), [book]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      readerRef.current?.scrollTo({ top: 0 });
      setScrollProgress(0);
    });
    return () => cancelAnimationFrame(frame);
  }, [book.id, chapterIndex]);
  useEffect(() => {
    if (searchOpen) {
      const timer = setTimeout(() => searchRef.current?.focus(), 30);
      return () => clearTimeout(timer);
    }
  }, [searchOpen]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((value) => !value);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setSettingsOpen(false);
        setImagePreview(null);
        setAboutOpen(false);
        setSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
  useEffect(() => {
    if (!searchOpen && !imagePreview && !aboutOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const focusables = () => [
      ...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, a[href], [tabindex="0"]',
      ),
    ];
    focusables()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusables();
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    dialog.addEventListener("keydown", trap);
    return () => {
      dialog.removeEventListener("keydown", trap);
      previousFocus?.focus();
    };
  }, [searchOpen, imagePreview, aboutOpen]);

  const goToChapter = (index: number, fragment?: string) => {
    const next = Math.max(0, Math.min(index, book.chapters.length - 1));
    setChapterIndex(next);
    setActiveFragment(fragment || "");
    setSidebarOpen(false);
    if (!fragment) readerRef.current?.scrollTo({ top: 0 });
    if (!book.isDemo) {
      setLibrary((value) =>
        value.map((item) =>
          item.id === book.id ? { ...item, chapterIndex: next } : item,
        ),
      );
      savePosition(book.id, next).catch(() => {});
    }
    if (fragment)
      setTimeout(() => {
        const target = [
          ...(readerRef.current?.querySelectorAll("[id]") || []),
        ].find((element) => element.id === fragment);
        if (target)
          target.scrollIntoView({ block: "start", behavior: "smooth" });
        else readerRef.current?.scrollTo({ top: 0 });
      }, 100);
  };

  const importFile = async (file: File) => {
    if (loadingRef.current) return;
    if (!file.name.toLowerCase().endsWith(".epub")) {
      notify("请选择 .epub 格式的电子书。", true);
      return;
    }
    loadingRef.current = true;
    setBusy(true);
    try {
      const parsed = await parseEpub(file);
      setBook(parsed);
      setChapterIndex(0);
      setActiveQuery("");
      setActiveFragment("");
      setSidebarOpen(false);
      safeSet("paperleaf-active-book", parsed.id);
      const saved: SavedBook = {
        id: parsed.id,
        title: parsed.title,
        author: parsed.author,
        file,
        addedAt: Date.now(),
        chapterIndex: 0,
      };
      try {
        await saveBook(saved);
        setLibrary(await listBooks());
        notify(`《${parsed.title}》已加入书架`);
      } catch {
        notify("书籍已打开，但浏览器存储不可用，刷新后需重新导入。", true);
      }
    } catch (error) {
      notify(message(error), true);
    } finally {
      loadingRef.current = false;
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const openBook = async (saved?: SavedBook) => {
    if (loadingRef.current) return;
    if (!saved) {
      setBook(demoBook);
      setChapterIndex(0);
      setActiveQuery("");
      setActiveFragment("");
      setSidebarOpen(false);
      safeSet("paperleaf-active-book", "demo");
      return;
    }
    if (saved.id === book.id) {
      setSidebarOpen(false);
      return;
    }
    loadingRef.current = true;
    setBusy(true);
    try {
      const parsed = await parseEpub(saved.file);
      setBook(parsed);
      setChapterIndex(
        Math.max(0, Math.min(saved.chapterIndex, parsed.chapters.length - 1)),
      );
      setActiveQuery("");
      setActiveFragment("");
      setSidebarOpen(false);
      safeSet("paperleaf-active-book", parsed.id);
    } catch (error) {
      notify(message(error), true);
    } finally {
      loadingRef.current = false;
      setBusy(false);
    }
  };

  const deleteBook = async (saved: SavedBook) => {
    try {
      await removeBook(saved.id);
      setLibrary((value) => value.filter((item) => item.id !== saved.id));
      if (book.id === saved.id) void openBook();
      notify("已从本地书架移除");
    } catch (error) {
      notify(message(error), true);
    }
  };

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return book.chapters.flatMap((item, index) => {
      const position = item.text.toLowerCase().indexOf(term);
      if (position < 0 && !item.title.toLowerCase().includes(term)) return [];
      const start = Math.max(0, position - 35);
      return [
        {
          index,
          title: item.title,
          snippet:
            (start ? "…" : "") + item.text.slice(start, start + 130) + "…",
        },
      ];
    });
  }, [book, query]);

  const contentClick = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as Element;
    const link = target.closest("a");
    if (link) {
      event.preventDefault();
      const id = link.dataset.chapterId;
      const index = id ? book.chapters.findIndex((item) => item.id === id) : -1;
      if (index >= 0) goToChapter(index, link.dataset.fragment);
      else if (link.getAttribute("href")?.startsWith("#"))
        goToChapter(chapterIndex, link.getAttribute("href")!.slice(1));
      else notify("为保持本地阅读，书内外部链接不会自动打开。");
      return;
    }
    const img = target.closest("img") as HTMLImageElement | null;
    const svg = target.closest(".epub-content figure svg") as SVGElement | null;
    if (img)
      setImagePreview({
        src: img.src,
        caption:
          img.closest("figure")?.querySelector("figcaption")?.textContent ||
          img.alt ||
          "原书插图",
      });
    else if (svg) {
      const data = new XMLSerializer().serializeToString(svg);
      setImagePreview({
        src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`,
        caption:
          svg.closest("figure")?.querySelector("figcaption")?.textContent ||
          "原书示意图",
      });
    }
  };

  const readingStyle = {
    "--reading-size": `${settings.fontSize}px`,
  } as CSSProperties;
  const themes: { id: Theme; label: string }[] = [
    { id: "paper", label: "纸白" },
    { id: "sepia", label: "暖纸" },
    { id: "dark", label: "夜读" },
  ];

  return (
    <div
      className={`app ${sidebarHidden ? "sidebar-hidden" : ""}`}
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          dragDepth.current++;
          setDragOver(true);
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current--;
        if (dragDepth.current <= 0) setDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragOver(false);
        const file = event.dataTransfer.files[0];
        if (file) void importFile(file);
      }}
    >
      <input
        ref={fileRef}
        className="visually-hidden"
        type="file"
        accept=".epub,application/epub+zip"
        aria-label="选择 EPUB 文件"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
        }}
      />
      <header className="app-header">
        <button
          className="brand"
          onClick={() => setAboutOpen(true)}
          aria-label="关于纸间 Paperleaf"
        >
          <span className="brand-icon">
            <BookOpen size={23} strokeWidth={1.6} />
          </span>
          <span className="brand-name">
            纸间<span className="brand-en">paperleaf</span>
          </span>
          <span className="brand-divider" />
          <span className="brand-caption">让阅读，回到纸上。</span>
        </button>
        <div className="header-actions">
          <button
            className="search-trigger"
            aria-label="搜索书中内容"
            onClick={() => setSearchOpen(true)}
          >
            <Search size={16} />
            <span>搜索书中内容</span>
            <kbd>Ctrl K</kbd>
          </button>
          <button
            className="icon-button header-help"
            aria-label="使用说明"
            title="使用说明"
            onClick={() => setAboutOpen(true)}
          >
            <BookOpen size={19} />
          </button>
          <span className="header-action-divider" />
          <button
            className="button button-primary import-button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Plus size={17} />
            )}
            <span>{busy ? "正在解析" : "导入 EPUB"}</span>
          </button>
        </div>
      </header>

      {(sidebarOpen || settingsOpen) && (
        <button
          className="mobile-scrim"
          aria-label="关闭面板"
          onClick={() => {
            setSidebarOpen(false);
            setSettingsOpen(false);
          }}
        />
      )}

      <aside
        className={`sidebar ${sidebarOpen ? "is-open" : ""}`}
        aria-label="书架与目录"
      >
        <div className="sidebar-heading">
          <span>
            <Library size={15} />
            我的书架
          </span>
          <button
            className="icon-button small"
            aria-label="导入电子书"
            title="导入电子书"
            onClick={() => fileRef.current?.click()}
          >
            <Plus size={17} />
          </button>
        </div>
        <div className="bookshelf">
          <div className={`shelf-item ${book.isDemo ? "selected" : ""}`}>
            <button className="shelf-book" onClick={() => void openBook()}>
              <span className="mini-cover">
                <span>
                  阅读的
                  <br />
                  形状
                </span>
                <i />
              </span>
              <span className="shelf-copy">
                <strong>阅读的形状</strong>
                <small>纸间编辑部</small>
              </span>
              <span className="demo-tag">示例</span>
            </button>
          </div>
          {library.map((saved) => (
            <div
              key={saved.id}
              className={`shelf-item ${saved.id === book.id ? "selected" : ""}`}
            >
              <button
                className="shelf-book"
                onClick={() => void openBook(saved)}
                disabled={busy}
              >
                <span className="mini-cover imported">
                  <FileText size={20} strokeWidth={1.2} />
                </span>
                <span className="shelf-copy">
                  <strong>{saved.title}</strong>
                  <small>{saved.author}</small>
                </span>
              </button>
              <button
                className="delete-book icon-button small"
                aria-label={`移除《${saved.title}》`}
                title="从本地书架移除"
                onClick={() => void deleteBook(saved)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="sidebar-rule" />
        <div className="sidebar-heading contents-heading">
          <span>
            <List size={15} />
            章节目录
          </span>
          <span className="chapter-total">{book.chapters.length} 章</span>
        </div>
        <nav className="chapter-list" aria-label="章节目录">
          {tocEntries.map((item, order) => {
            const firstInChapter = tocEntries.find(
              (entry) => entry.index === item.index,
            );
            const isActive =
              item.index === chapterIndex &&
              (activeFragment
                ? item.fragment === activeFragment
                : item === firstInChapter);
            return (
              <button
                key={`${item.chapterId}-${item.fragment || ""}-${order}`}
                style={{
                  paddingLeft: `${13 + Math.min(item.level, 3) * 12}px`,
                }}
                className={`chapter-link ${isActive ? "active" : ""}`}
                onClick={() => {
                  setActiveQuery("");
                  goToChapter(item.index, item.fragment);
                }}
                aria-current={isActive ? "location" : undefined}
              >
                <span className="chapter-number">
                  {item.level ? "·" : String(item.index + 1).padStart(2, "0")}
                </span>
                <span>{item.title}</span>
                {item.index < chapterIndex && (
                  <Check size={13} className="chapter-read" />
                )}
              </button>
            );
          })}
        </nav>
        <button
          className="drop-card"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <span className="drop-card-icon">
            <Upload size={19} strokeWidth={1.5} />
          </span>
          <strong>把下一本好书带进来</strong>
          <span>拖入 EPUB 文件，开启纸上阅读</span>
          <span className="drop-card-action">
            选择本地文件 <ArrowRight size={13} />
          </span>
        </button>
        <div className="sidebar-bottom">
          <div className="progress-label">
            <span>本书阅读进度</span>
            <strong>{progress}%</strong>
          </div>
          <div className="progress-track">
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="local-note">
            <ShieldCheck size={13} />
            <span>书籍仅保存在你的浏览器中</span>
          </div>
        </div>
      </aside>

      <main className="reader-shell">
        <div className="reader-toolbar">
          <div className="breadcrumb">
            <button
              className="icon-button sidebar-toggle desktop-only"
              aria-label={sidebarHidden ? "显示目录" : "收起目录"}
              onClick={() => setSidebarHidden((value) => !value)}
            >
              <PanelLeftClose size={17} />
            </button>
            <button
              className="icon-button mobile-only"
              aria-label="打开目录"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={19} />
            </button>
            <span className="breadcrumb-book">{book.title}</span>
            <ChevronRight size={13} />
            <span className="breadcrumb-chapter">第 {chapterIndex + 1} 章</span>
            {book.isDemo && <span className="sample-label">示例书籍</span>}
          </div>
          <div className="reader-tools">
            <span className="saved-state">
              <CheckCheck size={14} />
              本地阅读
            </span>
            <span className="tool-divider" />
            <div className="layout-switch" aria-label="正文栏数">
              <button
                className={settings.columns === 1 ? "active" : ""}
                onClick={() => updateSettings({ columns: 1 })}
                aria-label="单栏排版"
                title="单栏排版"
              >
                <FileText size={15} />
              </button>
              <button
                className={settings.columns === 2 ? "active" : ""}
                onClick={() => updateSettings({ columns: 2 })}
                aria-label="双栏排版"
                title="双栏排版"
              >
                <Columns2 size={15} />
              </button>
            </div>
            <button
              className={`icon-button ${settingsOpen ? "is-active" : ""}`}
              aria-label="阅读设置"
              title="阅读设置"
              onClick={() => setSettingsOpen((value) => !value)}
            >
              <Settings2 size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="打印或导出当前章节为 PDF"
              title="打印或导出当前章节为 PDF"
              onClick={() => window.print()}
            >
              <ArrowDownToLine size={17} />
            </button>
          </div>
        </div>

        {settingsOpen && (
          <section className="settings-panel" aria-label="阅读设置">
            <div className="panel-heading">
              <h2>阅读设置</h2>
              <button
                className="icon-button"
                aria-label="关闭阅读设置"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={17} />
              </button>
            </div>
            <label className="setting-label">
              正文字号 <span>{settings.fontSize} px</span>
            </label>
            <div className="font-control">
              <button
                className="icon-button"
                aria-label="减小字号"
                disabled={settings.fontSize <= 14}
                onClick={() =>
                  updateSettings({ fontSize: settings.fontSize - 1 })
                }
              >
                <Minus size={15} />
              </button>
              <span
                className="font-sample"
                style={{ fontSize: settings.fontSize }}
              >
                字如其书 Aa
              </span>
              <button
                className="icon-button"
                aria-label="增大字号"
                disabled={settings.fontSize >= 24}
                onClick={() =>
                  updateSettings({ fontSize: settings.fontSize + 1 })
                }
              >
                <Plus size={15} />
              </button>
            </div>
            <span className="setting-label">纸张颜色</span>
            <div className="theme-options">
              {themes.map((theme) => (
                <button
                  key={theme.id}
                  className={`theme-option theme-${theme.id} ${settings.theme === theme.id ? "selected" : ""}`}
                  onClick={() => updateSettings({ theme: theme.id })}
                >
                  {theme.id === "dark" ? <Moon size={16} /> : <Sun size={16} />}
                  <span>{theme.label}</span>
                  {settings.theme === theme.id && <Check size={12} />}
                </button>
              ))}
            </div>
            <div className="figure-setting">
              <span>
                <strong>论文辅助图示</strong>
                <small>章节数据图与内容结构图</small>
              </span>
              <button
                role="switch"
                aria-checked={settings.showFigures}
                aria-label="显示论文辅助图示"
                className={`toggle ${settings.showFigures ? "on" : ""}`}
                onClick={() =>
                  updateSettings({ showFigures: !settings.showFigures })
                }
              >
                <i />
              </button>
            </div>
            <p className="settings-footnote">
              原书图片始终保留。设置会自动保存。
            </p>
          </section>
        )}

        <div
          className="reader-scroll"
          ref={readerRef}
          onScroll={(event) => {
            const el = event.currentTarget;
            const height = el.scrollHeight - el.clientHeight;
            setScrollProgress(height > 0 ? el.scrollTop / height : 0);
          }}
        >
          <div className="reading-intro">
            <span>
              <span className="live-dot" />
              PAPER EDITION
            </span>
            <span>一本书的另一种打开方式</span>
          </div>
          <article
            className={`paper ${settings.columns === 2 ? "two-columns" : ""}`}
            style={readingStyle}
            onClick={contentClick}
          >
            <div className="paper-running-head">
              <span>PAPERLEAF READING JOURNAL</span>
              <span>
                VOL. {String(chapterIndex + 1).padStart(2, "0")} <i> / </i>{" "}
                {book.language?.toLowerCase().startsWith("zh")
                  ? "中文"
                  : book.language?.toUpperCase() || "EPUB"}
              </span>
            </div>
            <header className="paper-title-block">
              <span className="article-eyebrow">
                {book.isDemo
                  ? "关于阅读、思考与知识的连接"
                  : "EPUB · 论文式阅读"}
              </span>
              <h1>{book.title}</h1>
              {book.isDemo && (
                <p className="paper-subtitle">从线性文字，到知识的星图</p>
              )}
              <div className="paper-byline">
                <span>
                  <span className="author-dot" />
                  {book.author || "佚名"}
                </span>
                <span className="byline-separator">/</span>
                <span>{book.chapters.length} 章</span>
                <span className="byline-separator">/</span>
                <span>约 {number(book.wordCount)} 字 / 词</span>
                <span className="byline-separator">/</span>
                <span>{book.imageCount} 幅原书插图</span>
              </div>
            </header>
            {chapterIndex === 0 && (
              <section className="abstract-block">
                <span className="abstract-label">
                  {book.isDemo ? "内容提要" : "阅读摘要"}
                  <small>ABSTRACT</small>
                </span>
                <div>
                  <p>
                    {book.description
                      ? book.description.length > 420
                        ? book.description.slice(0, 420) + "…"
                        : book.description
                      : `《${book.title}》由${book.author || "佚名"}创作。本书共 ${book.chapters.length} 章，包含 ${book.imageCount} 幅原书插图。正文按原书顺序重排，保留章节、插图和注释。`}
                  </p>
                  {book.isDemo && (
                    <div className="keywords">
                      <strong>关键词</strong>
                      <span>深度阅读</span>
                      <span>知识连接</span>
                      <span>思维模型</span>
                    </div>
                  )}
                </div>
              </section>
            )}
            <div className="article-chapter-heading">
              <h2>
                <span>{String(chapterIndex + 1).padStart(2, "0")}</span>
                {chapter.title}
              </h2>
              <span className="chapter-reading-time">
                约 {minutes(chapter.wordCount)} 分钟阅读
              </span>
            </div>
            <div
              className="epub-content"
              dangerouslySetInnerHTML={{ __html: parts[0] }}
            />
            {settings.showFigures &&
              parts[1] &&
              !book.isDemo &&
              (chapterIndex % 2 === 0 ? (
                <PaperFigure book={book} chapterIndex={chapterIndex} />
              ) : (
                <StructureFigure book={book} chapterIndex={chapterIndex} />
              ))}
            {parts[1] && (
              <div
                className="epub-content"
                dangerouslySetInnerHTML={{ __html: parts[1] }}
              />
            )}
            {settings.showFigures &&
              (book.isDemo || !parts[1]) &&
              (chapterIndex % 2 === 0 ? (
                <PaperFigure book={book} chapterIndex={chapterIndex} />
              ) : (
                <StructureFigure book={book} chapterIndex={chapterIndex} />
              ))}
            <div className="chapter-end-mark">❦</div>
            <footer className="paper-footer">
              <span>
                {book.author} · {book.title}
              </span>
              <span>
                {String(chapterIndex + 1).padStart(2, "0")} /{" "}
                {String(book.chapters.length).padStart(2, "0")}
              </span>
            </footer>
          </article>
          <div className="chapter-navigation">
            <button
              className="chapter-nav-button previous"
              disabled={chapterIndex === 0}
              onClick={() => {
                setActiveQuery("");
                goToChapter(chapterIndex - 1);
              }}
            >
              <ArrowLeft size={17} />
              <span>
                <small>上一章</small>
                <strong>
                  {book.chapters[chapterIndex - 1]?.title || "已经是第一章"}
                </strong>
              </span>
            </button>
            <span className="nav-page">
              {chapterIndex + 1} <i>/</i> {book.chapters.length}
            </span>
            <button
              className="chapter-nav-button next"
              disabled={chapterIndex === book.chapters.length - 1}
              onClick={() => {
                setActiveQuery("");
                goToChapter(chapterIndex + 1);
              }}
            >
              <span>
                <small>继续阅读</small>
                <strong>
                  {book.chapters[chapterIndex + 1]?.title || "全书阅读完毕"}
                </strong>
              </span>
              <ArrowRight size={17} />
            </button>
          </div>
          <p className="reader-bottom-note">
            <BookOpen size={13} />
            让知识沉淀，让思考发生。<span>MADE FOR SLOW READING</span>
          </p>
        </div>
        <footer className="status-bar">
          <span>
            <span className="status-dot" />
            {book.isDemo
              ? "正在阅读示例书籍 · 导入 EPUB 开始你的阅读"
              : "文件在本机解析，内容不会上传"}
          </span>
          <div>
            <ImageIcon size={12} />
            <span>原书插图已保留</span>
            <span className="status-separator">·</span>
            <span>{settings.columns === 2 ? "双栏排版" : "单栏排版"}</span>
            <span className="status-separator">·</span>
            <span>{settings.fontSize} px</span>
          </div>
        </footer>
      </main>

      {busy && (
        <div className="loading-indicator" role="status">
          <LoaderCircle size={17} className="spin" />
          <span>正在解开书页，整理图文…</span>
        </div>
      )}
      {notice && (
        <div
          className={`toast ${notice.error ? "error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.error ? <FileText size={17} /> : <Check size={17} />}
          <span>{notice.text}</span>
          <button
            className="icon-button small"
            aria-label="关闭提示"
            onClick={() => setNotice(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {dragOver && (
        <div className="drop-overlay">
          <div>
            <Upload size={38} strokeWidth={1.2} />
            <h2>把书放在这里</h2>
            <p>松开鼠标，将 EPUB 排成一篇好读的论文。</p>
            <span>本地解析 · 保留插图 · 私密阅读</span>
          </div>
        </div>
      )}

      {searchOpen && (
        <div className="modal-backdrop" onClick={() => setSearchOpen(false)}>
          <section
            className="search-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="搜索书中内容"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="search-input-row">
              <Search size={21} />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题、段落或关键词…"
                aria-label="书内搜索关键词"
              />
              <button
                className="escape-button"
                aria-label="关闭搜索"
                onClick={() => setSearchOpen(false)}
              >
                ESC
              </button>
            </div>
            <div className="search-context">
              在《{book.title}》中搜索
              {query.trim() && <span>{results.length} 个匹配章节</span>}
            </div>
            <div className="search-results">
              {!query.trim() ? (
                <div className="search-empty">
                  <Search size={31} strokeWidth={1} />
                  <strong>在文字中，发现连接</strong>
                  <p>输入关键词，搜索全书的标题与正文。</p>
                </div>
              ) : results.length ? (
                results.map((result) => (
                  <button
                    className="search-result"
                    key={result.index}
                    onClick={() => {
                      goToChapter(result.index);
                      setActiveQuery(query.trim());
                      setSearchOpen(false);
                      setTimeout(
                        () =>
                          readerRef.current
                            ?.querySelector("mark")
                            ?.scrollIntoView({
                              block: "center",
                              behavior: "smooth",
                            }),
                        150,
                      );
                    }}
                  >
                    <span className="result-number">
                      {String(result.index + 1).padStart(2, "0")}
                    </span>
                    <span>
                      <strong>{result.title}</strong>
                      <p>{result.snippet}</p>
                    </span>
                    <ArrowRight size={17} />
                  </button>
                ))
              ) : (
                <div className="search-empty">
                  <FileText size={31} strokeWidth={1} />
                  <strong>没有找到相关内容</strong>
                  <p>换一个关键词，再试一次。</p>
                </div>
              )}
            </div>
            <div className="search-footer">
              <span>全文搜索 · 包含所有章节</span>
              <span>Esc 关闭</span>
            </div>
          </section>
        </div>
      )}

      {imagePreview && (
        <div
          className="modal-backdrop image-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="插图预览"
          onClick={() => setImagePreview(null)}
        >
          <button
            className="image-close icon-button"
            aria-label="关闭插图预览"
            onClick={() => setImagePreview(null)}
          >
            <X size={25} />
          </button>
          <figure
            className="image-preview"
            onClick={(event) => event.stopPropagation()}
          >
            <img src={imagePreview.src} alt={imagePreview.caption} />
            <figcaption>{imagePreview.caption}</figcaption>
          </figure>
        </div>
      )}

      {aboutOpen && (
        <div className="modal-backdrop" onClick={() => setAboutOpen(false)}>
          <section
            className="about-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="关于纸间"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="about-close icon-button"
              aria-label="关闭使用说明"
              onClick={() => setAboutOpen(false)}
            >
              <X size={20} />
            </button>
            <span className="about-icon">
              <BookOpen size={31} strokeWidth={1.4} />
            </span>
            <span className="about-eyebrow">MEET YOUR PAPER EDITION</span>
            <h2>好书，值得另一种读法。</h2>
            <p>
              纸间将 EPUB
              电子书整理成论文般的阅读版面。保留原书文字与插图，让每一次阅读更专注。
            </p>
            <div className="about-features">
              <span>
                <Upload size={19} />
                <strong>带来一本书</strong>
                <small>点击「导入 EPUB」或直接拖入文件，最大 80 MB。</small>
              </span>
              <span>
                <Highlighter size={19} />
                <strong>按自己的节奏</strong>
                <small>切换单双栏、字号与纸张颜色；Ctrl K 搜索全书。</small>
              </span>
              <span>
                <ImageIcon size={19} />
                <strong>让内容可视化</strong>
                <small>
                  保留原图，补充实际章节数据图与明确标注的结构示意图。
                </small>
              </span>
              <span>
                <ShieldCheck size={19} />
                <strong>留在你的设备</strong>
                <small>
                  书籍与进度存于本地浏览器。清除站点数据会移除书架。
                </small>
              </span>
            </div>
            <p className="about-note">
              支持常见的无 DRM EPUB 2 / 3。PDF
              导出为当前章节，可在打印窗口选择「另存为
              PDF」。示例内容与插图由纸间原创。
              <a className="sample-download" href="/samples/paperleaf-sample.epub" download>
                下载 EPUB 示例
              </a>
            </p>
            <button
              className="button button-primary"
              onClick={() => {
                setAboutOpen(false);
                fileRef.current?.click();
              }}
            >
              <Plus size={16} />
              导入我的第一本书
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
