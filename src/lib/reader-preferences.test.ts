import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_READER_PREFERENCES,
  normalizeReaderPreferences,
  readReaderPreferences,
  typographyStyle,
  writeReaderPreferences,
} from "./reader-preferences";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("reader preferences", () => {
  it("uses the existing paper typography as the initial preference", () => {
    expect(readReaderPreferences()).toEqual({
      fontSize: 16,
      lineHeight: 1.32,
      fontFamily: "serif",
      theme: "paper",
    });
  });

  it("preserves supported preferences across a new read", () => {
    const preferences = { fontSize: 20, lineHeight: 1.8, fontFamily: "kai", theme: "sepia" } as const;
    expect(writeReaderPreferences(preferences)).toBe(true);
    expect(readReaderPreferences()).toEqual(preferences);
  });

  it("recovers malformed storage and ignores invalid values without dropping valid fields", () => {
    localStorage.setItem("paper-pdf-reader-preferences", "{broken");
    expect(readReaderPreferences()).toEqual(DEFAULT_READER_PREFERENCES);
    localStorage.setItem("paper-pdf-reader-preferences", JSON.stringify({
      fontSize: "24",
      lineHeight: 1.65,
      fontFamily: "url(https://example.org/font)",
      theme: "dark",
    }));
    expect(readReaderPreferences()).toEqual({ ...DEFAULT_READER_PREFERENCES, lineHeight: 1.65, theme: "dark" });
    expect(normalizeReaderPreferences([])).toEqual(DEFAULT_READER_PREFERENCES);
    expect(normalizeReaderPreferences(null)).toEqual(DEFAULT_READER_PREFERENCES);
  });

  it("bounds typography to safe readable sizes and rejects non-finite numbers", () => {
    expect(normalizeReaderPreferences({ fontSize: 100, lineHeight: 0.1 })).toEqual({
      ...DEFAULT_READER_PREFERENCES, fontSize: 24, lineHeight: 1.2,
    });
    expect(normalizeReaderPreferences({ fontSize: 1, lineHeight: 100 })).toEqual({
      ...DEFAULT_READER_PREFERENCES, fontSize: 14, lineHeight: 2.2,
    });
    expect(normalizeReaderPreferences({ fontSize: NaN, lineHeight: Infinity })).toEqual(DEFAULT_READER_PREFERENCES);
  });

  it("keeps reading available when browser storage refuses access", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
    expect(readReaderPreferences()).toEqual(DEFAULT_READER_PREFERENCES);
    expect(writeReaderPreferences(DEFAULT_READER_PREFERENCES)).toBe(false);
  });

  it("uses matching finite typography for measurement and the rendered page without theme styles", () => {
    const style = typographyStyle({ fontSize: 19, lineHeight: 1.75, fontFamily: "sans" });
    expect(style.fontSize).toBe("19px");
    expect(style.lineHeight).toBe("1.75");
    expect(style.fontFamily).toContain("sans-serif");
    expect(style).not.toHaveProperty("background");
    expect(style).not.toHaveProperty("color");
  });
});
