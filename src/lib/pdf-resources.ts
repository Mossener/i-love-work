// Local assets work offline in both Vite development and the production build.
const cmapUrls = import.meta.glob<string>(
  "/node_modules/pdfjs-dist/cmaps/*.bcmap",
  { query: "?url", import: "default", eager: true },
);
const fontUrls = import.meta.glob<string>(
  "/node_modules/pdfjs-dist/standard_fonts/*",
  { query: "?url", import: "default", eager: true },
);

export class LocalCMapReaderFactory {
  async fetch({ name }: { name: string }) {
    const url = cmapUrls[`/node_modules/pdfjs-dist/cmaps/${name}.bcmap`];
    if (!url) throw new Error("PDF character map unavailable");
    const response = await fetch(url);
    if (!response.ok) throw new Error("PDF character map could not be loaded");
    return {
      cMapData: new Uint8Array(await response.arrayBuffer()),
      isCompressed: true,
    };
  }
}

export class LocalStandardFontDataFactory {
  async fetch({ filename }: { filename: string }) {
    const url = fontUrls[`/node_modules/pdfjs-dist/standard_fonts/${filename}`];
    if (!url) throw new Error("PDF font unavailable");
    const response = await fetch(url);
    if (!response.ok) throw new Error("PDF font could not be loaded");
    return new Uint8Array(await response.arrayBuffer());
  }
}
