"use client";
import * as React from "react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions/leads";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

type Action = (form: FormData) => Promise<ActionResult>;

/**
 * Runs a server action from a form without handing the form to React's `action` prop.
 * React 19 resets an uncontrolled form after every action, which wiped the user's input on a
 * validation error and left selects showing their old value after a save, so the next save wrote
 * the old value back. Submitting by hand keeps what the user typed, and ignores a second submit
 * while the first is still running.
 */
export function useServerForm(action: Action, opts: { onSuccess?: (result: Extract<ActionResult, { ok: true }>, form: HTMLFormElement) => void } = {}) {
  const [state, setState] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const onSuccess = useRef(opts.onSuccess);
  onSuccess.current = opts.onSuccess;
  const onSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy.current) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    busy.current = true;
    start(async () => {
      try {
        const result = await action(data);
        setState(result);
        if (result.ok) onSuccess.current?.(result, form);
      } catch (err) {
        // A redirect from the action surfaces here as a thrown signal; let Next handle it.
        if (err && typeof err === "object" && "digest" in err && String((err as { digest?: unknown }).digest).startsWith("NEXT_")) throw err;
        setState({ ok: false, error: "Something went wrong. Try again." });
      } finally {
        busy.current = false;
      }
    });
  }, [action]);
  return { state, pending, onSubmit };
}

/** Wraps a bound server action in a form with pending, error, and success states. */
export function ActionForm({ action, children, submitLabel = "Save", className, variant = "primary", size = "md", resetOnSuccess, onSuccess, inline }: {
  action: Action; children: React.ReactNode; submitLabel?: string; className?: string; variant?: ButtonProps["variant"]; size?: ButtonProps["size"]; resetOnSuccess?: boolean; onSuccess?: () => void; inline?: boolean;
}) {
  const [flash, setFlash] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const { state, pending, onSubmit } = useServerForm(action, {
    onSuccess: (result, form) => {
      if (resetOnSuccess) form.reset();
      setFlash(result.message ?? "Saved");
      onSuccess?.();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setFlash(null), 2500);
    },
  });
  return (
    <form onSubmit={onSubmit} className={className}>
      {children}
      <div className={inline ? "inline-flex items-center gap-2" : "flex items-center gap-2 mt-3"}>
        <Button type="submit" variant={variant} size={size} loading={pending}>{submitLabel}</Button>
        {flash ? <span role="status" className="text-xs text-good">{flash}</span> : null}
      </div>
      {state && !state.ok && !pending ? <Alert tone="bad" className="mt-2">{state.error}</Alert> : null}
    </form>
  );
}

/** A button that calls a bound server action with no form data. */
export function ActionButton({ action, children, variant = "outline", size = "sm", confirm, className, refresh = true }: { action: () => Promise<ActionResult>; children: React.ReactNode; variant?: ButtonProps["variant"]; size?: ButtonProps["size"]; confirm?: string; className?: string; refresh?: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button type="button" variant={variant} size={size} loading={pending} className={className} onClick={() => {
        if (busy.current) return;
        if (confirm && !window.confirm(confirm)) return;
        busy.current = true;
        start(async () => {
          try {
            const res = await action();
            if (!res.ok) { setNote(null); setError(res.error); }
            else {
              setError(null);
              // Results such as "Sent 3, skipped 0" or "Enrolled 3 leads" are the only feedback the user gets, so show them.
              if (res.message) { setNote(res.message); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setNote(null), 6000); }
              if (refresh) router.refresh();
            }
          } finally {
            busy.current = false;
          }
        });
      }}>{children}</Button>
      {error ? <span role="alert" className="text-xs text-bad">{error}</span> : null}
      {note ? <span role="status" className="text-xs text-good">{note}</span> : null}
    </span>
  );
}

/**
 * Submit button for a plain `<form action={serverAction}>` that redirects (create analysis, clone, new version).
 * Disables itself while the action runs so a double click cannot create two records.
 */
export function SubmitOnce({ children, variant = "primary", size = "md", className }: { children: React.ReactNode; variant?: ButtonProps["variant"]; size?: ButtonProps["size"]; className?: string }) {
  const [clicked, setClicked] = useState(false);
  // A ref, not state: two clicks in the same tick both see the state from the last render.
  const fired = useRef(false);
  return (
    <Button type="submit" variant={variant} size={size} className={cn(className, clicked && "pointer-events-none opacity-70")} aria-disabled={clicked}
      onClick={(e) => {
        if (fired.current) { e.preventDefault(); return; }
        fired.current = true;
        // The button is not disabled outright, because disabling it inside the click would cancel the submit it just started.
        setClicked(true);
        // If the action fails without navigating, give the control back.
        setTimeout(() => { fired.current = false; setClicked(false); }, 8000);
      }}>{clicked ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{children}</Button>
  );
}
