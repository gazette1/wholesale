"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const INTERACTIVE = "a, button, input, select, textarea, label, summary, [role='button'], [role='checkbox'], [data-row-ignore]";

/**
 * A table row that opens `href` when clicked anywhere outside an inner control.
 * Keyboard users reach the same place through the link in the first cell, which
 * stays the single tab stop; the row shows a focus state while that link is focused.
 */
export function ClickableRow({ href, className, children, ...props }: React.HTMLAttributes<HTMLTableRowElement> & { href: string }) {
  const router = useRouter();
  function shouldIgnore(e: React.MouseEvent<HTMLTableRowElement>) {
    if (e.defaultPrevented) return true;
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return true;
    // Do not navigate when the user is selecting text in the row.
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
  }
  return (
    <tr
      {...props}
      onClick={(e) => {
        if (e.button !== 0 || shouldIgnore(e)) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey) { window.open(href, "_blank", "noopener"); return; }
        router.push(href);
      }}
      onAuxClick={(e) => { if (e.button === 1 && !shouldIgnore(e)) window.open(href, "_blank", "noopener"); }}
      className={cn("cursor-pointer hover:bg-surface-2 transition-colors has-[a:focus-visible]:bg-surface-2 has-[a:focus-visible]:outline has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-brand/40", className)}
    >
      {children}
    </tr>
  );
}
