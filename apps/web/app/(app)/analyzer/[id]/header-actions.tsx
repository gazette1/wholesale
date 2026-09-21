"use client";
import { useState } from "react";
import { cloneAnalysis, setAnalysisStatus } from "@/lib/actions/analyzer";
import { ActionButton, SubmitOnce } from "@/components/ui/action-form";
import type { ActionResult } from "@/lib/actions/leads";

type Status = "draft" | "reviewing" | "approved_for_offer" | "rejected";

/** The editor sets this flag on the document while it holds unsaved edits. */
function hasUnsavedEdits(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.unsavedAnalysis === "1";
}

/**
 * Status changes and Clone act on the SAVED version. Approving with unsaved edits used to lock the form on numbers
 * that were never stored, so these refuse until the edits are saved.
 */
export function AnalysisHeaderActions({ analysisId, status, locked }: { analysisId: string; status: Status; locked: boolean }) {
  const [blocked, setBlocked] = useState<string | null>(null);
  const guarded = (next: Status) => async (): Promise<ActionResult> => {
    if (hasUnsavedEdits()) return { ok: false, error: "Save your changes first. The status applies to the saved numbers." };
    return setAnalysisStatus(analysisId, next);
  };
  return (
    <>
      <form action={cloneAnalysis.bind(null, analysisId)} onSubmit={(e) => {
        if (hasUnsavedEdits() && !window.confirm("Clone copies the saved version, not the edits you have not saved. Clone anyway and leave this page?")) { e.preventDefault(); setBlocked("Save first to include your edits in the clone."); }
        else document.documentElement.dataset.unsavedAnalysis = "";
      }}>
        <SubmitOnce variant="outline">Clone</SubmitOnce>
      </form>
      {status === "draft" ? <ActionButton action={guarded("reviewing")} size="md">Send to review</ActionButton> : null}
      {status === "reviewing" ? <ActionButton action={guarded("draft")} variant="ghost" size="md">Back to draft</ActionButton> : null}
      {status !== "approved_for_offer" ? <ActionButton action={guarded("approved_for_offer")} variant="primary" size="md">Approve for offer</ActionButton> : null}
      {status !== "rejected" ? <ActionButton action={guarded("rejected")} variant="ghost" size="md" confirm="Reject this version? It locks, and another version takes over as primary when one exists.">Reject</ActionButton> : null}
      {locked ? <ActionButton action={guarded("draft")} variant="ghost" size="md">Reopen</ActionButton> : null}
      {blocked ? <span role="status" className="text-xs text-warn self-center">{blocked}</span> : null}
    </>
  );
}
