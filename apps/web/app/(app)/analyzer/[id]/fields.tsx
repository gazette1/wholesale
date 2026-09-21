"use client";
import * as React from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Input, Field } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** True when the analysis is approved, rejected, or the viewer cannot write. Every field reads it. */
export const LockedContext = createContext(false);
export const useLocked = () => useContext(LockedContext);

type NumProps = {
  label: string; value: number | null | undefined; onChange: (v: number) => void; onClear?: () => void;
  step?: number; hint?: string; pct?: boolean; plain?: boolean; min?: number; max?: number; disabled?: boolean; placeholder?: string; className?: string;
  /** The stored value is a whole number. Typing 12.7 is left alone until the field loses focus. */
  integer?: boolean;
  /** Overrides the accessible name when two fields on screen share a label. */
  ariaLabel?: string;
};

/**
 * Number input that keeps its own text while the user types, so partial entries
 * such as "0." or an empty box are not rewritten under the cursor. Percent
 * fields show 7 for 0.07. Defined at module level on purpose: a component
 * declared inside another component's render remounts on every keystroke.
 */
export function NumField({ label, value, onChange, onClear, step = 1, hint, pct, plain, min, max, disabled, placeholder, className, integer, ariaLabel }: NumProps) {
  const locked = useLocked();
  const shown = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "" : String(pct ? Number((v * 100).toFixed(4)) : v));
  const [text, setText] = useState(shown(value));
  const focused = useRef(false);
  useEffect(() => {
    // Follow outside changes (report buttons, linked fields) unless the user is mid edit on the same number.
    const parsed = text === "" ? null : integer ? Math.round(Number(text)) : Number(text);
    const current = value == null ? null : pct ? Number((value * 100).toFixed(4)) : value;
    if (!focused.current || parsed !== current) setText(shown(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Field label={label} hint={hint} className={className}>
      <div className="relative">
        {pct || plain ? null : <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-fg-3">$</span>}
        <Input
          type="number" inputMode="decimal" step={pct ? 0.01 : step} min={min} max={max} disabled={locked || disabled} placeholder={placeholder} value={text} aria-label={ariaLabel ?? label}
          onFocus={() => { focused.current = true; }}
          onBlur={() => { focused.current = false; setText(shown(value)); }}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            if (raw === "") { if (onClear) onClear(); else onChange(0); return; }
            const n = Number(raw);
            if (Number.isFinite(n)) onChange(pct ? n / 100 : n);
          }}
          className={cn(pct ? "pr-6" : plain ? "" : "pl-5")}
        />
        {pct ? <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-fg-3">%</span> : null}
      </div>
    </Field>
  );
}

/** Small segmented control used for the rehab source, draw mode, and similar switches. */
export function Segmented<T extends string>({ value, options, onChange, disabled, label }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean; label: string }) {
  const locked = useLocked();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-border bg-surface-2 p-0.5">
      {options.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={value === o.key} disabled={locked || disabled} onClick={() => onChange(o.key)}
          className={cn("px-2.5 py-1 text-xs rounded-[5px] whitespace-nowrap transition-colors disabled:opacity-50", value === o.key ? "bg-surface shadow-[var(--shadow-card)] font-medium text-fg" : "text-fg-3 hover:text-fg")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div className="pt-1">
      <div className="text-xs font-semibold text-fg">{children}</div>
      {note ? <p className="text-xs text-fg-3 mt-0.5">{note}</p> : null}
    </div>
  );
}
