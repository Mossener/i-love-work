import { useEffect, useRef, useState } from "react";
import { BookmarkPlus, Download, Highlighter, Pencil, Trash2, Upload } from "lucide-react";
import type { ReaderMark, ReaderMarkColor } from "../lib/reader-marks";
import "../reader-marks.css";

export interface ReaderMarksPanelProps {
  marks: ReaderMark[];
  chapterNames: string[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onJump: (mark: ReaderMark) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: { note: string; color: ReaderMarkColor }) => void;
  onAddBookmark: () => void;
  onAddSelection: () => void;
  onExport: (format: "markdown" | "json") => void;
  onImport?: (file: File) => void;
  disabled?: boolean;
}

const COLORS: { value: ReaderMarkColor; label: string }[] = [
  { value: "yellow", label: "黄色" },
  { value: "green", label: "绿色" },
  { value: "blue", label: "蓝色" },
  { value: "pink", label: "粉色" },
];

export function ReaderMarksPanel({
  marks, chapterNames, selectedId, onSelect, onJump, onRemove, onUpdate,
  onAddBookmark, onAddSelection, onExport, onImport, disabled = false,
}: ReaderMarksPanelProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "bookmark" | "highlight">("all");
  const [note, setNote] = useState("");
  const [color, setColor] = useState<ReaderMarkColor>("yellow");
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = marks.find(mark => mark.id === selectedId);
  useEffect(() => {
    setNote(selected?.note ?? "");
    setColor(selected?.color ?? "yellow");
  }, [selected?.id, selected?.note, selected?.color]);
  const term = query.trim().toLocaleLowerCase();
  const shown = [...marks].filter(mark =>
    (filter === "all" || mark.kind === filter) && (!term ||
      `${mark.quote}\n${mark.note}\n${chapterNames[mark.chapterIndex] ?? ""}`.toLocaleLowerCase().includes(term)),
  ).sort((a, b) => b.createdAt - a.createdAt);

  return (
    <section className="reader-marks-panel" aria-label="书签与批注">
      <div className="reader-mark-actions">
        <button type="button" disabled={disabled} onClick={onAddBookmark}>
          <BookmarkPlus size={15} />添加书签
        </button>
        <button type="button" disabled={disabled} title="先选中正文，再添加划线"
          onMouseDown={event => event.preventDefault()} onClick={onAddSelection}>
          <Highlighter size={15} />划线选文
        </button>
      </div>
      <p className="reader-marks-help">书签记录当前位置；选中正文可划线并添加批注。</p>
      <input className="reader-mark-search" type="search" aria-label="查找书签与批注"
        placeholder="查找引用或批注" value={query} onChange={event => setQuery(event.target.value)} />
      <div className="reader-mark-filters" aria-label="批注类型">
        {([
          ["all", "全部"], ["bookmark", "书签"], ["highlight", "划线"],
        ] as const).map(([value, label]) => (
          <button type="button" key={value} aria-pressed={filter === value}
            className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{label}</button>
        ))}
        <small>{shown.length} 条</small>
      </div>
      <div className="reader-mark-list">
        {!shown.length && <p className="reader-marks-empty">{marks.length ? "没有匹配的书签或批注。" : "本书还没有书签或批注。"}</p>}
        {shown.map(mark => (
          <article key={mark.id} className={`reader-mark-card ${selectedId === mark.id ? "selected" : ""}`}>
            <button className="reader-mark-jump" type="button" disabled={disabled}
              onClick={() => { onSelect?.(mark.id); onJump(mark); }}>
              <strong>{mark.kind === "bookmark" ? "书签" : "划线"} · {chapterNames[mark.chapterIndex] || `第 ${mark.chapterIndex + 1} 章`}</strong>
              <span>{mark.quote || "返回保存的阅读位置"}</span>
              {mark.note && <em>{mark.note}</em>}
            </button>
            <footer>
              <time dateTime={new Date(mark.createdAt).toISOString()}>{new Date(mark.createdAt).toLocaleDateString("zh-CN")}</time>
              <button type="button" className="pdf-tool" aria-label="编辑批注" title="编辑批注"
                onClick={() => onSelect?.(mark.id)}><Pencil size={13} /></button>
              <button type="button" className="pdf-tool" aria-label="删除批注" title="删除批注"
                onClick={() => onRemove(mark.id)}><Trash2 size={13} /></button>
            </footer>
          </article>
        ))}
      </div>
      {selected && (
        <form className="reader-mark-editor" aria-label="编辑所选批注" onSubmit={event => {
          event.preventDefault();
          onUpdate(selected.id, { note, color });
        }}>
          <label htmlFor="reader-note-input">批注内容</label>
          <textarea id="reader-note-input" value={note} maxLength={4000} rows={4}
            placeholder="记录你的想法…" onChange={event => setNote(event.target.value)} />
          {selected.kind === "highlight" && <fieldset className="reader-mark-colors">
            <legend>划线颜色</legend>
            {COLORS.map(option => <label key={option.value} className={`reader-color-${option.value}`}>
              <input type="radio" name="reader-highlight-color" value={option.value}
                checked={color === option.value} onChange={() => setColor(option.value)} />{option.label}
            </label>)}
          </fieldset>}
          <div className="reader-mark-edit-actions">
            <button type="button" onClick={() => onSelect?.(null)}>收起</button>
            <button type="submit">保存批注</button>
          </div>
        </form>
      )}
      <div className="reader-mark-backup">
        <button type="button" disabled={!marks.length} onClick={() => onExport("markdown")}><Download size={13} />导出笔记</button>
        <button type="button" disabled={!marks.length} onClick={() => onExport("json")}>备份 JSON</button>
        {onImport && <button type="button" onClick={() => fileRef.current?.click()}><Upload size={13} />导入备份</button>}
        <input type="file" ref={fileRef} className="sr-only" accept=".json,application/json" aria-label="导入书签批注备份"
          onChange={event => { const file = event.target.files?.[0]; if (file) onImport?.(file); event.target.value = ""; }} />
      </div>
    </section>
  );
}
