"use client";
import * as React from "react";
import type { DefinitionError } from "@dealcalc/forms";
import { CheckCircle2, AlertTriangle } from "lucide-react";

export function ValidationPanel({ errors, onJump }: { errors: DefinitionError[]; onJump: (path: string) => void }) {
  return (
    <details open={errors.length > 0} className="rounded-lg border border-border bg-surface" aria-label="Validation">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] font-medium select-none">
        {errors.length === 0
          ? <><CheckCircle2 className="h-4 w-4 text-good" />No problems found in this draft</>
          : <><AlertTriangle className="h-4 w-4 text-bad" />{errors.length} {errors.length === 1 ? "problem" : "problems"} to fix before publishing</>}
      </summary>
      {errors.length ? (
        <ul className="border-t border-border divide-y divide-border/60" role="list">
          {errors.map((e, i) => (
            <li key={`${e.path}-${i}`} className="px-3 py-2 text-[13px]">
              <button type="button" onClick={() => onJump(e.path)} className="text-left w-full hover:underline">
                <span className="block text-fg">{e.message}</span>
                <span className="block text-[11px] text-fg-3 font-mono">{e.path || "form"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}
