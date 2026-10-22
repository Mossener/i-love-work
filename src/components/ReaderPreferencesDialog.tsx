import { useState } from "react";
import { X } from "lucide-react";
import {
  DEFAULT_READER_PREFERENCES,
  normalizeReaderPreferences,
  typographyStyle,
  type ReaderFontFamily,
  type ReaderPreferences,
  type ReaderTheme,
} from "../lib/reader-preferences";
import "../reader-preferences.css";

interface ReaderPreferencesDialogProps {
  value: ReaderPreferences;
  onApply: (value: ReaderPreferences) => void;
  onClose: () => void;
}

export function ReaderPreferencesDialog({ value, onApply, onClose }: ReaderPreferencesDialogProps) {
  const [draft, setDraft] = useState(() => normalizeReaderPreferences(value));
  return (
    <div className="pdf-modal-backdrop" onClick={onClose}>
      <section
        className="pdf-properties reader-preferences"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reader-preferences-title"
        onClick={event => event.stopPropagation()}
      >
        <header>
          <h2 id="reader-preferences-title">阅读设置</h2>
          <button className="pdf-tool" type="button" aria-label="关闭阅读设置" onClick={onClose}><X size={18} /></button>
        </header>
        <form onSubmit={event => { event.preventDefault(); onApply(normalizeReaderPreferences(draft)); }}>
          <p className="properties-description">调整书籍正文的显示方式。应用后会保留当前文字位置。</p>
          <label>
            <span>字号</span>
            <span className="reader-range-control">
              <input aria-label="字号" type="range" min="14" max="24" step="1" value={draft.fontSize} onChange={event => setDraft(previous => ({ ...previous, fontSize: Number(event.target.value) }))} />
              <output>{draft.fontSize}px</output>
            </span>
          </label>
          <label>
            <span>行距</span>
            <span className="reader-range-control">
              <input aria-label="行距" type="range" min="1.2" max="2.2" step="0.01" value={draft.lineHeight} onChange={event => setDraft(previous => ({ ...previous, lineHeight: Number(event.target.value) }))} />
              <output>{draft.lineHeight.toFixed(2)}</output>
            </span>
          </label>
          <label>
            <span>字体</span>
            <select aria-label="字体" value={draft.fontFamily} onChange={event => setDraft(previous => ({ ...previous, fontFamily: event.target.value as ReaderFontFamily }))}>
              <option value="serif">宋体 / 衬线</option>
              <option value="sans">黑体 / 无衬线</option>
              <option value="kai">楷体</option>
            </select>
          </label>
          <label>
            <span>页面配色</span>
            <select aria-label="页面配色" value={draft.theme} onChange={event => setDraft(previous => ({ ...previous, theme: event.target.value as ReaderTheme }))}>
              <option value="paper">纸白</option>
              <option value="sepia">暖纸</option>
              <option value="dark">夜间</option>
            </select>
          </label>
          <div className="reader-type-preview" data-preview-theme={draft.theme} style={typographyStyle(draft)} aria-label="正文样式预览">阅读让文字在心中连接。A chapter opens another world.</div>
          <div className="properties-actions">
            <button className="pdf-dialog-button reader-reset-preferences" type="button" onClick={() => setDraft({ ...DEFAULT_READER_PREFERENCES })}>恢复默认</button>
            <button className="pdf-dialog-button" type="button" onClick={onClose}>取消</button>
            <button className="pdf-dialog-button primary" type="submit">应用</button>
          </div>
        </form>
      </section>
    </div>
  );
}
