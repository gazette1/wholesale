"use client";
import { ActionButton } from "@/components/ui/action-form";
import { rescoreLeadAction } from "@/lib/actions/lead-scores";

/**
 * Runs a fresh lead score on demand. Meant to be dropped on the lead page (see the final report for
 * where): `<RescoreButton leadId={lead.id} />`.
 */
export function RescoreButton({ leadId }: { leadId: string }) {
  return <ActionButton action={rescoreLeadAction.bind(null, leadId)} variant="outline" size="sm">Rescore</ActionButton>;
}
