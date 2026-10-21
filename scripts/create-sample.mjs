import JSZip from "jszip";
import { mkdir, writeFile } from "node:fs/promises";

// A real, DRM-free EPUB used for import verification and available as a sample.
const zip = new JSZip();
zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
zip.file(
  "META-INF/container.xml",
  '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
);
zip.file(
  "EPUB/package.opf",
  `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">paperleaf-local-sample-2026</dc:identifier><dc:title>纸上阅读实验</dc:title><dc:creator>纸间编辑部</dc:creator><dc:language>zh-CN</dc:language><dc:description>这是一本供导入体验的 EPUB 示例，包含中文正文、原书 SVG 插图、跨章链接和图片图注。所有图示均为说明阅读方法的概念示意。</dc:description><meta property="dcterms:modified">2026-10-20T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="text/chapter-1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/chapter-2.xhtml" media-type="application/xhtml+xml"/><item id="c3" href="text/chapter-3.xhtml" media-type="application/xhtml+xml"/><item id="figure" href="images/reading.svg" media-type="image/svg+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine></package>`,
);
const titles = ["阅读是一场主动的对话", "用问题连接知识", "让理解回到日常"];
const text = [
  [
    "打开一本书，也是在打开一种观察世界的方式。作者安排了文字的顺序，读者则带着自己的问题进入其中。一次好的阅读，既需要耐心跟随论证，也需要在恰当的位置停下来，辨认哪些内容改变了自己的理解。",
    "在连续阅读之后，我们可以把一个段落概括成一个问题：这段文字试图解释什么？它依靠了哪些前提？这样的追问不会破坏阅读的连贯，反而能让内容之间的联系变得清楚。",
    "下图是原书中的插图文件，从 EPUB 内部的相对路径读取。它展示从阅读到回访的工作流程，属于方法示意，不表达经过统计验证的研究结论。",
    "电子书里的图片、标题与图注各自承担着不同的任务。图片让关系可见，图注解释关系的含义，正文则说明它为何值得讨论。重新排版时保留三者之间的位置，有助于读者同时理解图与文。",
    "阅读的速度不必固定。有些地方值得快速浏览，有些地方则需要来回辨认。把注意力留给真正的问题，让工具帮助定位，让页面保持安静。",
  ],
  [
    "一个问题可以成为两段文字之间的桥梁。我们读到一个新的概念时，往往会想到此前遇到过的例子。但相似并不等于相同，建立联系的下一步，是说明这种联系究竟发生在哪个层面。",
    "可以把笔记分成三个部分：原文位置、当时的问题、暂时的理解。位置保证能够回访，问题保留思考的动机，理解则允许我们日后检查自己的判断是否发生了变化。",
    "建立知识网络并不是给每一句话加上连线。真正有用的联系应当可以解释：这个概念是另一个概念的条件、例子、对比，还是尚待核实的猜想？",
    "面对没有解决的问题，可以诚实地留下问号。下一次阅读时，问号会告诉我们为什么需要回来，也会提醒我们避免把联想当作结论。",
  ],
  [
    "理解最终需要在使用中重新检验。向别人解释一个观点，尝试写一段清楚的概括，或者把书中的方法应用到一个具体问题，都会让原先模糊的地方变得可见。",
    "如果一句话只能借助许多术语才能成立，也许我们还没有真正区分术语之间的关系。此时回到原文，往往比继续增加摘录更有帮助。",
    "持续阅读不是积累一个永远增长的清单，而是在生活与文字之间形成能够往返的路径。今天的问题可以引向明天的书，明天的经验也可以使今天的段落获得新的含义。",
    "这本示例到此结束。你可以切换阅读主题，搜索“知识”，尝试放大原书插图，或者将当前章节打印为 PDF。重新打开页面，书架与章节位置会保存在本地浏览器中。",
  ],
];
zip.file(
  "EPUB/nav.xhtml",
  `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol>${titles.map((title, i) => `<li><a href="text/chapter-${i + 1}.xhtml">${title}</a></li>`).join("")}</ol></nav></body></html>`,
);
for (let index = 0; index < titles.length; index++) {
  zip.file(
    `EPUB/text/chapter-${index + 1}.xhtml`,
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${titles[index]}</title></head><body><section><h1 id="begin">${titles[index]}</h1>${text[index].map((p, i) => `<p>${p}</p>${index === 0 && i === 2 ? '<figure><img src="../images/reading.svg" alt="阅读、提问、标注、回访的流程示意"/><figcaption>图 1 · 从阅读到回访的工作流程（示意图，非实验结果）。</figcaption></figure>' : ""}`).join("")}${index === 0 ? '<p><a href="chapter-2.xhtml#begin">继续查看：用问题连接知识 →</a></p>' : index === 1 ? '<p><a href="chapter-1.xhtml#begin">← 回到第一章的开头</a></p>' : ""}</section></body></html>`,
  );
}
zip.file(
  "EPUB/images/reading.svg",
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 220"><rect width="680" height="220" fill="#f6f5ec"/><g fill="none" stroke="#748963" stroke-width="1.3"><path d="M145 110H225M315 110H395M485 110H550"/><path d="m216 106 9 4-9 4m170-8 9 4-9 4m146-8 9 4-9 4"/><rect x="55" y="83" width="90" height="54" rx="3"/><rect x="225" y="83" width="90" height="54" rx="3"/><rect x="395" y="83" width="90" height="54" rx="3"/><rect x="550" y="83" width="90" height="54" rx="3"/><path d="M595 143V177H100V143" stroke-dasharray="4 5"/></g><g font-family="sans-serif" font-size="16" fill="#4b6240" text-anchor="middle"><text x="100" y="116">阅读</text><text x="270" y="116">提问</text><text x="440" y="116">标注</text><text x="595" y="116">回访</text><text x="340" y="45" font-size="10" letter-spacing="3">A READING PROCESS · SCHEMATIC</text><text x="340" y="205" font-size="10">在文字与问题之间，建立可以往返的路径</text></g></svg>',
);
await mkdir("public/samples", { recursive: true });
await writeFile(
  "public/samples/paperleaf-sample.epub",
  await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
);
console.log("Created public/samples/paperleaf-sample.epub");
