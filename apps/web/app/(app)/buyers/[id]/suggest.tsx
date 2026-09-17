"use client";
import { useState, useTransition } from "react";
import { suggestCriteria } from "@/lib/actions/buyers";
import { Button } from "@/components/ui/button";

export function SuggestCriteria({ buyerId }: { buyerId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {result ? <span className="text-xs text-fg-3 max-w-xs truncate" title={result}>{result}</span> : null}
      <Button type="button" variant="outline" size="sm" loading={pending} onClick={() => start(async () => {
        const r = await suggestCriteria(buyerId);
        setResult(r.ok ? `${r.provider}: funding ${r.funding} (${Math.round(r.confidence * 100)}%), sight unseen ${Math.round(r.sightUnseen * 100)}%, condition ${r.conditionLevels.join(",")}` : r.error);
      })}>Suggest from notes</Button>
    </div>
  );
}
