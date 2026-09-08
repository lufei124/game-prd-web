import React, { useEffect, useRef, useState } from "react";
export function CommandMenu({ items, onClose }: any) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const filtered = items.filter((i: any) =>
    i.label.toLowerCase().includes(query.toLowerCase()),
  );
  useEffect(() => {
    const el = dialog.current;
    const previous = document.activeElement as HTMLElement;
    el?.showModal();
    return () => {
      el?.close();
      previous?.focus();
    };
  }, []);
  const choose = (item: any) => {
    onClose();
    item.action();
  };
  return (
    <dialog
      ref={dialog}
      className="command-dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setIndex((i) => Math.min(i + 1, filtered.length - 1));
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setIndex((i) => Math.max(0, i - 1));
        }
        if (e.key === "Enter" && filtered[index]) {
          e.preventDefault();
          choose(filtered[index]);
        }
      }}
    >
      <input
        autoFocus
        aria-label="搜索命令或需求"
        placeholder="搜索需求、跳转页面…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
      />
      <div className="command-results">
        {filtered.map((item: any, i: number) => (
          <button
            key={item.id}
            className={index === i ? "active" : ""}
            onClick={() => choose(item)}
          >
            <span>{item.label}</span>
            <small>{item.hint}</small>
          </button>
        ))}
        {!filtered.length && <p>没有匹配的需求或命令</p>}
      </div>
      <footer>
        ↑ ↓ 选择 · Enter 打开{" "}
        <button className="ghost" onClick={onClose}>
          Esc 关闭
        </button>
      </footer>
    </dialog>
  );
}
