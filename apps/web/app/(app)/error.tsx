"use client";
import { useEffect } from "react";
import { Button, LinkButton } from "@/components/ui/button";

/** Keeps the sidebar and gives a way out when a page or an action throws, instead of a blank application error. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="max-w-lg mx-auto mt-16 rounded-lg border border-border bg-surface p-6 text-center">
      <h1 className="text-base font-semibold">This page hit an error</h1>
      <p className="text-[13px] text-fg-2 mt-2">Nothing was lost that had already been saved. Try again, or go back to the dashboard. If it keeps happening, send this reference to whoever maintains the app.</p>
      {error.digest ? <p className="text-xs text-fg-3 mt-2 font-mono">Reference {error.digest}</p> : null}
      <div className="flex items-center justify-center gap-2 mt-4">
        <Button type="button" variant="primary" onClick={() => reset()}>Try again</Button>
        <LinkButton href="/dashboard" variant="outline">Dashboard</LinkButton>
      </div>
    </div>
  );
}
