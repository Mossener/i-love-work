import type { DocumentBlock } from "./pagination";

/** Filter a derived presentation, preserving the original source and its text anchors. */
export function applyFigureVisibility(
  blocks: DocumentBlock[],
  { images, generated }: { images: boolean; generated: boolean },
): DocumentBlock[] {
  if (images && generated) return blocks;
  return blocks.flatMap(block => {
    const template = document.createElement("template");
    template.innerHTML = block.html;
    if (!generated || !images) {
      template.content.querySelectorAll(".pdf-generated-figure").forEach(node => node.remove());
    }
    if (!images) {
      // Remove media and captions first, but keep ordinary prose nested in a
      // semantic figure wrapper. EPUB and DOCX files sometimes place a
      // paragraph next to the image inside <figure>; deleting the wrapper
      // wholesale would silently lose that source text.
      template.content.querySelectorAll("figcaption,picture,img,svg").forEach(node => {
        if (!node.closest(".pdf-masthead")) node.remove();
      });
      template.content.querySelectorAll("figure").forEach(node => {
        if (node.closest(".pdf-masthead")) return;
        const fragment = document.createDocumentFragment();
        fragment.append(...Array.from(node.childNodes));
        node.replaceWith(fragment);
      });
      template.content.querySelectorAll("p").forEach(node => {
        if (!node.textContent?.trim() && !node.querySelector("br,[id]") && !node.id) node.remove();
      });
    }
    return template.innerHTML.trim() ? [{ ...block, html: template.innerHTML }] : [];
  });
}
