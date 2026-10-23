import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { PAGE_HEIGHT, PAGE_WIDTH } from "../lib/pagination";
import { loadPdfPageLinks, searchPdfPage, type PdfDestination, type PdfPageLink, type PdfSearchMatch } from "../lib/pdf-navigation";
import "./cover-pdf-pages.css";

/** Rasterize the original PDF in the same DOM so Q can always return to the book. */
export function PdfCanvasPage({
  pdf,
  index,
  scale,
  onNavigate,
  query = "",
  activeMatch,
  forceRender = false,
}: {
  pdf: PDFDocumentProxy;
  index: number;
  scale: number;
  onNavigate?: (destination: PdfDestination) => void;
  query?: string;
  activeMatch?: number;
  forceRender?: boolean;
}) {
  const articleRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderedCanvas = useRef<{ pdf: PDFDocumentProxy; index: number; scale: number } | null>(null);
  const [nearViewport, setNearViewport] = useState(index < 2);
  const [error, setError] = useState("");
  const [renderState, setRenderState] = useState<{ pdf: PDFDocumentProxy; index: number; scale: number; status: "true" | "error" } | null>(null);
  const [linkState, setLinkState] = useState<{ pdf: PDFDocumentProxy; index: number; links: PdfPageLink[] } | null>(null);
  const [searchState, setSearchState] = useState<{ pdf: PDFDocumentProxy; index: number; query: string; matches: PdfSearchMatch[] } | null>(null);
  const links = linkState?.pdf === pdf && linkState.index === index ? linkState.links : [];
  const matches = searchState?.pdf === pdf && searchState.index === index && searchState.query === query ? searchState.matches : [];

  useEffect(() => {
    const element = articleRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          setNearViewport(true);
      },
      { root: element.closest(".pdf-viewport"), rootMargin: "1200px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!nearViewport && !forceRender) return;
    if (renderedCanvas.current?.pdf === pdf && renderedCanvas.current.index === index && renderedCanvas.current.scale === scale) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    const canvas = canvasRef.current;
    // A new render replaces this canvas, so an earlier completed zoom can no
    // longer be reused if this render is interrupted and the zoom changes back.
    renderedCanvas.current = null;
    setRenderState(null);
    setError("");
    void pdf
      .getPage(index + 1)
      .then(async (page) => {
        if (cancelled || !canvas) return;
        const native = page.getViewport({ scale: 1 });
        const fit = Math.min(
          PAGE_WIDTH / native.width,
          PAGE_HEIGHT / native.height,
        );
        const ratio =
          Math.min(2, window.devicePixelRatio || 1) *
          Math.max(0.5, Math.min(2, scale));
        const viewport = page.getViewport({ scale: fit * ratio });
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("无法创建 PDF 画布");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${native.width * fit}px`;
        canvas.style.height = `${native.height * fit}px`;
        task = page.render({ canvasContext: context, viewport });
        await task.promise;
        if (!cancelled) {
          canvas.dataset.rendered = "true";
          renderedCanvas.current = { pdf, index, scale };
          setRenderState({ pdf, index, scale, status: "true" });
        }
      })
      .catch((reason) => {
        if (!cancelled && reason?.name !== "RenderingCancelledException") {
          setError("此 PDF 页面无法显示，请尝试重新选择文档。");
          setRenderState({ pdf, index, scale, status: "error" });
        }
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, index, scale, nearViewport, forceRender]);

  useEffect(() => {
    if (!nearViewport) return;
    let cancelled = false;
    void loadPdfPageLinks(pdf, index).then(links => {
      if (!cancelled) setLinkState({ pdf, index, links });
    }).catch(() => {
      if (!cancelled) setLinkState({ pdf, index, links: [] });
    });
    return () => { cancelled = true; };
  }, [pdf, index, nearViewport]);

  useEffect(() => {
    if (!nearViewport || !query.trim()) return;
    const controller = new AbortController();
    void searchPdfPage(pdf, index, query, controller.signal).then(matches => {
      if (!controller.signal.aborted) setSearchState({ pdf, index, query, matches });
    }).catch(() => {
      if (!controller.signal.aborted) setSearchState({ pdf, index, query, matches: [] });
    });
    return () => controller.abort();
  }, [pdf, index, query, nearViewport]);

  return (
    <article
      ref={articleRef}
      className="pdf-sheet pdf-canvas-sheet"
      data-print-ready={renderState?.pdf === pdf && renderState.index === index && renderState.scale === scale ? renderState.status : "false"}
      aria-label={`遮挡文档第 ${index + 1} 页，共 ${pdf.numPages} 页`}
      style={{
        transform: `scale(${scale})`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`PDF 第 ${index + 1} 页`}
        style={{ display: "block", maxWidth: "100%", maxHeight: "100%" }}
      />
      <div className="pdf-original-search-layer" aria-hidden="true">
        {matches.flatMap(match => match.rects.map((rect, rectIndex) => (
          <span key={`${match.occurrence}-${rectIndex}`}
            className={`pdf-original-search-mark${match.occurrence === activeMatch ? " active" : ""}`}
            data-search-match={match.occurrence}
            style={rect}
          />
        )))}
      </div>
      <div className="pdf-original-link-layer">
        {links.map(link => link.destination ? (
          onNavigate && <a key={link.id}
            className="pdf-original-page-link"
            href={`#pdf-page-${link.destination.page + 1}`}
            aria-label={link.label}
            title={link.label}
            style={link.rect}
            onClick={event => { event.preventDefault(); onNavigate(link.destination!); }}
          />
        ) : (
          <a key={link.id}
            className="pdf-original-page-link"
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={link.label}
            title={link.label}
            style={link.rect}
          />
        ))}
      </div>
      {error && (
        <p
          role="alert"
          style={{
            position: "absolute",
            padding: 36,
            font: "16px/1.8 sans-serif",
            textAlign: "center",
            color: "#333",
          }}
        >
          {error}
        </p>
      )}
    </article>
  );
}
