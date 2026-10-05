"use server";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { activities, calls, leads } from "@dealcalc/db";
import { getDb } from "../db";
import { requireSession, requireCan } from "../auth";
import { audit } from "../audit";
import { friendlyError, isUuid, textField } from "../safe";
import { placeCall, CallBlockedError, CALL_OUTCOMES, type CallOutcome } from "../services/voice";
import type { ActionResult } from "./leads";

/** Bridge call to the lead's primary contact. With the mock provider nothing rings, and the message says so. */
export async function startLeadCall(leadId: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "message:send");
    if (!isUuid(leadId)) return { ok: false, error: "Lead not found." };
    const { call, provider, error } = await placeCall(session, leadId);
    revalidatePath(`/leads/${leadId}`);
    if (error) return { ok: false, error: `The call could not be placed. ${error}` };
    await audit(session, { entityType: "call", entityId: call.id, action: "create", after: { leadId, to: call.toAddr, provider, status: call.status } });
    revalidatePath("/dashboard");
    return { ok: true, id: call.id, message: provider === "mock" ? "Voice calling is not connected yet. A mock call was logged and no phone rang." : "Calling your phone now. Answer it and the seller is dialed next." };
  } catch (err) {
    if (err instanceof CallBlockedError) return { ok: false, error: err.message };
    return { ok: false, error: friendlyError(err, "Could not place the call.") };
  }
}

export async function saveCallOutcome(callId: string, leadId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "message:send");
    if (!isUuid(callId)) return { ok: false, error: "Call not found." };
    const db = await getDb();
    const call = await db.query.calls.findFirst({ where: and(eq(calls.id, callId), eq(calls.orgId, session.orgId)) });
    if (!call) return { ok: false, error: "Call not found." };
    const outcomeRaw = String(form.get("outcome") ?? "");
    if (outcomeRaw && !(CALL_OUTCOMES as readonly string[]).includes(outcomeRaw)) return { ok: false, error: "Pick an outcome from the list." };
    const outcome = (outcomeRaw || null) as CallOutcome | null;
    const notes = textField(form.get("notes"), 4000);
    await db.update(calls).set({ outcome, notes }).where(and(eq(calls.id, callId), eq(calls.orgId, session.orgId)));
    // The lead comes from the call row, never from the caller.
    const ownLeadId = call.leadId;
    if (ownLeadId) {
      // The timeline row written when the call was placed carries the outcome too, so the Activity tab shows it.
      await db.update(activities).set({ payload: sql`${activities.payload} || ${JSON.stringify({ outcome: outcome ?? "", notes: notes ?? "" })}::jsonb` }).where(and(eq(activities.orgId, session.orgId), eq(activities.leadId, ownLeadId), eq(activities.type, "call"), sql`${activities.payload}->>'callId' = ${callId}`));
      if (outcome === "spoke") {
        const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, ownLeadId), eq(leads.orgId, session.orgId)) });
        if (lead && lead.firstResponseMinutes == null) await db.update(leads).set({ firstResponseMinutes: Math.max(1, Math.round((Date.now() - new Date(lead.createdAt).getTime()) / 60_000)) }).where(and(eq(leads.id, ownLeadId), eq(leads.orgId, session.orgId)));
      }
    }
    await audit(session, { entityType: "call", entityId: callId, action: "outcome", before: { outcome: call.outcome }, after: { outcome } });
    const pageLeadId = ownLeadId ?? (isUuid(leadId) ? leadId : null);
    if (pageLeadId) revalidatePath(`/leads/${pageLeadId}`);
    return { ok: true, message: "Saved" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not save the call outcome.") };
  }
}
