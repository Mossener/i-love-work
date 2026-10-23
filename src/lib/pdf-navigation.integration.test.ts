// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { loadPdfOutline, loadPdfPageLinks, searchPdfDocument } from "./pdf-navigation";

/** A real, uncompressed PDF with named outline destinations and page annotations. */
function navigationPdf() {
  const stream = (text: string) => `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /Outlines 10 0 R /Names << /Dests << /Names [(methods) [5 0 R /XYZ 0 580 null] (results) [7 0 R /XYZ 0 300 null]] >> >> >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 9 0 R >> >> /Contents 4 0 R /Annots [14 0 R] >>",
    stream("BT /F1 22 Tf 40 720 Td (Introduction) Tj 0 -60 Td /F1 16 Tf (Click here to visit Methods) Tj ET"),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 9 0 R >> >> /Contents 6 0 R >>",
    stream("BT /F1 22 Tf 40 580 Td (Methods) Tj 0 -60 Td /F1 16 Tf (First calibration experiment) Tj 0 -60 Td (Second calibration experiment) Tj ET"),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 9 0 R >> >> /Contents 8 0 R >>",
    stream("BT /F1 22 Tf 40 300 Td (Results) Tj 0 -60 Td /F1 16 Tf (Final calibration results) Tj ET"),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Outlines /First 11 0 R /Last 13 0 R /Count 3 >>",
    "<< /Title (Introduction) /Parent 10 0 R /Dest [3 0 R /Fit] /Next 12 0 R >>",
    "<< /Title (Methods) /Parent 10 0 R /Dest (methods) /Prev 11 0 R /Next 13 0 R >>",
    "<< /Title (Results) /Parent 10 0 R /Dest (results) /Prev 12 0 R >>",
    "<< /Type /Annot /Subtype /Link /Rect [40 650 290 678] /Border [0 0 0] /Dest (methods) >>",
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe("real PDF cover navigation", () => {
  let pdf: PDFDocumentProxy;
  beforeAll(async () => {
    pdf = await getDocument({ data: navigationPdf(), useSystemFonts: true, isEvalSupported: false }).promise;
  });
  afterAll(async () => { await pdf?.destroy(); });

  it("resolves a real PDF outline and clickable page annotation to the same text location", async () => {
    const outline = await loadPdfOutline(pdf);
    expect(outline.map(item => item.title)).toEqual(["Introduction", "Methods", "Results"]);
    expect(outline[1].page).toBe(1);
    expect(outline[1].top).toBeGreaterThan(0.2);
    const links = await loadPdfPageLinks(pdf, 0);
    expect(links).toHaveLength(1);
    expect(links[0].destination).toEqual({ page: outline[1].page, top: outline[1].top });
  });

  it("extracts searchable text from actual PDF page streams with individual match coordinates", async () => {
    const matches = await searchPdfDocument(pdf, "calibration");
    expect(matches.map(item => [item.page, item.occurrence])).toEqual([[1, 0], [1, 1], [2, 0]]);
    expect(matches[0].rects[0].width).toBeGreaterThan(50);
    expect(matches[1].top).toBeGreaterThan(matches[0].top!);
  });
});
