import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export function LinkDocumentDialog({
  onClose,
  onLink,
}: {
  onClose: () => void;
  onLink: (location: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="resource-dialog"
      aria-label="关联飞书文档"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!location.trim() || busy) return;
          setBusy(true);
          setError("");
          try {
            await onLink(location.trim());
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <header>
          <h2>关联飞书文档</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭关联飞书文档"
            disabled={busy}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="resource-dialog-body">
          <p>粘贴飞书文档链接或文档 ID，关联后同步到当前项目知识库。</p>
          <label>
            飞书文档链接或文档 ID
            <input
              autoFocus
              required
              value={location}
              disabled={busy}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="https://…feishu.cn/docx/…"
            />
          </label>
          {error && <p role="alert">{error}</p>}
        </div>
        <footer>
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="primary"
            type="submit"
            disabled={busy || !location.trim()}
          >
            {busy ? "正在关联…" : "关联文档"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
