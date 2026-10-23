import { describe, expect, it } from "vitest";
import type { Book } from "../types";
import { buildReadingBlocks } from "./reading-document";
import { buildDocumentBlocks, DEFAULT_DOCUMENT_METADATA } from "./document";
import { stampReadingAnchors } from "./reading-position";

const source: Book = {
  id: "plain-epub", title: "My book", author: "The author", language: "en",
  description: "The original description", resourceUrls: [], toc: [], wordCount: 8, imageCount: 1,
  chapters: [{ id: "one", title: "Chapter one", href: "one.xhtml", text: "Original first. Original second.", wordCount: 8, imageCount: 1,
    html: '<h1 id="title">Chapter one</h1><p id="first">Original <em>first.</em></p><p>Original second.</p><img src="blob:original" alt="Original illustration">' }],
};

describe("EPUB reading document isolation", () => {
  it("keeps original prose and illustrations without inserting the cover title, abstract or keywords", () => {
    const blocks = buildReadingBlocks(source);
    const element = document.createElement("div");
    element.innerHTML = blocks.map(block => block.html).join("");
    expect([...element.querySelectorAll("p")].map(node => node.textContent)).toEqual(["Original first.", "Original second."]);
    expect(element.querySelectorAll("img")).toHaveLength(1);
    expect(element.querySelector(".pdf-masthead,.pdf-abstract,.pdf-keywords")).toBeNull();
    expect(element.textContent).not.toContain(DEFAULT_DOCUMENT_METADATA.title);
    expect(element.textContent).not.toContain("Reading converts a sequence");
  });

  it("preserves existing source anchor identities so saved bookmarks and highlights survive the isolation fix", () => {
    const old = document.createElement("div");
    old.innerHTML = stampReadingAnchors(buildDocumentBlocks(source, DEFAULT_DOCUMENT_METADATA, true)).map(block => block.html).join("");
    const clean = document.createElement("div");
    clean.innerHTML = buildReadingBlocks(source).map(block => block.html).join("");
    for (const selector of ["#title", "#first"]) {
      expect(clean.querySelector<HTMLElement>(selector)?.dataset.readingAnchor).toBe(old.querySelector<HTMLElement>(selector)?.dataset.readingAnchor);
    }
  });
});
