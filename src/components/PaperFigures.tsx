import type { Book } from "../types";

const short = (value: string, max = 9) =>
  value.length > max ? value.slice(0, max) + "…" : value;

export function PaperFigure({
  book,
  chapterIndex,
}: {
  book: Book;
  chapterIndex: number;
}) {
  const chapters = book.chapters;
  const total = Math.max(book.wordCount, 1);
  const sampled =
    chapters.length > 16
      ? Array.from({ length: 16 }, (_, index) => {
          const start = Math.floor((index * chapters.length) / 16);
          const end = Math.floor(((index + 1) * chapters.length) / 16);
          return {
            start,
            end,
            value: chapters
              .slice(start, end)
              .reduce((sum, chapter) => sum + chapter.wordCount, 0),
          };
        })
      : chapters.map((chapter, index) => ({
          start: index,
          end: index + 1,
          value: chapter.wordCount,
        }));
  const peak = Math.max(...sampled.map((point) => point.value), 1);
  const barWidth = Math.min(45, 380 / sampled.length);
  const step = 390 / sampled.length;
  const current = chapters[chapterIndex];
  const previous = chapters
    .slice(0, chapterIndex)
    .reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const percent = Math.round((current.wordCount / total) * 100);

  return (
    <figure className="paper-figure supplemental-figure">
      <div className="figure-topline">
        <span>READING ANATOMY</span>
        <span>基于本书实际内容</span>
      </div>
      <svg
        viewBox="0 0 680 238"
        role="img"
        aria-label="本书各章节字数分布图，当前章节以绿色标出"
      >
        <text x="39" y="29" className="chart-panel-title">
          a. 章节篇幅分布
        </text>
        <text x="487" y="29" className="chart-panel-title">
          b. 当前章节占比
        </text>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line
              x1="42"
              y1={171 - t * 108}
              x2="438"
              y2={171 - t * 108}
              stroke="currentColor"
              strokeOpacity=".12"
              strokeDasharray={t ? "3 4" : undefined}
            />
            <text
              x="33"
              y={175 - t * 108}
              textAnchor="end"
              className="chart-tick"
            >
              {Math.round(peak * t).toLocaleString()}
            </text>
          </g>
        ))}
        {sampled.map((point, index) => (
          <g key={index}>
            <rect
              x={46 + index * step + (step - barWidth) / 2}
              y={171 - (point.value / peak) * 108}
              width={barWidth}
              height={Math.max((point.value / peak) * 108, 1)}
              rx="1"
              fill={
                chapterIndex >= point.start && chapterIndex < point.end
                  ? "#46684f"
                  : "#b8c4b1"
              }
            />
            <text
              x={46 + index * step + step / 2}
              y="191"
              textAnchor="middle"
              className="chart-tick"
            >
              {sampled.length > 10 && index % 2
                ? ""
                : String(point.start + 1).padStart(2, "0")}
            </text>
          </g>
        ))}
        <text x="240" y="218" textAnchor="middle" className="chart-axis">
          {chapters.length > 16 ? "章节（按顺序分为 16 组）" : "章节 Chapter"}
        </text>
        <line
          x1="461"
          y1="50"
          x2="461"
          y2="201"
          stroke="currentColor"
          strokeOpacity=".1"
        />
        <circle
          cx="563"
          cy="114"
          r="46"
          fill="none"
          stroke="#e1e4d9"
          strokeWidth="12"
        />
        <circle
          cx="563"
          cy="114"
          r="46"
          fill="none"
          stroke="#46684f"
          strokeWidth="12"
          strokeDasharray={`${(percent / 100) * 289} 289`}
          transform="rotate(-90 563 114)"
        />
        <text x="563" y="119" textAnchor="middle" className="chart-value">
          {percent}
          <tspan fontSize="13">%</tspan>
        </text>
        <text x="563" y="185" textAnchor="middle" className="chart-tick">
          第 {String(chapterIndex + 1).padStart(2, "0")} 章 ·{" "}
          {current.wordCount.toLocaleString()} 字 / 词
        </text>
        <rect x="503" y="207" width="7" height="7" fill="#46684f" />
        <text x="517" y="214" className="chart-tick">
          当前章节
        </text>
        <rect x="587" y="207" width="7" height="7" fill="#b8c4b1" />
        <text x="601" y="214" className="chart-tick">
          其他章节
        </text>
      </svg>
      <figcaption>
        <span className="figure-number">图 S{chapterIndex + 1}</span>{" "}
        本书章节篇幅与阅读位置。字数按中文字符及英文单词统计；当前章节占全文约{" "}
        {percent}%。
        <span className="figure-source">来源：本地 EPUB 解析 · 阅读辅助图</span>
      </figcaption>
      <div className="figure-data" aria-label="图表数据摘要">
        <span>
          {chapters.length}
          <small>章节</small>
        </span>
        <span>
          {book.wordCount.toLocaleString()}
          <small>字 / 词</small>
        </span>
        <span>
          {book.imageCount}
          <small>原书插图</small>
        </span>
        <span>
          {Math.round((previous / total) * 100)}%<small>本章起点</small>
        </span>
      </div>
    </figure>
  );
}

export function StructureFigure({
  book,
  chapterIndex,
}: {
  book: Book;
  chapterIndex: number;
}) {
  const chapters = book.chapters;
  const visible = [
    Math.max(0, chapterIndex - 1),
    chapterIndex,
    Math.min(chapters.length - 1, chapterIndex + 1),
  ].filter((value, index, values) => values.indexOf(value) === index);
  return (
    <figure className="paper-figure supplemental-figure structure-figure">
      <div className="figure-topline">
        <span>CONTENT STRUCTURE</span>
        <span>章节结构示意</span>
      </div>
      <svg viewBox="0 0 680 190" role="img" aria-label="本书相邻章节结构示意图">
        <defs>
          <marker
            id="structure-arrow"
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
          >
            <path d="M0 0L7 3.5L0 7" fill="none" stroke="#789078" />
          </marker>
        </defs>
        <text x="340" y="29" textAnchor="middle" className="chart-panel-title">
          {short(book.title, 28)}
        </text>
        <line x1="340" y1="40" x2="340" y2="65" stroke="#789078" />
        {visible.map((index, order) => {
          const x = 340 + (order - (visible.length - 1) / 2) * 209;
          return (
            <g key={index}>
              <path
                d={`M340 65 H${x} V83`}
                fill="none"
                stroke="#789078"
                markerEnd="url(#structure-arrow)"
              />
              <rect
                x={x - 92}
                y="89"
                width="184"
                height="61"
                rx="3"
                fill={index === chapterIndex ? "#e7ecdf" : "transparent"}
                stroke="#a4b29c"
              />
              <text x={x} y="111" textAnchor="middle" className="chart-tick">
                CHAPTER {String(index + 1).padStart(2, "0")}
              </text>
              <text x={x} y="134" textAnchor="middle" className="chart-node">
                {short(chapters[index].title, 11)}
              </text>
            </g>
          );
        })}
        <text x="340" y="177" textAnchor="middle" className="chart-tick">
          {visible.length === 1 ? "本书章节" : "按 EPUB 原始阅读顺序排列"} ·
          阴影为当前章节
        </text>
      </svg>
      <figcaption>
        <span className="figure-number">图 S{chapterIndex + 1}</span>{" "}
        章节结构与当前位置（示意图）。连线表示阅读顺序。
        <span className="figure-source">来源：原书目录 · 阅读辅助图</span>
      </figcaption>
    </figure>
  );
}
