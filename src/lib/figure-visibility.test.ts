import { describe, expect, it } from "vitest";
import { applyFigureVisibility } from "./figure-visibility";

function render(html: string, images = true, generated = true) {
  const result = applyFigureVisibility([{ html, chapterIndex: 2 }], { images, generated });
  return new DOMParser().parseFromString(result.map(block => block.html).join(""), "text/html");
}

describe("applyFigureVisibility", () => {
  it("hides source figures and captions, inline images and generated diagrams while retaining surrounding prose", () => {
    const doc = render('<p data-reading-anchor="a" data-reading-start="12">Before <em>original</em><img src="blob:x"> after.</p><figure><svg><text>chart label</text></svg><figcaption>caption</figcaption></figure><p>Next paragraph.</p>', false);
    expect(doc.querySelector("img,svg,figure,figcaption")).toBeNull();
    expect(doc.body.textContent).toBe("Before original after.Next paragraph.");
    expect(doc.querySelector("em")?.textContent).toBe("original");
    expect(doc.querySelector("p")?.dataset.readingAnchor).toBe("a");
    expect(doc.querySelector("p")?.dataset.readingStart).toBe("12");
  });

  it("controls added figures independently while keeping the original artwork", () => {
    const doc = render('<figure id="original"><img src="blob:x"></figure><figure class="pdf-generated-figure"><svg></svg></figure>', true, false);
    expect(doc.querySelector("#original img")).not.toBeNull();
    expect(doc.querySelector(".pdf-generated-figure")).toBeNull();
  });

  it("removes native figure media without deleting prose inside the figure wrapper", () => {
    const doc = render('<p>Before.</p><figure id="source-figure"><p data-reading-anchor="source" data-reading-start="0">Original <em>embedded</em> prose.</p><img src="blob:x"><figcaption>Image caption.</figcaption></figure><p>After.</p>', false);
    expect(doc.querySelector("img,svg,figure,figcaption")).toBeNull();
    expect(doc.body.textContent).toBe("Before.Original embedded prose.After.");
    expect(doc.querySelector('[data-reading-anchor="source"]')?.textContent).toBe("Original embedded prose.");
    expect(doc.querySelector("em")?.textContent).toBe("embedded");
  });

  it("keeps the paper identity mark and preserves escaped text as text", () => {
    const doc = render('<header class="pdf-masthead"><svg><path d="M0 0"></path></svg></header><p>&lt;script&gt;visible text&lt;/script&gt;</p>', false);
    expect(doc.querySelector(".pdf-masthead svg")).not.toBeNull();
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector("p")?.textContent).toBe("<script>visible text</script>");
  });

  it("leaves the input unchanged and recovers images when shown again", () => {
    const blocks = [{ html: '<p>Text</p><figure><img src="blob:x"><figcaption>Caption</figcaption></figure>', chapterIndex: 3 }];
    const original = JSON.stringify(blocks);
    applyFigureVisibility(blocks, { images: false, generated: false });
    const shown = applyFigureVisibility(blocks, { images: true, generated: true });
    expect(JSON.stringify(blocks)).toBe(original);
    expect(shown[0].html).toBe(blocks[0].html);
    expect(shown[0].chapterIndex).toBe(3);
  });
});
