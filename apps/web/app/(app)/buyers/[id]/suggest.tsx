"use client";
import { useState, useTransition } from "react";
import { suggestCriteria } from "@/lib/actions/buyers";
import { Button } from "@/components/ui/button";

type Suggestion = { funding: string; sightUnseen: number; conditionLevels: number[]; provider: string; confidence: number };

/** Reads the buyer call notes through the judgment provider. It never saves anything; the person enters what they agree with. */
export function SuggestCriteria({ buyerId }: { buyerId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Suggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-2">
      <Button type="button" variant="outline" size="sm" loading={pending} onClick={() => start(async () => {
        const r = await suggestCriteria(buyerId);
        if (r.ok) { setResult(r); setError(null); } else { setResult(null); setError(r.error); }
      })}>Suggest from notes</Button>
      {error ? <p role="alert" className="text-xs text-bad max-w-xs text-right">{error}</p> : null}
      {result ? (
        <div role="status" className="rounded-md border border-border bg-surface-2 p-2 text-xs text-fg-2 max-w-xs text-left">
          <div className="font-medium text-fg">Suggested from the call notes</div>
          <ul className="mt-1 space-y-0.5">
            <li>Funding: {result.funding.replace(/_/g, " ")} ({Math.round(result.confidence * 100)}% confident)</li>
            <li>Buys sight unseen: {Math.round(result.sightUnseen * 100)}% likely</li>
            <li>Condition levels: {result.conditionLevels.length ? result.conditionLevels.join(", ") : "not stated"}</li>
          </ul>
          <p className="mt-1 text-fg-3">{result.provider === "mock" ? "Keyword rules, low confidence. " : ""}Nothing was saved. Enter what you agree with in the buy box.</p>
          <button type="button" className="mt-1 text-brand hover:underline" onClick={() => setResult(null)}>Dismiss</button>
        </div>
      ) : null}
    </div>
  );
}
