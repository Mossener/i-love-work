import type { Book } from "../types";
import type { DocumentBlock } from "./pagination";
import { splitChapterContent } from "./reading";

export interface DocumentMetadata {
  filename: string;
  title: string;
  journal: string;
  authors: string;
  affiliation: string;
  year: string;
}

export const DEFAULT_DOCUMENT_METADATA: DocumentMetadata = {
  filename: "ijics-2026-01428.pdf",
  title:
    "Information Processing and Knowledge Organization: A Structural Perspective",
  journal: "International Journal of Information and Cognitive Studies",
  authors: "A. Morgan, J. Chen and R. Taylor",
  affiliation: "Department of Information Science and Cognitive Studies",
  year: "2026",
};

const CONCEPTUAL_ABSTRACT =
  "Reading converts a sequence of textual signals into a working representation of ideas, relationships, and context. This conceptual overview considers information processing as a coordinated interaction between attention, interpretation, and knowledge organization. It describes how document structure can support movement between local detail and broader meaning, while acknowledging that readers bring different purposes and prior knowledge to the same material. Sections, paragraphs, and visual summaries are treated as navigational resources within this process. The discussion provides a descriptive framework for examining structured reading and for organizing source material in a consistent academic format. Its scope is conceptual, with emphasis on transparent organization, careful interpretation, and continuity across a document.";

function escapeText(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function masthead(metadata: DocumentMetadata): string {
  return `<header class="pdf-masthead">
    <div class="pdf-journal-identity">
      <svg class="pdf-journal-mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 54 54" width="54" height="54" aria-hidden="true">
        <g fill="none" stroke="currentColor" stroke-width="1.25">
          <path d="M27 3 48 15v24L27 51 6 39V15Z"/>
          <path d="m27 10 15 9v16l-15 9-15-9V19Z"/>
          <path d="m6 15 21 12 21-12M27 27v24M12 19l30 16M42 19 12 35M27 10v17"/>
        </g>
      </svg>
      <div class="pdf-journal-name">${escapeText(metadata.journal)}</div>
      <div class="pdf-article-type">PERSPECTIVE</div>
    </div>
    <h1 class="pdf-article-title">${escapeText(metadata.title)}</h1>
    <div class="pdf-authors">${escapeText(metadata.authors)}</div>
    <div class="pdf-affiliation">${escapeText(metadata.affiliation)}</div>
    <div class="pdf-dates">${escapeText(metadata.year)} · Volume 18 · Article 01428</div>
  </header>`;
}

interface DistributionBin {
  first: number;
  last: number;
  units: number;
}

function distributionFigure(book: Book): string {
  const count = Math.min(16, book.chapters.length);
  const bins: DistributionBin[] = [];
  for (let index = 0; index < count; index++) {
    const first = Math.floor((index * book.chapters.length) / count);
    const end = Math.floor(((index + 1) * book.chapters.length) / count);
    bins.push({
      first: first + 1,
      last: end,
      units: book.chapters
        .slice(first, end)
        .reduce(
          (sum, chapter) =>
            sum +
            (Number.isFinite(chapter.wordCount)
              ? Math.max(0, chapter.wordCount)
              : 0),
          0,
        ),
    });
  }
  const maximum = Math.max(1, ...bins.map((bin) => bin.units));
  const scale = 10 ** Math.floor(Math.log10(maximum));
  const ceiling = Math.ceil(maximum / scale) * scale;
  const left = 58;
  const top = 18;
  const width = 526;
  const height = 174;
  const base = top + height;
  const step = width / Math.max(1, bins.length);
  const barWidth = Math.min(36, step * 0.64);
  const number = (value: number) => Number(value.toFixed(2));
  const ticks = [0, ceiling / 2, ceiling]
    .map((value) => {
      const y = number(base - (value / ceiling) * height);
      return `<g class="pdf-chart-tick"><line x1="${left - 4}" y1="${y}" x2="${left}" y2="${y}" stroke="#1b1b1b"/><text x="${left - 9}" y="${y + 3.5}" text-anchor="end" font-size="10" fill="#333">${value}</text></g>`;
    })
    .join("");
  const bars = bins
    .map((bin, index) => {
      const barHeight = number((bin.units / ceiling) * height);
      const center = number(left + step * (index + 0.5));
      const sectionLabel =
        bin.first === bin.last ? `${bin.first}` : `${bin.first}–${bin.last}`;
      return `<g>
      <rect class="pdf-distribution-bar" data-text-units="${bin.units}" data-section-start="${bin.first}" data-section-end="${bin.last}" x="${number(center - barWidth / 2)}" y="${number(base - barHeight)}" width="${number(barWidth)}" height="${barHeight}" fill="#233e5b"><title>Section ${sectionLabel}: ${bin.units} text units</title></rect>
      <line x1="${center}" y1="${base}" x2="${center}" y2="${base + 4}" stroke="#1b1b1b"/>
      <text x="${center}" y="${base + 17}" font-size="10" text-anchor="middle" fill="#333">${index + 1}</text>
    </g>`;
    })
    .join("");
  const grouped =
    book.chapters.length > 16
      ? `<text x="321" y="249" font-size="9" text-anchor="middle" fill="#555">Consecutive sections grouped into ${count} bins</text>`
      : "";
  return `<figure class="pdf-generated-figure pdf-distribution-figure">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 258" role="img" aria-label="Distribution of textual units across document sections">
      <title>Text units by document section</title>
      <desc>Bar heights show the word counts of source sections${book.chapters.length > 16 ? ", combined in consecutive groups" : ""}.</desc>
      ${ticks}${bars}
      <path class="pdf-chart-axis" d="M${left} ${top}V${base}H${left + width}" fill="none" stroke="#1b1b1b" stroke-width="1"/>
      <text x="321" y="233" text-anchor="middle" font-size="11" fill="#222">Document section</text>
      <text transform="translate(16 105) rotate(-90)" text-anchor="middle" font-size="11" fill="#222">Text units</text>
      ${grouped}
    </svg>
    <figcaption>Figure S1. Distribution of textual units across document sections. Values are computed from the source text.</figcaption>
  </figure>`;
}

function sequenceFigure(book: Book): string {
  // A bounded sequence keeps the schematic legible for books with many sections.
  const indexes =
    book.chapters.length <= 5
      ? book.chapters.map((_, index) => index)
      : [0, 1, -1, book.chapters.length - 2, book.chapters.length - 1];
  const nodes = indexes
    .map((chapterIndex, index) => {
      const x = 9 + index * 122;
      if (chapterIndex < 0) {
        return `<text x="${x + 56}" y="45" text-anchor="middle" font-size="18" fill="#31475e">⋯</text>`;
      }
      const chapter = book.chapters[chapterIndex];
      const shortTitle =
        chapter.title.length > 19
          ? `${chapter.title.slice(0, 18)}…`
          : chapter.title;
      return `<g class="pdf-sequence-node" data-section="${chapterIndex + 1}">
      <title>${escapeText(chapter.title)}</title>
      <rect x="${x}" y="14" width="108" height="50" rx="1" fill="#f8fafc" stroke="#6f7e8d" stroke-width="0.8"/>
      <text x="${x + 54}" y="33" text-anchor="middle" font-size="10" fill="#233e5b">Section ${chapterIndex + 1}</text>
      <text x="${x + 54}" y="49" text-anchor="middle" font-size="8.5" fill="#333">${escapeText(shortTitle)}</text>
    </g>`;
    })
    .join("");
  const arrows = indexes
    .slice(1)
    .map((_, index) => {
      const x = 119 + index * 122;
      return `<path d="M${x} 39h10m-4-3 4 3-4 3" fill="none" stroke="#506277" stroke-width="1"/>`;
    })
    .join("");
  return `<figure class="pdf-generated-figure pdf-sequence-figure">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${indexes.length * 122} 80" role="img" aria-label="Source document section sequence">
      <title>Source document section sequence</title>
      <desc>${escapeText(book.chapters.map((chapter, index) => `${index + 1}. ${chapter.title}`).join("; "))}</desc>
      ${nodes}${arrows}
    </svg>
    <figcaption>Figure S2. Reading sequence of the source document${book.chapters.length > 5 ? "; intermediate sections are omitted from the schematic" : ""}.</figcaption>
  </figure>`;
}

function insertAfterSecondParagraph(html: string, figure: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  const paragraphs = template.content.querySelectorAll("p");
  const insertion = document.createElement("template");
  insertion.innerHTML = figure;
  if (paragraphs.length >= 2) paragraphs[1].after(insertion.content);
  else template.content.append(insertion.content);
  return template.innerHTML;
}

/** Compose a paper presentation around the parser's already-sanitized source HTML. */
export function buildDocumentBlocks(
  book: Book,
  metadata: DocumentMetadata,
  showFigures: boolean,
): DocumentBlock[] {
  const abstract = book.isDemo ? book.description : CONCEPTUAL_ABSTRACT;
  const blocks: DocumentBlock[] = [
    { html: masthead(metadata), chapterIndex: 0 },
    {
      html: `<section class="pdf-abstract"><strong class="pdf-abstract-label">Abstract</strong><div>${escapeText(abstract)}</div></section><div class="pdf-keywords"><strong>Keywords:</strong> information processing; knowledge organization; document structure; reading</div>`,
      chapterIndex: 0,
    },
  ];
  book.chapters.forEach((chapter, chapterIndex) => {
    const content = splitChapterContent(chapter.html, chapter.title);
    const sourceId =
      content.headingId !== undefined
        ? ` id="${escapeText(content.headingId)}"`
        : "";
    const heading = `<h2 class="pdf-section-heading" data-pdf-chapter="${chapterIndex}"${sourceId}>${chapterIndex + 1}. ${escapeText(chapter.title)}</h2>`;
    let html = content.parts.join("");
    if (showFigures && chapterIndex === 0)
      html = insertAfterSecondParagraph(html, distributionFigure(book));
    if (
      showFigures &&
      book.chapters.length > 3 &&
      chapterIndex === Math.floor(book.chapters.length / 2)
    )
      html += sequenceFigure(book);
    blocks.push({ html: heading + html, chapterIndex });
  });
  return blocks;
}
