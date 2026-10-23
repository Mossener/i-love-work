export async function waitForPdfPrintReady(root: HTMLElement, pages: number, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + 120_000;
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new DOMException("打印已取消", "AbortError")); };
    const check = () => {
      if (signal.aborted) { abort(); return; }
      const elements = [...root.querySelectorAll<HTMLElement>(".pdf-canvas-sheet")];
      if (elements.some(element => element.dataset.printReady === "error")) {
        cleanup(); reject(new Error("PDF 中有页面无法渲染，已取消打印。请重新选择文档。")); return;
      }
      if (elements.length === pages && elements.every(element => element.dataset.printReady === "true")) {
        cleanup(); resolve(); return;
      }
      if (Date.now() > deadline) { cleanup(); reject(new Error("打印准备超时，请稍后重试或下载原始 PDF 打印。")); return; }
      timer = setTimeout(check, 50);
    };
    signal.addEventListener("abort", abort, { once: true });
    check();
  });
}
