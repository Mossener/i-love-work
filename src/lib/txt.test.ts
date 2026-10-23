import { describe, expect, it } from "vitest";
import { parseTxt } from "./txt";

const plainFile = (value: string, name = "一部小说.txt") => new File([value], name, { type: "text/plain" });

describe("TXT reading", () => {
  it("recognizes Chinese and English chapter headings and retains a preface and all source paragraphs", async () => {
    const book = await parseTxt(plainFile("前置介绍。\r\n\r\n第一章 初见\r\n　　你好，世界。\r\n另一段正文。\r\n\r\nChapter 2 A new day\r\nAn English paragraph."));
    expect(book.title).toBe("一部小说");
    expect(book.chapters.map(c => c.title)).toEqual(["正文", "第一章 初见", "Chapter 2 A new day"]);
    expect(book.toc.map(c => c.chapterId)).toEqual(book.chapters.map(c => c.id));
    expect(book.chapters[0].text).toContain("前置介绍。");
    expect(book.chapters[1].text).toContain("另一段正文。");
    expect(book.chapters[2].text).toContain("An English paragraph.");
    expect(book.imageCount).toBe(0);
  });

  it("treats markup and links as literal text rather than interpreting a TXT as HTML", async () => {
    const source = '<script>alert(1)</script>\n<img src="https://example.invalid/tracker">\n& a < b > c';
    const book = await parseTxt(plainFile(source));
    const root = document.createElement("div");
    root.innerHTML = book.chapters.map(c => c.html).join("");
    expect(root.querySelector("script,img,a")).toBeNull();
    expect(root.textContent).toContain('<script>alert(1)</script>');
    expect(root.textContent).toContain('& a < b > c');
  });

  it("decodes GBK/GB18030 and UTF-16 text without replacing Chinese characters", async () => {
    const gbk = new Uint8Array([0xb5,0xda,0xd2,0xbb,0xd5,0xc2,0x20,0xb2,0xe2,0xca,0xd4,0x0a,0xd6,0xd0,0xce,0xc4]);
    const gb = await parseTxt(new File([gbk], "GBK.txt"));
    expect(gb.chapters[0].title).toBe("第一章 测试");
    expect(gb.chapters[0].text).toContain("中文");
    expect(gb.sourceEncoding).toBe("gb18030");
    const source = "第一章 测试\n中文";
    for (const little of [true, false]) {
      const bytes = new Uint8Array(2 + source.length * 2);
      const view = new DataView(bytes.buffer);
      bytes.set(little ? [0xff,0xfe] : [0xfe,0xff]);
      [...source].forEach((c, i) => view.setUint16(2+i*2,c.charCodeAt(0),little));
      const book = await parseTxt(new File([bytes], "unicode.txt"));
      expect(book.chapters[0].title).toBe("第一章 测试");
      expect(book.chapters[0].text).toContain("中文");
    }
  });

  it("keeps BOM UTF-8, single-line books, and long paragraphs readable with stable identities", async () => {
    const text = "\ufeff" + "很长的正文。".repeat(1800);
    const first = await parseTxt(plainFile(text));
    const renamed = await parseTxt(plainFile(text, "renamed.TXT"));
    expect(first.id).toMatch(/^txt-/);
    expect(first.id).toBe(renamed.id);
    expect(first.chapters).toHaveLength(1);
    const root = document.createElement("div");root.innerHTML=first.chapters[0].html;
    expect(root.textContent).toBe(text.slice(1));
    expect(Math.max(...[...root.querySelectorAll("p")].map(p=>p.textContent!.length))).toBeLessThanOrEqual(4000);
    expect(first.wordCount).toBe(9000);
  });

  it("does not split ordinary sentences mentioning chapters and does not discard empty-heading sections", async () => {
    const book = await parseTxt(plainFile("第一章 开始\n第二章 后续\n这是第3章里的一句话。\n\n第三章 结束"));
    expect(book.chapters.map(c=>c.title)).toEqual(["第一章 开始", "第二章 后续", "第三章 结束"]);
    expect(book.chapters[1].text).toContain("这是第3章里的一句话。");
    expect(book.chapters[2].html).toContain("第三章 结束");
  });

  it("recognizes Chinese chapter numbers separated by regular or full-width spaces", async () => {
    const book = await parseTxt(plainFile("第 12 章 开始\n中文正文\n第　一百二十　回 继续\n后续正文"));
    expect(book.chapters.map(c=>c.title)).toEqual(["第 12 章 开始", "第　一百二十　回 继续"]);
  });

  it("rejects empty, binary, and oversized files with actionable errors", async () => {
    await expect(parseTxt(plainFile("\n　 \r\n"))).rejects.toThrow(/没有.*文字|为空/);
    await expect(parseTxt(new File([new Uint8Array([0,1,2,3,0,4])],"binary.txt"))).rejects.toThrow(/文本|编码|二进制/);
    const large = plainFile("placeholder");Object.defineProperty(large,"size",{value:80*1024*1024+1});
    await expect(parseTxt(large)).rejects.toThrow(/80 MB/);
  });
});
