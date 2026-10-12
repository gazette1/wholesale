"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startFormSubmission } from "@/lib/actions/forms";

export function StartSubmission({ formId }: { formId: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const busy = React.useRef(false);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button type="button" variant="primary" loading={pending} onClick={() => {
        if (busy.current) return;
        busy.current = true;
        setError(null);
        start(async () => {
          try {
            const res = await startFormSubmission({ formId });
            if (!res.ok) { setError(res.error); return; }
            if (res.taskId) router.push(`/forms/tasks/${res.taskId}`); else router.refresh();
          } catch {
            setError("Something went wrong. Try again.");
          } finally {
            busy.current = false;
          }
        });
      }}><Play className="h-3.5 w-3.5" />Start a submission</Button>
      {error ? <span role="alert" className="text-xs text-bad">{error}</span> : null}
    </span>
  );
}
