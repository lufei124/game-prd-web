import React, { useEffect, useRef, useState } from "react";

// Layout preferences only; never mutate product or artifact data.
export function ResizeHandle({
  name,
  target,
  variable,
  min = 140,
  reserve = 300,
  reverse = false,
}: {
  name: string;
  target: string;
  variable: string;
  min?: number;
  reserve?: number;
  reverse?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(0);
  const [value, setValue] = useState(min);
  const [visible, setVisible] = useState(false);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const key = `forge:layout:${variable}`;
  const elements = () => {
    const parent = ref.current?.parentElement;
    return {
      parent,
      pane:
        target === "self" ? parent : parent?.querySelector<HTMLElement>(target),
    };
  };
  const resize = (width: number) => {
    const { parent, pane } = elements();
    if (!parent || !pane) return;
    const maximum = Math.max(
      min,
      (target === "self" ? window.innerWidth : parent.clientWidth) - reserve,
    );
    const next = Math.round(Math.max(min, Math.min(maximum, width)));
    parent.style.setProperty(variable, `${next}px`);
    try {
      localStorage.setItem(key, String(next));
    } catch {
      /* Optional preference. */
    }
  };
  useEffect(() => {
    const { parent, pane } = elements();
    if (!parent || !pane) return;
    try {
      const saved = localStorage.getItem(key);
      if (saved && Number.isFinite(Number(saved))) resize(Number(saved));
    } catch {
      /* Browser storage may be unavailable. */
    }
    const measure = () => {
      const p = parent.getBoundingClientRect(),
        r = pane.getBoundingClientRect();
      setVisible(r.width > 0 && r.height > 0);
      setPosition((reverse ? r.left : r.right) - p.left + parent.scrollLeft);
      setValue(Math.round(r.width));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    observer.observe(pane);
    measure();
    return () => {
      observer.disconnect();
      document.body.classList.remove("resizing-panels");
    };
  }, [target, variable]);
  const stop = () => {
    drag.current = null;
    document.body.classList.remove("resizing-panels");
  };
  return (
    <div
      ref={ref}
      role="separator"
      aria-label={name}
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={min}
      tabIndex={visible ? 0 : -1}
      className={`resize-handle ${visible ? "" : "resize-hidden"}`}
      style={{ left: position }}
      title={`${name}：拖动调整，双击重置；方向键微调`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const { pane } = elements();
        if (!pane) return;
        drag.current = {
          x: e.clientX,
          width: pane.getBoundingClientRect().width,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        document.body.classList.add("resizing-panels");
      }}
      onPointerMove={(e) => {
        if (drag.current)
          resize(
            drag.current.width +
              (e.clientX - drag.current.x) * (reverse ? -1 : 1),
          );
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onDoubleClick={() => {
        elements().parent?.style.removeProperty(variable);
        try {
          localStorage.removeItem(key);
        } catch {}
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          resize(
            value +
              (e.key === "ArrowRight" ? 1 : -1) *
                (reverse ? -1 : 1) *
                (e.shiftKey ? 40 : 10),
          );
        }
      }}
    />
  );
}
