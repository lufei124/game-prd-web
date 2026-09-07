import React, { useState } from "react";
export function MentionInput({
  value,
  onChange,
  items,
  onSelect,
  placeholder,
  onSubmit,
  submitDisabled,
}: {
  value: string;
  onChange: (s: string) => void;
  items: any[];
  onSelect: (id: string) => void;
  placeholder: string;
  onSubmit: () => void;
  submitDisabled: boolean;
}) {
  const [match, setMatch] = useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  const matches = match
    ? items
        .filter((k) => k.name.toLowerCase().includes(match.query.toLowerCase()))
        .slice(0, 10)
    : [];
  const select = (k: any) => {
    if (!match) return;
    onChange(
      value.slice(0, match.start) + "@" + k.name + " " + value.slice(match.end),
    );
    onSelect(k.id);
    setMatch(null);
  };
  return (
    <>
      <textarea
        aria-label="给产品助手的任务"
        value={value}
        placeholder={placeholder + " 输入 @ 引用资料"}
        onChange={(e) => {
          onChange(e.target.value);
          const caret = e.target.selectionStart;
          const m = e.target.value.slice(0, caret).match(/@([^@\s]*)$/);
          setMatch(
            m ? { start: caret - m[0].length, end: caret, query: m[1] } : null,
          );
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setMatch(null);
          if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
          if (e.key !== "Enter" || e.shiftKey) return;
          e.preventDefault();
          if (match && matches.length) {
            e.preventDefault();
            select(matches[0]);
            return;
          }
          if (!submitDisabled && value.trim()) onSubmit();
        }}
        onBlur={() => setTimeout(() => setMatch(null), 100)}
      />
      {match && (
        <div className="mention-menu" role="listbox" aria-label="引用知识资料">
          {matches.map((k) => (
            <button
              key={k.id}
              role="option"
              aria-selected="false"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(k)}
            >
              <b>{k.name}</b>
              <small>{k.path || "/"}</small>
            </button>
          ))}
          {!matches.length && <p>没有匹配的资料，请先添加到知识库。</p>}
        </div>
      )}
    </>
  );
}
