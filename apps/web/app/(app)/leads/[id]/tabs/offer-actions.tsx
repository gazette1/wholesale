"use client";
import { useState } from "react";
import { updateOfferStatus } from "@/lib/actions/leads";
import { ActionButton } from "@/components/ui/action-form";
import { Input } from "@/components/ui/input";

/** Every status change an offer can take from where it is now. Accepting or rejecting asks first because it moves the lead. */
export function OfferActions({ offerId, leadId, status }: { offerId: string; leadId: string; status: string }) {
  const [counter, setCounter] = useState("");
  const amount = Number(counter);
  const set = (next: "sent" | "accepted" | "rejected" | "countered" | "expired", counterAmount?: number) => updateOfferStatus.bind(null, offerId, leadId, next, counterAmount);
  if (status === "draft") return <ActionButton action={set("sent")} size="sm" variant="primary">Mark sent</ActionButton>;
  if (status === "accepted" || status === "rejected" || status === "expired") return <ActionButton action={set("sent")} size="sm" variant="ghost" confirm="Reopen this offer as sent? The lead's stage is not moved back.">Reopen</ActionButton>;
  return (
    <div className="flex flex-wrap items-start gap-1">
      <ActionButton action={set("accepted")} size="sm" variant="primary" confirm="Mark this offer accepted? The lead moves to Under Contract.">Accepted</ActionButton>
      <ActionButton action={set("rejected")} size="sm" confirm="Mark this offer rejected?">Rejected</ActionButton>
      <ActionButton action={set("expired")} size="sm" variant="ghost">Expired</ActionButton>
      <span className="inline-flex items-start gap-1">
        <Input type="number" min={1} step={500} value={counter} onChange={(e) => setCounter(e.target.value)} placeholder="Counter $" aria-label="Seller counter amount" className="h-7 w-24 text-xs" />
        <ActionButton action={set("countered", Number.isFinite(amount) && amount > 0 ? amount : undefined)} size="sm" variant="ghost">Countered</ActionButton>
      </span>
    </div>
  );
}
