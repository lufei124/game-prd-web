import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Zap } from "lucide-react";
import {
  EFFORT_OPTIONS,
  MODEL_OPTIONS,
  effortLabel,
  modelLabel,
  withCurrentOption,
  type ListOption,
} from "./components/ListSelect";

export {
  EFFORT_OPTIONS,
  MODEL_OPTIONS,
  effortLabel,
  modelLabel,
} from "./components/ListSelect";

export function ModelPicker({
  model,
  effort,
  onChange,
}: {
  model: string;
  effort: string;
  onChange: (model: string, effort: string) => void;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const models = withCurrentOption(MODEL_OPTIONS, model);
  const [active, setActive] = useState(model);

  useEffect(() => setActive(model), [model]);

  function toggle() {
    const node = menu.current;
    const button = trigger.current;
    if (!node || !button) return;
    if (node.matches(":popover-open")) {
      node.hidePopover();
      return;
    }
    node.showPopover();
    const anchor = button.getBoundingClientRect();
    const left = Math.max(
      12,
      Math.min(anchor.left, innerWidth - node.offsetWidth - 12),
    );
    node.style.left = `${left}px`;
    node.style.top = `${Math.max(12, anchor.top - node.offsetHeight - 8)}px`;
    setActive(model);
  }

  function pickModel(value: string) {
    onChange(value, effort);
    setActive(value);
  }

  function pickEffort(value: string) {
    onChange(model, value);
    menu.current?.hidePopover();
    trigger.current?.focus();
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="list-select-pill composer-model"
        aria-label="选择本次任务模型与思考深度"
        aria-haspopup="dialog"
        aria-controls={id}
        onClick={toggle}
      >
        <Zap size={13} />
        <span>{modelLabel(model)}</span>
        <em>{effortLabel(effort)}</em>
        <ChevronDown size={14} />
      </button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        role="dialog"
        aria-label="本次任务模型"
        className="list-popover model-popover"
      >
        <DesignedList
          label="选择模型"
          heading="默认"
          description="推荐模型"
          value={model}
          active={active}
          options={models}
          onActive={setActive}
          onChoose={pickModel}
        />
        <DesignedList
          label="思考深度"
          heading="强度"
          description="本次任务的推理强度"
          value={effort}
          active={effort}
          options={EFFORT_OPTIONS}
          onActive={() => {}}
          onChoose={pickEffort}
        />
      </div>
    </>
  );
}

function DesignedList({
  label,
  heading,
  description,
  value,
  active,
  options,
  onActive,
  onChoose,
}: {
  label: string;
  heading: string;
  description: string;
  value: string;
  active: string;
  options: ListOption[];
  onActive: (value: string) => void;
  onChoose: (value: string) => void;
}) {
  return (
    <div className="designed-list">
      <div className="list-popover-label">{label}</div>
      <div className="list-popover-heading">{heading}</div>
      <div className="list-popover-desc">{description}</div>
      <div role="listbox">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="option"
            className="list-option"
            aria-selected={value === option.value}
            data-active={active === option.value ? "true" : undefined}
            onMouseEnter={() => onActive(option.value)}
            onClick={() => onChoose(option.value)}
          >
            <span>{option.label}</span>
            {value === option.value && <Check size={16} />}
          </button>
        ))}
      </div>
    </div>
  );
}
