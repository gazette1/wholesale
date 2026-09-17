"use client";
import * as React from "react";
import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions/leads";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";

type Action = (form: FormData) => Promise<ActionResult>;

/** Wraps a bound server action in a form with pending, error, and success states. */
export function ActionForm({ action, children, submitLabel = "Save", className, variant = "primary", size = "md", resetOnSuccess, onSuccess, inline }: {
  action: Action; children: React.ReactNode; submitLabel?: string; className?: string; variant?: ButtonProps["variant"]; size?: ButtonProps["size"]; resetOnSuccess?: boolean; onSuccess?: () => void; inline?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(async (_prev, form) => action(form), null);
  const ref = React.useRef<HTMLFormElement>(null);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (state?.ok) {
      if (resetOnSuccess) ref.current?.reset();
      setFlash(state.message ?? "Saved");
      onSuccess?.();
      const t = setTimeout(() => setFlash(null), 2500);
      return () => clearTimeout(t);
    }
  }, [state, resetOnSuccess, onSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      <div className={inline ? "inline-flex items-center gap-2" : "flex items-center gap-2 mt-3"}>
        <Button type="submit" variant={variant} size={size} loading={pending}>{submitLabel}</Button>
        {flash ? <span className="text-xs text-good">{flash}</span> : null}
      </div>
      {state && !state.ok ? <Alert tone="bad" className="mt-2">{state.error}</Alert> : null}
    </form>
  );
}

/** A button that calls a bound server action with no form data. */
export function ActionButton({ action, children, variant = "outline", size = "sm", confirm, className, refresh = true }: { action: () => Promise<ActionResult>; children: React.ReactNode; variant?: ButtonProps["variant"]; size?: ButtonProps["size"]; confirm?: string; className?: string; refresh?: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button type="button" variant={variant} size={size} loading={pending} className={className} onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          const res = await action();
          if (!res.ok) setError(res.error); else { setError(null); if (refresh) router.refresh(); }
        });
      }}>{children}</Button>
      {error ? <span className="text-xs text-bad">{error}</span> : null}
    </span>
  );
}
