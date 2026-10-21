import { useCallback, useEffect, useRef, useState } from "react";
import { parseCoverFile, releaseCoverDocument, type CoverDocument } from "./cover-document";
import { clearCoverSource, loadCoverSource, saveCoverSource } from "./cover-storage";
import { paginateBlocks, type DocumentPage } from "./pagination";

export interface PreparedCover {
  document: CoverDocument;
  pages: DocumentPage[];
  source: { name: string; blob: Blob };
}

export function useCoverDocument(notify: (message: string) => void) {
  const [cover, setCover] = useState<PreparedCover | null>(null);
  const [loading, setLoading] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const userSelected = useRef(false);
  const pendingStorage = useRef<Promise<void>>(Promise.resolve());
  const persist = useCallback((write: () => Promise<void>) => {
    const next = pendingStorage.current.catch(() => {}).then(write);
    pendingStorage.current = next;
    return next;
  }, []);

  const prepare = useCallback(async (source: { name: string; blob: Blob }, shouldPersist: boolean) => {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setLoading(true);
    let parsed: CoverDocument | undefined;
    try {
      parsed = await parseCoverFile(source, controller.signal);
      const pages = parsed.kind === "docx" ? await paginateBlocks(parsed.blocks, { signal: controller.signal }) : [];
      if (controller.signal.aborted) return;
      setCover({ document: parsed, pages, source });
      parsed = undefined;
      if (shouldPersist) {
        try { await persist(() => saveCoverSource(source)); }
        catch { if (!controller.signal.aborted) notify("遮挡文档已载入，但浏览器无法保存。下次启动需重新选择。"); }
      }
    } catch (error) {
      if (!controller.signal.aborted) notify(error instanceof Error ? error.message : "无法打开遮挡文档。");
    } finally {
      if (parsed) void releaseCoverDocument(parsed);
      if (operation.current === controller) {
        operation.current = null;
        setLoading(false);
      }
    }
  }, [notify, persist]);

  useEffect(() => {
    let cancelled = false;
    loadCoverSource().then(source => {
      if (source && !cancelled && !operation.current && !userSelected.current) void prepare(source, false);
    }).catch(() => {});
    return () => { cancelled = true; operation.current?.abort(); };
  }, [prepare]);
  useEffect(() => () => { if (cover) void releaseCoverDocument(cover.document); }, [cover]);

  const importCover = useCallback((file: File) => { userSelected.current = true; return prepare({ name: file.name, blob: file }, true); }, [prepare]);
  const resetCover = useCallback(async () => {
    userSelected.current = true;
    operation.current?.abort();
    operation.current = null;
    setLoading(false);
    setCover(null);
    try { await persist(clearCoverSource); }
    catch { notify("已切换为内置论文，但浏览器无法保存此设置。"); }
  }, [notify, persist]);
  return { cover, loading, importCover, resetCover };
}
