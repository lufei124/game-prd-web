import React, { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      previous?.focus();
    };
  }, []);
  return ref;
}
export function DeleteResourceDialog({ target, onClose, onDelete }: any) {
  const ref = useModal();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const type = target.kind === "project" ? "项目" : "需求";
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await onDelete(target, name);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={ref}
      className="resource-dialog delete-dialog"
      aria-label={`${target.permanent ? "永久删除" : "删除"}${type}`}
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <header>
        <h2>
          {target.permanent ? "永久删除" : "删除"}
          {type}
        </h2>
        <button
          className="icon-button"
          aria-label="关闭删除确认"
          disabled={busy}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="resource-dialog-body">
        <p>
          {target.permanent
            ? `永久删除「${target.name}」及其关联内容，此操作不可恢复。`
            : `将「${target.name}」移入回收站，可恢复。`}
        </p>
        <p className="muted">
          {target.permanent
            ? "将清理关联历史、对话、成果和本机附件备份。"
            : target.kind === "project"
              ? "关联需求、知识、成果和历史一并移入回收站。"
              : "保留该需求的对话、成果、历史和专属附件以供恢复，其他需求及项目公共资料不受影响。"}
          不会删除本地资料源原文件或远端飞书文档。
        </p>
        <label>
          输入{type}名称确认
          <input
            autoFocus
            aria-label="输入名称确认删除"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            placeholder={target.name}
          />
        </label>
        {error && <p role="alert">{error}</p>}
      </div>
      <footer>
        <button className="ghost" disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className="primary"
          disabled={busy || name !== target.name}
          onClick={submit}
        >
          <Trash2 size={14} />
          {busy ? "正在处理…" : target.permanent ? "永久删除" : "移入回收站"}
        </button>
      </footer>
    </dialog>
  );
}
export function ResourceManager({
  mode,
  data,
  onClose,
  onDelete,
  onRestore,
}: any) {
  const ref = useModal();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const items =
    mode === "projects"
      ? data.projects.map((p: any) => ({ ...p, kind: "project" }))
      : [
          ...(data.projectTrash || []).map((p: any) => ({
            ...p,
            kind: "project",
          })),
          ...(data.requirementTrash || []).map((r: any) => ({
            ...r,
            kind: "requirement",
          })),
        ];
  const restore = async (item: any) => {
    setBusy(item.id);
    setError("");
    try {
      await onRestore(item);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <dialog
      ref={ref}
      className="resource-dialog"
      aria-label={mode === "projects" ? "管理项目" : "回收站"}
      onCancel={onClose}
    >
      <header>
        <h2>{mode === "projects" ? "管理项目" : "回收站"}</h2>
        <button
          className="icon-button"
          aria-label="关闭管理面板"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="resource-dialog-body">
        {error && <p role="alert">{error}</p>}
        {!items.length && <p className="muted">回收站为空</p>}
        {items.map((item: any) => (
          <div className="resource-row" key={`${item.kind}:${item.id}`}>
            <div>
              <b>{item.name}</b>
              <small>
                {item.kind === "project" ? "项目" : "需求"}
                {item.projectId
                  ? ` · ${data.projects.find((p: any) => p.id === item.projectId)?.name || "所属项目已删除"}`
                  : ""}
                {item.deletedAt
                  ? ` · ${new Date(item.deletedAt).toLocaleString()}`
                  : ""}
              </small>
            </div>
            {mode === "projects" ? (
              <button className="ghost" onClick={() => onDelete(item)}>
                删除项目
              </button>
            ) : (
              <>
                <button
                  className="ghost"
                  disabled={Boolean(busy) || item.purging}
                  onClick={() => restore(item)}
                >
                  {item.purging
                    ? "清理中"
                    : busy === item.id
                      ? "恢复中…"
                      : "恢复"}
                </button>
                <button
                  className="ghost"
                  disabled={Boolean(busy)}
                  onClick={() => onDelete({ ...item, permanent: true })}
                >
                  {item.purging ? "重试永久删除" : "永久删除"}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </dialog>
  );
}
