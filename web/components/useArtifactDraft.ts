import { useEffect, useRef, useState } from "react";
// Browser recovery only: never writes a formal version or changes confirmation state.
type Draft = { content: string; saved: string; base: string; number: number };
const drafts = new Map<string, Draft>();
const prefix = "forge:artifact-draft:v1:";
export function useArtifactDraft(version: any) {
  const key = `${version.requirementId}:${version.kind}`;
  const storageKey = (base: string) => prefix + key + ":" + base;
  const fresh = (): Draft => ({
    content: version.content,
    saved: version.content,
    base: version.id,
    number: version.number,
  });
  const [draft, setDraft] = useState(() => drafts.get(key) || fresh());
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<Draft[]>(() => {
    if (drafts.has(key)) return [];
    try {
      return Object.keys(localStorage)
        .filter((k) => k.startsWith(prefix + key + ":"))
        .flatMap((k) => {
          try {
            const d = JSON.parse(localStorage.getItem(k)!);
            return typeof d.content === "string" &&
              typeof d.saved === "string" &&
              typeof d.base === "string" &&
              typeof d.number === "number" &&
              k === storageKey(d.base) &&
              d.content !== d.saved
              ? [d]
              : [];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  });
  const current = useRef(draft);
  current.current = draft;
  const remove = (base: string) => {
    try {
      localStorage.removeItem(storageKey(base));
    } catch {
      setError("无法清除本地草稿，请检查浏览器存储权限。");
    }
  };
  useEffect(() => {
    setDraft((d) => {
      if (d.base === version.id) return d;
      if (d.content === d.saved || d.content === version.content) {
        remove(d.base);
        const next = fresh();
        drafts.set(key, next);
        return next;
      }
      return d;
    });
  }, [version.id]);
  const persist = () => {
    const d = current.current;
    if (d.content === d.saved) return;
    try {
      localStorage.setItem(storageKey(d.base), JSON.stringify(d));
      setError("");
    } catch {
      setError("本地草稿备份失败，请及时保存修改或复制内容。");
    }
  };
  useEffect(() => {
    const timer = window.setTimeout(persist, 700);
    return () => clearTimeout(timer);
  }, [draft, key]);
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === "hidden") persist();
    };
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", hide);
    return () => {
      persist();
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [key]);
  const setContent = (content: string) => {
    const next = { ...current.current, content };
    current.current = next;
    drafts.set(key, next);
    setDraft(next);
    if (content === next.saved) remove(next.base);
  };
  const acceptLatest = () => {
    remove(draft.base);
    const next = fresh();
    current.current = next;
    drafts.set(key, next);
    setDraft(next);
  };
  const discardRecovery = (base: string) => {
    remove(base);
    setRecovery((items) => items.filter((d) => d.base !== base));
  };
  const restoreRecovery = (d: Draft) => {
    if (d.base !== version.id || draft.content !== draft.saved) return;
    current.current = d;
    drafts.set(key, d);
    setDraft(d);
    setRecovery((items) => items.filter((item) => item.base !== d.base));
  };
  return {
    content: draft.content,
    setContent,
    dirty: draft.content !== version.content,
    conflict: draft.base !== version.id,
    acceptLatest,
    recovery,
    discardRecovery,
    restoreRecovery,
    error,
  };
}
