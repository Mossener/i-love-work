import type { CoverSource } from "./cover-document";

export type { CoverSource } from "./cover-document";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (cause?: unknown) => {
      if (settled) return;
      settled = true;
      reject(
        new Error("无法访问遮挡文档存储，请检查浏览器存储权限。", { cause }),
      );
    };
    try {
      if (!globalThis.indexedDB) {
        fail();
        return;
      }
      const request = indexedDB.open("paperleaf-cover", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("selected"))
          request.result.createObjectStore("selected");
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail();
      request.onsuccess = () => {
        const db = request.result;
        if (settled) {
          db.close();
          return;
        }
        settled = true;
        db.onversionchange = () => db.close();
        resolve(db);
      };
    } catch (error) {
      fail(error);
    }
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let result: T;
    let settled = false;
    const fail = (cause?: unknown) => {
      if (settled) return;
      settled = true;
      db.close();
      reject(
        new Error("遮挡文档存储失败，当前文件仍可在本次阅读中使用。", {
          cause,
        }),
      );
    };
    try {
      const transaction = db.transaction("selected", mode);
      transaction.onabort = () => fail(transaction.error);
      transaction.onerror = () => fail(transaction.error);
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        db.close();
        resolve(result);
      };
      const request = action(transaction.objectStore("selected"));
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => fail(request.error);
    } catch (error) {
      fail(error);
    }
  });
}

export async function saveCoverSource(source: CoverSource): Promise<void> {
  await withStore("readwrite", (store) =>
    store.put({ name: source.name, blob: source.blob }, "cover"),
  );
}

export async function loadCoverSource(): Promise<CoverSource | null> {
  const value = await withStore<unknown>("readonly", (store) =>
    store.get("cover"),
  );
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CoverSource>;
  if (
    typeof candidate.name !== "string" ||
    !candidate.name ||
    !candidate.blob ||
    typeof candidate.blob.size !== "number" ||
    typeof candidate.blob.slice !== "function"
  )
    return null;
  return { name: candidate.name, blob: candidate.blob };
}

export async function clearCoverSource(): Promise<void> {
  await withStore("readwrite", (store) => store.delete("cover"));
}
