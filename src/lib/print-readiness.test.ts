import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForPdfPrintReady } from "./print-readiness";

afterEach(() => vi.useRealTimers());

describe("PDF print readiness", () => {
  it("waits for every page, including pages outside the scroll viewport", async () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    root.innerHTML = '<article class="pdf-canvas-sheet" data-print-ready="true"></article><article class="pdf-canvas-sheet" data-print-ready="false"></article>';
    let finished = false;
    const promise = waitForPdfPrintReady(root, 2, new AbortController().signal).then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(100);
    expect(finished).toBe(false);
    root.lastElementChild!.setAttribute("data-print-ready", "true");
    await vi.advanceTimersByTimeAsync(100);
    await promise;
    expect(finished).toBe(true);
  });

  it("fails visibly on an unrenderable page instead of printing blank sheets", async () => {
    const root = document.createElement("div");
    root.innerHTML = '<article class="pdf-canvas-sheet" data-print-ready="error"></article>';
    await expect(waitForPdfPrintReady(root, 1, new AbortController().signal)).rejects.toThrow(/无法渲染/);
  });

  it("cancels a pending print when the displayed document changes", async () => {
    const root = document.createElement("div");
    const controller = new AbortController();
    const promise = waitForPdfPrintReady(root, 3, controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});
