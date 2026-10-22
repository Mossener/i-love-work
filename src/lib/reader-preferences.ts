export type ReaderFontFamily = "serif" | "sans" | "kai";
export type ReaderTheme = "paper" | "sepia" | "dark";

export interface ReaderTypography {
  fontSize: number;
  lineHeight: number;
  fontFamily: ReaderFontFamily;
}

export interface ReaderPreferences extends ReaderTypography {
  theme: ReaderTheme;
}

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  fontSize: 16,
  lineHeight: 1.32,
  fontFamily: "serif",
  theme: "paper",
};

const STORAGE_KEY = "paper-pdf-reader-preferences";
const FONT_FAMILIES: Record<ReaderFontFamily, string> = {
  serif: '"Times New Roman", Times, "Noto Serif CJK SC", "Songti SC", SimSun, serif',
  sans: 'Arial, "Microsoft YaHei", "Noto Sans CJK SC", "PingFang SC", sans-serif',
  kai: 'KaiTi, STKaiti, "Kaiti SC", "Noto Serif CJK SC", serif',
};

export function normalizeReaderPreferences(value: unknown): ReaderPreferences {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const fontSize = input.fontSize;
  const lineHeight = input.lineHeight;
  return {
    fontSize: typeof fontSize === "number" && Number.isFinite(fontSize)
      ? Math.max(14, Math.min(24, Math.round(fontSize)))
      : DEFAULT_READER_PREFERENCES.fontSize,
    lineHeight: typeof lineHeight === "number" && Number.isFinite(lineHeight)
      ? Math.round(Math.max(1.2, Math.min(2.2, lineHeight)) * 100) / 100
      : DEFAULT_READER_PREFERENCES.lineHeight,
    fontFamily: input.fontFamily === "sans" || input.fontFamily === "kai" ? input.fontFamily : "serif",
    theme: input.theme === "sepia" || input.theme === "dark" ? input.theme : "paper",
  };
}

export function readReaderPreferences(): ReaderPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeReaderPreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_READER_PREFERENCES };
  }
}

/** False means the preference remains usable in memory for this session. */
export function writeReaderPreferences(value: ReaderPreferences): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeReaderPreferences(value)));
    return true;
  } catch {
    return false;
  }
}

/** Apply this same typography to both the measuring box and visible book pages. */
export function typographyStyle(value: ReaderTypography) {
  const normalized = normalizeReaderPreferences(value);
  return {
    fontSize: `${normalized.fontSize}px`,
    lineHeight: String(normalized.lineHeight),
    fontFamily: FONT_FAMILIES[normalized.fontFamily],
  };
}
