import { useRef, useState, useEffect, type ReactNode } from "react";
import type { EditBase } from "../../src/studio-client";
import { client } from "./session";

export function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    play: <path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none" />,
    pause: (
      <>
        <path d="M8 5v14M16 5v14" strokeWidth="4" />
      </>
    ),
    undo: (
      <>
        <path d="m8 5-5 5 5 5M3 10h10a6 6 0 0 1 0 12" />
      </>
    ),
    redo: (
      <>
        <path d="m16 5 5 5-5 5M21 10h-10a6 6 0 0 0 0 12" />
      </>
    ),
    save: (
      <>
        <path d="M5 3h12l4 4v14H3V3Z M7 3v7h10V3 M7 21v-7h10v7" />
      </>
    ),
    mix: (
      <>
        <path d="M5 3v18M12 3v18M19 3v18" />
        <path d="M2 8h6M9 16h6M16 7h6" strokeWidth="4" />
      </>
    ),
    groove: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    sound: <path d="M3 10v4M7 6v12M12 3v18M17 7v10M21 10v4" />,
    folder: <path d="M3 6h7l2 3h9v11H3ZM3 6V4h7l2 2h8v3" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  };
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name] ?? paths.sound}
    </svg>
  );
}

// Range values are a short-lived input draft, bound at first interaction. Commit
// once per pointer/keyboard gesture; a concurrent revision must reject that draft.
export function Range({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  unit = "",
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  onCommit: (value: number, base: EditBase) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const gesture = useRef<{ base: EditBase; value: number } | null>(null);
  const begin = () => {
    gesture.current ??= { base: client.base(), value };
  };
  const commit = () => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    setDraft(null);
    if (g.value !== value || g.base.revision !== client.base().revision)
      onCommit(g.value, g.base);
  };
  const cancel = () => {
    gesture.current = null;
    setDraft(null);
  };
  return (
    <label className="range-control">
      <span>
        {label}
        <output>
          {Number((draft ?? value).toFixed(2))}
          {unit}
        </output>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={draft ?? value}
        aria-disabled={disabled}
        onPointerDown={(e) => {
          if (disabled) e.preventDefault();
          else begin();
        }}
        onPointerUp={commit}
        onPointerCancel={cancel}
        onKeyDown={(e) => {
          if (disabled && e.key !== "Tab") {
            e.preventDefault();
            return;
          }
          if (e.key === "Escape") {
            cancel();
            e.currentTarget.blur();
          } else if (e.key !== "Tab") begin();
        }}
        onKeyUp={(e) => {
          if (e.key !== "Escape") commit();
        }}
        onBlur={commit}
        onChange={(e) => {
          if (disabled) return;
          begin();
          const n = +e.target.value;
          gesture.current!.value = n;
          setDraft(n);
        }}
      />
    </label>
  );
}

export function EditableText({
  label,
  value,
  maxLength = 120,
  disabled,
  onCommit,
}: {
  label: string;
  value: string;
  maxLength?: number;
  disabled?: boolean;
  onCommit: (value: string, base: EditBase) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const base = useRef<EditBase | null>(null);
  return (
    <input
      aria-label={label}
      value={draft ?? value}
      maxLength={maxLength}
      readOnly={disabled}
      aria-disabled={disabled}
      onFocus={() => {
        base.current = client.base();
        setDraft(value);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (base.current && draft !== null && draft.trim() !== value)
          onCommit(draft.trim(), base.current);
        base.current = null;
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          base.current = null;
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function ClockStrip({ playing }: { playing: boolean }) {
  const node = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!playing) {
      if (node.current) node.current.style.opacity = "0";
      return;
    }
    let anchor: {
      cycle: number;
      cps: number;
      at: number;
      lead: number;
    } | null = null;
    const stream = new EventSource("/clock");
    stream.onmessage = (event) => {
      try {
        const c = JSON.parse(event.data);
        if (Number.isFinite(c.cycle) && c.cps > 0 && c.age < 2000)
          anchor = {
            cycle: c.cycle + (c.age / 1000) * c.cps,
            cps: c.cps,
            lead: c.lead || 0,
            at: performance.now(),
          };
      } catch {
        /* No invented clock when telemetry is missing. */
      }
    };
    stream.onerror = () => {
      anchor = null;
    };
    let frame = 0;
    const tick = () => {
      const fresh = anchor && performance.now() - anchor.at < 2000;
      if (node.current) {
        node.current.style.opacity = fresh ? "1" : "0";
        if (fresh && anchor) {
          const cycle =
            anchor.cycle +
            ((performance.now() - anchor.at) / 1000 - anchor.lead) * anchor.cps;
          node.current.style.transform = `translateX(${(((cycle % 1) + 1) % 1) * 100}%)`;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      stream.close();
      cancelAnimationFrame(frame);
      if (node.current) node.current.style.opacity = "0";
    };
  }, [playing]);
  return (
    <div className="clock-strip" aria-hidden="true">
      <div ref={node} style={{ opacity: 0 }}>
        <i />
      </div>
    </div>
  );
}
