import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadingSettings, SavedBook } from "../types";
import {
  listBooks,
  readSettings,
  removeBook,
  saveBook,
  savePosition,
  writeSettings,
} from "./storage";

const defaults: ReadingSettings = {
  fontSize: 17,
  columns: 1,
  theme: "paper",
  showFigures: true,
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("reading settings", () => {
  it("uses defaults before a reader has saved preferences", () => {
    expect(readSettings()).toEqual(defaults);
  });

  it("persists every reader preference across reads", () => {
    writeSettings({
      fontSize: 21,
      columns: 2,
      theme: "dark",
      showFigures: false,
    });
    expect(readSettings()).toEqual({
      fontSize: 21,
      columns: 2,
      theme: "dark",
      showFigures: false,
    });
  });

  it.each(["{bad json", "null", "[]", "17", '"dark"'])(
    "recovers from malformed stored settings: %s",
    (stored) => {
      localStorage.setItem("paperleaf-settings", stored);
      expect(readSettings()).toEqual(defaults);
    },
  );

  it("keeps valid preferences while replacing invalid fields", () => {
    localStorage.setItem(
      "paperleaf-settings",
      JSON.stringify({
        fontSize: "21",
        columns: 3,
        theme: "sepia",
        showFigures: "false",
      }),
    );
    expect(readSettings()).toEqual({
      fontSize: 17,
      columns: 1,
      theme: "sepia",
      showFigures: true,
    });
  });

  it.each([
    { input: 2, expected: 14 },
    { input: 99, expected: 24 },
  ])("clamps stored font size $input to $expected", ({ input, expected }) => {
    localStorage.setItem(
      "paperleaf-settings",
      JSON.stringify({ ...defaults, fontSize: input }),
    );
    expect(readSettings().fontSize).toBe(expected);
  });

  it("normalizes invalid values before saving settings", () => {
    writeSettings({
      fontSize: Infinity,
      columns: 9,
      theme: "invalid",
      showFigures: null,
    } as unknown as ReadingSettings);
    expect(readSettings()).toEqual(defaults);
  });

  it("falls back to defaults when browser storage access is denied", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Denied", "SecurityError");
    });
    expect(readSettings()).toEqual(defaults);
  });

  it("keeps reading available when browser storage is full", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    expect(() => writeSettings({ ...defaults, theme: "sepia" })).not.toThrow();
  });
});

describe("unavailable book storage", () => {
  const book: SavedBook = {
    id: "one",
    title: "测试书籍",
    author: "作者",
    file: new Blob(["book"]),
    addedAt: 1,
    chapterIndex: 0,
  };

  it.each([
    { name: "list", run: () => listBooks() },
    { name: "save", run: () => saveBook(book) },
    { name: "remove", run: () => removeBook("one") },
    { name: "position", run: () => savePosition("one", 2) },
  ])(
    "rejects $name with a readable error instead of silently losing data",
    async ({ run }) => {
      vi.stubGlobal("indexedDB", undefined);
      await expect(run()).rejects.toThrow(/本地图书库/);
    },
  );
});
