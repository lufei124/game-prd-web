import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { MarkdownDocument } from "./DocumentEditor";
export function KnowledgeDocument({ item, versions, onClose }: any) {
  const [id, setId] = useState(item.id);
  const dialog = useRef<HTMLDialogElement>(null);
  const [body, setBody] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setBody(null);
    setError("");
    api(`/knowledge/${id}/document`)
      .then((data) => {
        if (active) setBody(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  const current = versions.find((v: any) => v.id === id) || item;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="knowledge-drawer"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header>
        <div>
          <small>文档 · 只读来源</small>
          <h2>{item.name}</h2>
        </div>
        <button className="ghost" autoFocus onClick={onClose}>
          关闭
        </button>
      </header>
      <div className="knowledge-document-meta">
        <label>
          文档版本{" "}
          <select
            aria-label="知识文档版本"
            value={current.id}
            onChange={(e) => setId(e.target.value)}
          >
            {versions.map((v: any) => (
              <option value={v.id} key={v.id}>
                v{v.version} · {v.versionStatus === "current" ? "当前" : "历史"}{" "}
                · {new Date(v.createdAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </label>
        <p>{current.sourceUrl || current.externalId || current.source}</p>
        <span>
          revision {current.sourceRevision ?? "—"} · 同步{" "}
          {current.syncedAt || current.capturedAt || current.createdAt}
        </span>
        <details>
          <summary>来源元数据</summary>
          <pre>
            {JSON.stringify(
              {
                documentId: current.documentId,
                sourceId: current.sourceId,
                hash: current.hash,
                versionStatus: current.versionStatus,
                status: current.status,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </div>
      <div className="knowledge-document-body">
        {error ? (
          <p role="alert">{error}</p>
        ) : !body ? (
          <p role="status">正在读取文档…</p>
        ) : body.text ? (
          <MarkdownDocument content={body.text} />
        ) : (
          <p>
            此资料没有文本预览。
            {current.status === "image" ? "图片作为视觉参考传递给模型。" : ""}
          </p>
        )}
      </div>
    </dialog>
  );
}
