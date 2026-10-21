import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { PAGE_HEIGHT, PAGE_WIDTH } from "../lib/pagination";

/** Rasterize the original PDF in the same DOM so Q can always return to the book. */
export function PdfCanvasPage({
  pdf,
  index,
  scale,
}: {
  pdf: PDFDocumentProxy;
  index: number;
  scale: number;
}) {
  const articleRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nearViewport, setNearViewport] = useState(index < 2);
  const [error, setError] = useState("");

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
    if (!nearViewport) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    const canvas = canvasRef.current;
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
        if (!cancelled) canvas.dataset.rendered = "true";
      })
      .catch((reason) => {
        if (!cancelled && reason?.name !== "RenderingCancelledException")
          setError("此 PDF 页面无法显示，请尝试重新选择文档。");
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, index, scale, nearViewport]);

  return (
    <article
      ref={articleRef}
      className="pdf-sheet pdf-canvas-sheet"
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
