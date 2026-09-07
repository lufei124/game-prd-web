import React, { useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
export function ModelPicker({
  model,
  effort,
  executor,
  models,
  efforts,
  onChange,
}: {
  model: string;
  effort: string;
  executor: string;
  models: string[];
  efforts: { value: string; label: string }[];
  onChange: (model: string, effort: string) => void;
}) {
  const id = useId(),
    menu = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const [custom, setCustom] = useState("");
  const label = (value: string) =>
    value.replace(/^gpt-/, "").replace(/-/g, " ");
  function toggle() {
    const node = menu.current!;
    if (node.matches(":popover-open")) {
      node.hidePopover();
      return;
    }
    setCustom(model);
    node.showPopover();
    const anchor = trigger.current!.getBoundingClientRect();
    node.style.left = `${Math.max(12, Math.min(anchor.right - node.offsetWidth, innerWidth - node.offsetWidth - 12))}px`;
    node.style.top = `${Math.max(12, anchor.top - node.offsetHeight - 10)}px`;
  }
  return (
    <>
      <button
        ref={trigger}
        className="composer-model"
        aria-label="选择本次任务模型与思考深度"
        aria-haspopup="dialog"
        aria-controls={id}
        onClick={toggle}
      >
        <span>{label(model)}</span>
        <span className="composer-effort">
          {efforts.find((x) => x.value === effort)?.label.split(" · ")[0] ||
            effort}
        </span>
        <ChevronDown size={16} />
      </button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        role="dialog"
        aria-label="本次任务模型"
        className="model-popover"
      >
        <div className="model-menu-label">
          模型 · {executor === "codex" ? "Codex" : "Claude"}
        </div>
        {[
          ...new Set([
            model,
            ...models.filter((x) =>
              executor === "codex"
                ? !x.startsWith("claude")
                : x.startsWith("claude"),
            ),
          ]),
        ].map((value) => (
          <button
            key={value}
            className="model-option"
            aria-pressed={model === value}
            onClick={() => {
              onChange(value, effort);
              setCustom(value);
            }}
          >
            <span>{label(value)}</span>
            {model === value && <Check size={16} />}
          </button>
        ))}
        <div className="model-menu-label">思考深度</div>
        <div className="effort-options">
          {efforts
            .filter((x) => executor === "codex" || x.value !== "ultra")
            .map((x) => (
              <button
                key={x.value}
                aria-pressed={effort === x.value}
                onClick={() => {
                  onChange(model, x.value);
                  menu.current?.hidePopover();
                  trigger.current?.focus();
                }}
              >
                {x.label.split(" · ")[0]}
              </button>
            ))}
        </div>
        <details>
          <summary>自定义模型</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) {
                onChange(custom.trim(), effort);
                menu.current?.hidePopover();
                trigger.current?.focus();
              }
            }}
          >
            <input
              aria-label="自定义模型 ID"
              required
              maxLength={120}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
            <button type="submit">应用</button>
          </form>
        </details>
        <p>
          仅用于接下来的任务，可用模型取决于账号权限。助手切换在任务配置中设置。
        </p>
      </div>
    </>
  );
}
