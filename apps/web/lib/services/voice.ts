import { and, desc, eq, sql } from "drizzle-orm";
import { activities, calls, contacts, leads, profiles } from "@dealcalc/db";
import { voiceProvider, normalizePhone, phoneMatchKey, phonesMatch, TERMINAL_CALL_STATUSES, type CallStatus, type StartCallResult } from "@dealcalc/integrations";
import { getDb } from "../db";
import type { Session } from "../auth";

/** The call was refused before the provider was asked: do not contact, no phone, no agent number. */
export class CallBlockedError extends Error {}

export const CALL_OUTCOMES = ["spoke", "voicemail", "no_answer", "wrong_number", "callback"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

// Twilio client identities allow letters, digits, and underscores only.
export function voiceIdentity(profileId: string): string {
  return profileId.replace(/-/g, "_");
}

function profileIdFromIdentity(identity: string): string | null {
  const id = identity.replace(/^client:/, "").replace(/_/g, "-");
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

type Db = Awaited<ReturnType<typeof getDb>>;

/** Same bookkeeping as a call logged by hand in addActivity: one timeline row, one contact attempt. */
async function logCallActivity(db: Db, orgId: string, leadId: string, actorId: string | null, payload: Record<string, unknown>): Promise<void> {
  await db.insert(activities).values({ orgId, leadId, actorId, type: "call", payload });
  await db.update(leads).set({ lastContactAt: new Date(), contactAttempts: sql`${leads.contactAttempts} + 1` }).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
}

/**
 * Bridge call to the lead's primary contact: the provider rings the agent's phone, then dials the contact.
 * Refuses before the provider is called when the contact is do not contact or has no usable number.
 */
export async function placeCall(session: Session, leadId: string) {
  const db = await getDb();
  const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, leadId), eq(leads.orgId, session.orgId)) });
  if (!lead) throw new Error("Lead not found.");
  if (!lead.primaryContactId) throw new CallBlockedError("This lead has no primary contact to call.");
  const [contact, agent] = await Promise.all([
    db.query.contacts.findFirst({ where: and(eq(contacts.id, lead.primaryContactId), eq(contacts.orgId, session.orgId)) }),
    db.query.profiles.findFirst({ where: and(eq(profiles.id, session.profileId), eq(profiles.orgId, session.orgId)) }),
  ]);
  if (!contact) throw new CallBlockedError("The primary contact was not found.");
  if (contact.doNotContact) throw new CallBlockedError("This contact is marked do not contact. Calling is blocked.");
  const rawPhone = contact.phones.find((p) => p.isPrimary)?.number ?? contact.phones[0]?.number;
  const to = rawPhone ? normalizePhone(rawPhone) : null;
  if (!to) throw new CallBlockedError(rawPhone ? "The contact's phone number could not be read." : "The contact has no phone number.");

  const provider = voiceProvider();
  const from = agent?.twilioNumber ?? process.env.TWILIO_FROM_NUMBER ?? "+10000000000";
  const agentNumber = agent?.phone ? normalizePhone(agent.phone) ?? undefined : undefined;
  if (provider.name !== "mock" && !agentNumber) throw new CallBlockedError("Your profile has no phone number. The call rings your phone first, then the seller. An admin can add it under Settings, Team.");

  const [row] = await db.insert(calls).values({ orgId: session.orgId, leadId: lead.id, contactId: contact.id, direction: "out", fromAddr: from, toAddr: to, provider: provider.name, status: "queued", placedBy: session.profileId }).returning();
  let result: StartCallResult;
  try {
    result = await provider.startCall({ from, to, agentNumber, statusCallbackUrl: process.env.APP_URL ? `${process.env.APP_URL}/api/webhooks/twilio/voice-status` : undefined });
  } catch (err) {
    console.error("[voice] startCall failed", err);
    result = { providerCallId: "", status: "failed", error: "The voice provider could not be reached." };
  }
  const now = new Date();
  const ended = TERMINAL_CALL_STATUSES.includes(result.status);
  const [updated] = await db.update(calls).set({ providerCallId: result.providerCallId || null, status: result.status, startedAt: now, endedAt: ended ? now : null }).where(and(eq(calls.id, row!.id), eq(calls.orgId, session.orgId))).returning();
  if (result.status === "failed") return { call: updated!, provider: provider.name, error: result.error ?? "The call could not be placed." };

  const text = provider.name === "mock" ? `Mock call to ${to}. Voice calling is not connected, so no phone rang.` : `Called ${to}`;
  await logCallActivity(db, session.orgId, lead.id, session.profileId, { text, direction: "out", callId: row!.id, provider: provider.name, status: result.status });
  return { call: updated!, provider: provider.name, error: null };
}

/**
 * Checks a browser softphone call before the TwiML connects it, then logs it.
 * Only a number on a contact in the agent's own workspace can be dialed, so a leaked token is not an open phone line.
 */
export async function connectBrowserCall(input: { identity: string; to: string; providerCallId: string | null; provider: string }): Promise<{ ok: true; to: string; callerId: string } | { ok: false; reason: string }> {
  const db = await getDb();
  const profileId = profileIdFromIdentity(input.identity);
  const to = normalizePhone(input.to);
  const key = phoneMatchKey(to);
  if (!profileId || !to || !key) return { ok: false, reason: "That number could not be read." };
  const agent = await db.query.profiles.findFirst({ where: and(eq(profiles.id, profileId), eq(profiles.active, true)) });
  if (!agent || agent.role === "viewer") return { ok: false, reason: "This user cannot place calls." };
  const found = await db.select().from(contacts).where(and(eq(contacts.orgId, agent.orgId), sql`exists (select 1 from jsonb_array_elements(${contacts.phones}) p where right(regexp_replace(p->>'number', '[^0-9]', '', 'g'), 10) = ${key})`)).orderBy(desc(contacts.createdAt)).limit(20);
  const matches = found.filter((c) => c.phones.some((p) => phonesMatch(p.number, to)));
  if (matches.length === 0) return { ok: false, reason: "That number is not on a contact in this workspace." };
  // One do not contact flag on the number blocks it, even when another contact shares the number.
  if (matches.some((c) => c.doNotContact)) return { ok: false, reason: "This contact is marked do not contact." };
  const contact = matches[0]!;
  const lead = await db.query.leads.findFirst({ where: and(eq(leads.primaryContactId, contact.id), eq(leads.orgId, agent.orgId)), orderBy: desc(leads.createdAt) });
  const callerId = agent.twilioNumber ?? process.env.TWILIO_FROM_NUMBER;
  if (!callerId) return { ok: false, reason: "No caller ID number is set up." };
  const [row] = await db.insert(calls).values({ orgId: agent.orgId, leadId: lead?.id ?? null, contactId: contact.id, direction: "out", fromAddr: callerId, toAddr: to, provider: input.provider, providerCallId: input.providerCallId, status: "ringing", startedAt: new Date(), placedBy: agent.id }).returning();
  if (lead) await logCallActivity(db, agent.orgId, lead.id, agent.id, { text: `Called ${to}`, direction: "out", callId: row!.id, provider: input.provider, status: "ringing" });
  return { ok: true, to, callerId };
}

/** Status webhook. Matches on the provider call id. A late "ringing" never reopens a call that already ended. */
export async function recordCallStatus(providerCallId: string, status: CallStatus, durationSeconds: number | null, recordingUrl: string | null): Promise<boolean> {
  if (!providerCallId) return false;
  const db = await getDb();
  const row = await db.query.calls.findFirst({ where: eq(calls.providerCallId, providerCallId) });
  if (!row) return false;
  const wasEnded = TERMINAL_CALL_STATUSES.includes(row.status);
  const isEnded = TERMINAL_CALL_STATUSES.includes(status);
  const now = new Date();
  await db.update(calls).set({
    status: wasEnded && !isEnded ? row.status : status,
    startedAt: row.startedAt ?? (status === "in_progress" ? now : null),
    endedAt: row.endedAt ?? (isEnded ? now : null),
    durationSeconds: durationSeconds ?? row.durationSeconds,
    recordingUrl: recordingUrl ?? row.recordingUrl,
  }).where(eq(calls.id, row.id));
  return true;
}
