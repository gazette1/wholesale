"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * A datetime-local field posts a bare wall clock time with no zone. This keeps the visible field unnamed and posts
 * a hidden ISO value converted in the browser, so the instant is exact on any server and across daylight saving changes.
 */
export function LocalDateTime({ name, defaultValue, className, disabled, required, ariaLabel }: { name: string; defaultValue?: string; className?: string; disabled?: boolean; required?: boolean; ariaLabel?: string }) {
  const [local, setLocal] = useState(defaultValue ?? "");
  const d = local ? new Date(local) : null;
  const iso = d && !Number.isNaN(d.getTime()) ? d.toISOString() : "";
  return (
    <>
      <Input type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} className={className} disabled={disabled} required={required} aria-label={ariaLabel} />
      <input type="hidden" name={name} value={iso} />
    </>
  );
}
