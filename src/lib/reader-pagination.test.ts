import { describe, expect, it } from "vitest";
import { paginateBlocks } from "./pagination";

describe("reader typography pagination", () => {
  it("measures with the requested reading typography and cleans the measurement element", async () => {
    let observed: { fontSize: string; lineHeight: string; fontFamily: string } | undefined;
    const result = await paginateBlocks([{ html: "<p>Original reader text.</p>", chapterIndex: 0 }], {
      typography: { fontSize: 22, lineHeight: 1.8, fontFamily: "kai" },
      onProgress: () => {
        const measure = document.querySelector<HTMLElement>(".pdf-measure");
        if (measure) observed = {
          fontSize: measure.style.fontSize,
          lineHeight: measure.style.lineHeight,
          fontFamily: measure.style.fontFamily,
        };
      },
    });
    expect(observed?.fontSize).toBe("22px");
    expect(observed?.lineHeight).toBe("1.8");
    expect(observed?.fontFamily).toContain("KaiTi");
    expect(result.map(page => page.html).join("")).toContain("Original reader text.");
    expect(document.querySelector(".pdf-measure")).toBeNull();
  });
});
