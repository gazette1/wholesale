"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startFormSubmission } from "@/lib/actions/forms";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";

/** Picks a published form for a lead or buyer and opens the first task. */
export function StartForm({ subject, forms }: { subject: { kind: "lead" | "buyer"; id: string }; forms: { id: string; name: string; category: string | null }[] }) {
  const router = useRouter();
  const [formId, setFormId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = useRef(false);

  if (forms.length === 0) return <p className="text-[13px] text-fg-3">No forms are available to start for this record.</p>;

  function begin() {
    if (busy.current) return;
    if (!formId) { setError("Choose a form to start."); return; }
    busy.current = true;
    setError(null);
    start(async () => {
      try {
        const res = await startFormSubmission({ formId, leadId: subject.kind === "lead" ? subject.id : null, buyerId: subject.kind === "buyer" ? subject.id : null });
        if (!res.ok) { setError(res.error); return; }
        if (res.taskId) router.push(`/forms/tasks/${res.taskId}`);
        else router.refresh();
      } catch {
        setError("Something went wrong. Try again.");
      } finally {
        busy.current = false;
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="sm:w-72">
        <label htmlFor={`start-form-${subject.id}`} className="block text-xs font-medium text-fg-2 mb-1">Form</label>
        <Select id={`start-form-${subject.id}`} value={formId} onChange={(e) => { setFormId(e.target.value); setError(null); }}>
          <option value="">Choose a form</option>
          {forms.map((f) => <option key={f.id} value={f.id}>{f.name}{f.category ? ` (${f.category})` : ""}</option>)}
        </Select>
      </div>
      <Button type="button" variant="primary" loading={pending} onClick={begin}>Start form</Button>
      {error ? <span role="alert" className="text-xs text-bad">{error}</span> : null}
    </div>
  );
}
