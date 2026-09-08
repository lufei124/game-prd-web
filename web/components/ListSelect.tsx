import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type ListOption = { value: string; label: string; hint?: string };

export const MODEL_OPTIONS: ListOption[] = [
  { value: "gpt-6-astra", label: "GPT-6 Astra" },
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { value: "gpt-5.5", label: "GPT-5.5" },
];

export const EFFORT_OPTIONS: ListOption[] = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "很高" },
  { value: "max", label: "最大" },
  { value: "ultra", label: "超深" },
];

export function modelLabel(id: string) {
  return (
    MODEL_OPTIONS.find((x) => x.value === id)?.label ||
    id.replace(/^gpt-/i, "GPT-").replace(/-/g, " ")
  );
}

export function effortLabel(id: string) {
  return EFFORT_OPTIONS.find((x) => x.value === id)?.label || id;
}

export function withCurrentOption(options: ListOption[], value: string) {
  if (!value || options.some((x) => x.value === value)) return options;
  return [{ value, label: modelLabel(value) }, ...options];
}

function placePopover(
  trigger: HTMLElement,
  menu: HTMLElement,
  placement: "above" | "below",
) {
  const anchor = trigger.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const left = Math.max(12, Math.min(anchor.left, innerWidth - width - 12));
  const above = Math.max(12, anchor.top - height - 8);
  const below = Math.min(innerHeight - height - 12, anchor.bottom + 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${placement === "above" ? above : below}px`;
}

export function ListSelect({
  label,
  heading,
  description,
  value,
  options,
  onChange,
  variant = "field",
  placement = "below",
  icon,
  suffix,
}: {
  label: string;
  heading?: string;
  description?: string;
  value: string;
  options: ListOption[];
  onChange: (value: string) => void;
  variant?: "field" | "pill";
  placement?: "above" | "below";
  icon?: React.ReactNode;
  suffix?: string;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState(value);
  const [open, setOpen] = useState(false);
  const selected = options.find((x) => x.value === value);
  const visible = withCurrentOption(options, value);

  useEffect(() => setActive(value), [value]);

  function toggle() {
    const node = menu.current;
    const button = trigger.current;
    if (!node || !button) return;
    if (node.matches(":popover-open")) {
      node.hidePopover();
      return;
    }
    node.showPopover();
    placePopover(button, node, placement);
    setActive(value);
  }

  function choose(next: string) {
    onChange(next);
    menu.current?.hidePopover();
    trigger.current?.focus();
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={
          variant === "pill" ? "list-select-pill" : "list-select-field"
        }
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
      >
        {icon}
        <span>{selected?.label || modelLabel(value)}</span>
        {suffix && <em>{suffix}</em>}
        <ChevronDown size={14} />
      </button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        className="list-popover"
        onToggle={(e) => {
          const shown = (e.target as HTMLElement).matches(":popover-open");
          setOpen(shown);
          if (shown) setActive(value);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          const index = visible.findIndex((x) => x.value === active);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive(visible[Math.min(visible.length - 1, index + 1)].value);
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive(visible[Math.max(0, index - 1)].value);
          }
          if (e.key === "Enter" && visible[Math.max(0, index)]) {
            e.preventDefault();
            choose(visible[Math.max(0, index)].value);
          }
        }}
      >
        <div className="list-popover-label">{label}</div>
        {heading && <div className="list-popover-heading">{heading}</div>}
        {description && <div className="list-popover-desc">{description}</div>}
        <div role="listbox">
          {visible.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              className="list-option"
              aria-selected={value === option.value}
              data-active={active === option.value ? "true" : undefined}
              onMouseEnter={() => setActive(option.value)}
              onClick={() => choose(option.value)}
            >
              <span>
                {option.label}
                {option.hint && <small>{option.hint}</small>}
              </span>
              {value === option.value && <Check size={16} />}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
