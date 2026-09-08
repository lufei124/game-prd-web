import { useEffect, useState } from "react";
// UI scratch space only. Confirmed versions and workflow remain server-owned.
const drafts = new Map<
  string,
  { content: string; saved: string; base: string }
>();
export function useArtifactDraft(version: any) {
  const key = `${version.requirementId}:${version.kind}`;
  const [draft, setDraft] = useState(
    () =>
      drafts.get(key) || {
        content: version.content,
        saved: version.content,
        base: version.id,
      },
  );
  useEffect(() => {
    setDraft((current) => {
      if (current.base === version.id) return current;
      if (
        current.content === current.saved ||
        current.content === version.content
      ) {
        const next = {
          content: version.content,
          saved: version.content,
          base: version.id,
        };
        drafts.set(key, next);
        return next;
      }
      return current;
    });
  }, [version.id]);
  const setContent = (content: string) =>
    setDraft((current) => {
      const next = { ...current, content };
      drafts.set(key, next);
      return next;
    });
  const acceptLatest = () => {
    const next = {
      content: version.content,
      saved: version.content,
      base: version.id,
    };
    drafts.set(key, next);
    setDraft(next);
  };
  return {
    content: draft.content,
    setContent,
    dirty: draft.content !== version.content,
    conflict: draft.base !== version.id,
    acceptLatest,
  };
}
