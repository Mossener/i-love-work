import type { ReadingSettings, SavedBook } from "../types";

const SETTINGS_KEY = "paperleaf-settings";
const DEFAULT_SETTINGS: ReadingSettings = {
  fontSize: 17,
  columns: 1,
  theme: "paper",
  showFigures: true,
};

function normalizeSettings(value: unknown): ReadingSettings {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    fontSize:
      typeof input.fontSize === "number" && Number.isFinite(input.fontSize)
        ? Math.min(24, Math.max(14, input.fontSize))
        : DEFAULT_SETTINGS.fontSize,
    columns: input.columns === 2 ? 2 : 1,
    theme:
      input.theme === "sepia" || input.theme === "dark" ? input.theme : "paper",
    showFigures:
      typeof input.showFigures === "boolean" ? input.showFigures : true,
  };
}

export function readSettings(): ReadingSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    return normalizeSettings(stored === null ? null : JSON.parse(stored));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(settings: ReadingSettings): void {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify(normalizeSettings(settings)),
    );
  } catch {
    // Preferences still work for this session if browser storage is unavailable.
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (message: string, cause?: unknown) => {
      if (settled) return;
      settled = true;
      reject(new Error(message, { cause }));
    };
    try {
      if (!globalThis.indexedDB) {
        fail("此浏览器无法使用本地图书库，请检查隐私或存储设置。");
        return;
      }
      const request = indexedDB.open("paperleaf", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("books")) {
          request.result.createObjectStore("books", { keyPath: "id" });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) {
          database.close();
          return;
        }
        settled = true;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () =>
        fail("无法打开本地图书库，请检查浏览器存储权限。", request.error);
      request.onblocked = () =>
        fail("本地图书库正在被其他页面使用，请关闭其他阅读页面后重试。");
    } catch (error) {
      fail("无法打开本地图书库，请检查浏览器存储权限。", error);
    }
  });
}

async function withBooks<T>(
  mode: IDBTransactionMode,
  errorMessage: string,
  action: (store: IDBObjectStore, setResult: (result: T) => void) => void,
): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let result: T;
    let transaction: IDBTransaction | undefined;
    let settled = false;
    const fail = (cause?: unknown) => {
      if (settled) return;
      settled = true;
      database.close();
      reject(new Error(errorMessage, { cause }));
    };
    try {
      transaction = database.transaction("books", mode);
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        database.close();
        resolve(result);
      };
      transaction.onerror = () => fail(transaction?.error);
      transaction.onabort = () => fail(transaction?.error);
      action(transaction.objectStore("books"), (value) => {
        result = value;
      });
    } catch (error) {
      try {
        transaction?.abort();
      } catch {
        /* Already completed or aborted. */
      }
      fail(error);
    }
  });
}

export async function saveBook(book: SavedBook): Promise<void> {
  await withBooks<void>(
    "readwrite",
    "图书保存失败，存储空间可能不足，请清理空间后重试。",
    (store) => {
      store.put(book);
    },
  );
}

export async function listBooks(): Promise<SavedBook[]> {
  return withBooks<SavedBook[]>(
    "readonly",
    "无法读取本地图书库，请稍后重试。",
    (store, setResult) => {
      const request = store.getAll();
      request.onsuccess = () =>
        setResult(
          (request.result as SavedBook[]).sort((a, b) => b.addedAt - a.addedAt),
        );
    },
  );
}

export async function removeBook(id: string): Promise<void> {
  await withBooks<void>("readwrite", "图书删除失败，请稍后重试。", (store) => {
    store.delete(id);
  });
}

export async function savePosition(
  id: string,
  chapterIndex: number,
): Promise<void> {
  if (!Number.isInteger(chapterIndex) || chapterIndex < 0) {
    throw new Error("阅读进度无效，请重新打开图书。");
  }
  await withBooks<void>(
    "readwrite",
    "阅读进度保存失败，请检查浏览器存储空间。",
    (store) => {
      const request = store.get(id);
      request.onsuccess = () => {
        const book = request.result as SavedBook | undefined;
        if (book) store.put({ ...book, chapterIndex });
      };
    },
  );
}
