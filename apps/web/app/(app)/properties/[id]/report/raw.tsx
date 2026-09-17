"use client";
import { useState } from "react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function RawJson({ raw, normalized }: { raw: Record<string, unknown>; normalized: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const [which, setWhich] = useState<"raw" | "normalized">("normalized");
  return (
    <Card className="mt-4">
      <CardHeader title="Developer data" description="Provider response as stored. Admins only." actions={<Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show"}</Button>} />
      {open ? (
        <CardBody>
          <div className="flex gap-2 mb-2">
            <Button size="sm" variant={which === "normalized" ? "default" : "outline"} onClick={() => setWhich("normalized")}>Normalized</Button>
            <Button size="sm" variant={which === "raw" ? "default" : "outline"} onClick={() => setWhich("raw")}>Raw</Button>
          </div>
          <pre className="text-[11px] leading-relaxed bg-surface-2 border border-border rounded-md p-3 overflow-x-auto max-h-[480px] scrollbar-thin font-mono">{JSON.stringify(which === "raw" ? raw : normalized, null, 2)}</pre>
        </CardBody>
      ) : null}
    </Card>
  );
}
