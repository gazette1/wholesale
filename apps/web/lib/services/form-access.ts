import { createHash, randomBytes, randomInt } from "node:crypto";
import { cookies, headers } from "next/headers";
import { and, eq, gt, inArray, isNotNull, isNull, like, lt, or, sql } from "drizzle-orm";
import {
  auditLog, buyers, contacts, documents, formComments, formEvents, formExternalParties, formEventKindEnum, formPurgeRequests, formSubmissions,
  formTaskAssignees, formTasks, formVersions, forms, orgs, profiles,
} from "@dealcalc/db";
import { emailProvider, fileStorage, normalizePhone, safeEqual, smsProvider } from "@dealcalc/integrations";
import { orderedSections, parseDefinition, formSettingsSchema } from "@dealcalc/forms";
import { getDb } from "../db";
import { isEmail, isUuid } from "../safe";
import type { ExternalActor, ProfileActor } from "../forms/actor";
import { startPublicSubmission } from "./forms";

type Db = Awaited<ReturnType<typeof getDb>>;
type EventKind = (typeof formEventKindEnum.enumValues)[number];
type Party = typeof formExternalParties.$inferSelect;

export const FILL_COOKIE = "form_fill";
export const FILL_PENDING_COOKIE = "form_fill_pending";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const DEFAULT_EXPIRY_DAYS = 14;
const CODE_TTL_MS = 10 * 60_000;
const CODE_MAX_ATTEMPTS = 5;
const CODE_MAX_SENDS_PER_HOUR = 5;
const CODE_MIN_GAP_MS = 30_000;
const PUBLIC_LINK_MAX_SENDS_PER_HOUR = 30;
const HOUR_MS = 3_600_000;
const SESSION_MS = 12 * HOUR_MS;
const PENDING_MS = 30 * 60_000;
const REMOVED = "Removed on request";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const codeHashOf = (partyId: string, code: string) => sha256(`${partyId}:${code}`);

async function baseUrl(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) return `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  } catch { /* not inside a request */ }
  return "http://localhost:3000";
}

async function logEvent(db: Db, e: { orgId: string; formId?: string | null; submissionId?: string | null; actorId?: string | null; partyId?: string | null; label?: string | null; kind: EventKind; before?: unknown; after?: unknown }) {
  await db.insert(formEvents).values({
    orgId: e.orgId, formId: e.formId ?? null, submissionId: e.submissionId ?? null, actorId: e.actorId ?? null, actorExternalPartyId: e.partyId ?? null,
    actorLabel: e.label ?? null, kind: e.kind, before: (e.before ?? null) as never, after: (e.after ?? null) as never,
  });
}

async function auditEntry(db: Db, orgId: string, actorId: string | null, entityType: string, entityId: string, action: string, before?: unknown, after?: unknown) {
  await db.insert(auditLog).values({ orgId, actorId, entityType, entityId, action, before: (before ?? null) as never, after: (after ?? null) as never });
}

const labelOf = (p: Pick<Party, "email" | "phone">) => p.email ?? p.phone ?? "external";
const isParent = (p: Party) => p.kind === "public" && !p.submissionId && !p.email && !p.phone;

function partyState(p: Party, now = new Date()): "ok" | "expired" | "revoked" | "used" {
  if (p.revokedAt || p.archivedAt) return "revoked";
  if (p.expiresAt && p.expiresAt <= now) return "expired";
  if (p.singleUse && p.usedAt) return "used";
  return "ok";
}

async function partyByToken(db: Db, token: string): Promise<Party | null> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const hash = sha256(token);
  const [row] = await db.select().from(formExternalParties).where(eq(formExternalParties.tokenHash, hash)).limit(1);
  return row && safeEqual(row.tokenHash, hash) ? row : null;
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `***-***-${digits.slice(-4)}`;
}

async function setCookie(name: string, value: string, path: string, maxAgeSeconds: number) {
  (await cookies()).set(name, value, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path, maxAge: maxAgeSeconds });
}

/** Mock providers record sends in memory only. This is the only place a code reaches a log, and only outside production. */
function isMockMessaging(): boolean {
  return smsProvider().name === "mock" && emailProvider().name === "mock" && process.env.NODE_ENV !== "production";
}

export type FillLinkState = {
  status: "ok" | "expired" | "revoked" | "used" | "not_found";
  kind: "invite" | "public" | null;
  maskedEmail?: string;
  maskedPhone?: string;
  formName: string;
  orgName: string;
};

/** What the fill page needs before sign in. Nothing else about the party leaves the server. */
export async function resolveFillLink(token: string): Promise<FillLinkState> {
  const db = await getDb();
  const p = await partyByToken(db, token);
  if (!p) return { status: "not_found", kind: null, formName: "", orgName: "" };
  const [form, org] = await Promise.all([
    db.query.forms.findFirst({ where: and(eq(forms.id, p.formId), eq(forms.orgId, p.orgId)) }),
    db.query.orgs.findFirst({ where: eq(orgs.id, p.orgId) }),
  ]);
  const state = partyState(p);
  const isPublic = isParent(p);
  return {
    status: state, kind: isPublic ? "public" : "invite",
    ...(!isPublic && p.email ? { maskedEmail: maskEmail(p.email) } : {}), ...(!isPublic && p.phone ? { maskedPhone: maskPhone(p.phone) } : {}),
    formName: form?.name ?? "", orgName: org?.name ?? "",
  };
}

/** The signed in outside person for this link, or null. Reads the path scoped session cookie. */
export async function getExternalActor(token: string): Promise<ExternalActor | null> {
  const db = await getDb();
  const p = await partyByToken(db, token);
  if (!p || !p.submissionId || p.kind !== "invite" || partyState(p) !== "ok") return null;
  const session = (await cookies()).get(FILL_COOKIE)?.value;
  if (!session || !p.sessionHash || !p.verifiedAt || !p.sessionExpiresAt || p.sessionExpiresAt <= new Date()) return null;
  if (!safeEqual(sha256(session), p.sessionHash)) return null;
  return { kind: "external", orgId: p.orgId, partyId: p.id, label: labelOf(p), submissionId: p.submissionId, sectionKeys: p.sectionKeys };
}

// ---------------------------------------------------------------- sending

type Destination = { channel: "email" | "sms"; to: string };

async function deliver(dest: Destination, subject: string, text: string): Promise<boolean> {
  try {
    const r = dest.channel === "email" ? await emailProvider().sendEmail({ to: dest.to, subject, text }) : await smsProvider().sendSms({ to: dest.to, body: text });
    return r.status !== "failed";
  } catch (err) {
    console.error("[form access send]", err instanceof Error ? err.message : err);
    return false;
  }
}

type Consent = { doNotContact: boolean; smsConsent: string; emailConsent: string } | null;
function channelAllowed(channel: "email" | "sms", consent: Consent): boolean {
  if (!consent) return true;
  if (consent.doNotContact) return false;
  return channel === "sms" ? consent.smsConsent !== "opted_out" : consent.emailConsent !== "opted_out";
}

async function consentFor(db: Db, p: Party): Promise<Consent> {
  if (!p.contactId) return null;
  const c = await db.query.contacts.findFirst({ where: and(eq(contacts.id, p.contactId), eq(contacts.orgId, p.orgId)) });
  return c ? { doNotContact: c.doNotContact, smsConsent: c.smsConsent, emailConsent: c.emailConsent } : null;
}

function pickDestination(email: string | null, phone: string | null, preferred: "email" | "sms" | undefined, consent: Consent): Destination | null {
  const options: Destination[] = [];
  if (email && channelAllowed("email", consent)) options.push({ channel: "email", to: email });
  const normalized = phone ? normalizePhone(phone) : null;
  if (normalized && channelAllowed("sms", consent)) options.push({ channel: "sms", to: normalized });
  return options.find((o) => o.channel === preferred) ?? options[0] ?? null;
}

// ---------------------------------------------------------------- invites

async function assignToOpenTasks(db: Db, orgId: string, submissionId: string, partyId: string, sectionKeys: string[]): Promise<void> {
  if (sectionKeys.length === 0) return;
  const tasks = await db.select({ id: formTasks.id }).from(formTasks)
    .where(and(eq(formTasks.orgId, orgId), eq(formTasks.submissionId, submissionId), inArray(formTasks.sectionKey, sectionKeys), eq(formTasks.status, "open")));
  for (const t of tasks) {
    const existing = await db.query.formTaskAssignees.findFirst({ where: and(eq(formTaskAssignees.taskId, t.id), eq(formTaskAssignees.externalPartyId, partyId)) });
    if (!existing) await db.insert(formTaskAssignees).values({ orgId, taskId: t.id, externalPartyId: partyId });
  }
}

function requireContributor(actor: ProfileActor) {
  if (actor.kind !== "profile" || actor.role === "viewer") throw new Error("Your role cannot invite outside people.");
}

export async function createInvite(actor: ProfileActor, input: {
  submissionId: string; sectionKeys: string[]; name?: string; email?: string; phone?: string; contactId?: string; buyerId?: string; expiresInDays?: number; singleUse?: boolean;
}): Promise<{ partyId: string; url: string }> {
  requireContributor(actor);
  if (!isUuid(input.submissionId)) throw new Error("Submission not found.");
  const db = await getDb();
  const submission = await db.query.formSubmissions.findFirst({ where: and(eq(formSubmissions.id, input.submissionId), eq(formSubmissions.orgId, actor.orgId)) });
  if (!submission || submission.archivedAt || submission.status === "archived") throw new Error("Submission not found.");
  const version = await db.query.formVersions.findFirst({ where: and(eq(formVersions.id, submission.versionId), eq(formVersions.orgId, actor.orgId)) });
  if (!version) throw new Error("Submission not found.");
  const def = parseDefinition(version.definition);

  const keys = [...new Set(input.sectionKeys)];
  if (keys.length === 0) throw new Error("Choose at least one section for the invite.");
  for (const k of keys) {
    const section = def.sections.find((s) => s.key === k);
    if (!section) throw new Error("One of those sections does not exist.");
    if (!section.allowExternal) throw new Error(`The section "${section.title}" does not allow outside people.`);
  }

  let email = input.email?.trim().toLowerCase() || null;
  let phone = input.phone?.trim() || null;
  let consent: Consent = null;
  let name = input.name?.trim().slice(0, 120) || null;
  if (input.contactId) {
    if (!isUuid(input.contactId)) throw new Error("Contact not found.");
    const c = await db.query.contacts.findFirst({ where: and(eq(contacts.id, input.contactId), eq(contacts.orgId, actor.orgId)) });
    if (!c) throw new Error("Contact not found.");
    email ??= (c.emails.find((e) => e.isPrimary) ?? c.emails[0])?.address?.toLowerCase() ?? null;
    phone ??= (c.phones.find((p) => p.isPrimary) ?? c.phones[0])?.number ?? null;
    name ??= [c.firstName, c.lastName].filter(Boolean).join(" ");
    consent = { doNotContact: c.doNotContact, smsConsent: c.smsConsent, emailConsent: c.emailConsent };
  }
  if (input.buyerId) {
    if (!isUuid(input.buyerId)) throw new Error("Buyer not found.");
    const b = await db.query.buyers.findFirst({ where: and(eq(buyers.id, input.buyerId), eq(buyers.orgId, actor.orgId)) });
    if (!b) throw new Error("Buyer not found.");
    email ??= (b.emails.find((e) => e.isPrimary) ?? b.emails[0])?.address?.toLowerCase() ?? null;
    phone ??= (b.phones.find((p) => p.isPrimary) ?? b.phones[0])?.number ?? null;
    name ??= [b.firstName, b.lastName].filter(Boolean).join(" ");
  }
  if (email && !isEmail(email)) throw new Error("Enter a valid email address.");
  const normalizedPhone = phone ? normalizePhone(phone) : null;
  if (phone && !normalizedPhone) throw new Error("Enter a valid phone number.");
  if (!email && !normalizedPhone) throw new Error("An invite needs an email address or a phone number.");

  const days = Math.min(Math.max(Math.trunc(input.expiresInDays ?? DEFAULT_EXPIRY_DAYS), 1), 90);
  const token = newToken();
  const [party] = await db.insert(formExternalParties).values({
    orgId: actor.orgId, formId: submission.formId, submissionId: submission.id, kind: "invite", contactId: input.contactId ?? null, buyerId: input.buyerId ?? null,
    name, email, phone: normalizedPhone, sectionKeys: keys, tokenHash: sha256(token), expiresAt: new Date(Date.now() + days * 86_400_000),
    singleUse: input.singleUse ?? false, invitedBy: actor.profileId,
  }).returning();
  await assignToOpenTasks(db, actor.orgId, submission.id, party!.id, keys);

  const url = `${await baseUrl()}/fill/${token}`;
  const [form, org] = await Promise.all([
    db.query.forms.findFirst({ where: and(eq(forms.id, submission.formId), eq(forms.orgId, actor.orgId)) }),
    db.query.orgs.findFirst({ where: eq(orgs.id, actor.orgId) }),
  ]);
  // When consent blocks every channel the party is still created and the link is returned, so the inviter can share it another way.
  const dest = pickDestination(email, normalizedPhone, undefined, consent);
  if (dest) {
    const lead = `${org?.name ?? "A team"} asked you to complete part of "${form?.name ?? "a form"}".`;
    await deliver(dest, `${org?.name ?? "Form"}: please complete your section`, `${lead} Open this link: ${url} You will be asked for a one-time code.`);
  }
  await logEvent(db, { orgId: actor.orgId, formId: submission.formId, submissionId: submission.id, actorId: actor.profileId, partyId: party!.id, label: actor.label, kind: "external_invited", after: { sectionKeys: keys, singleUse: input.singleUse ?? false, expiresInDays: days, sent: Boolean(dest) } });
  await auditEntry(db, actor.orgId, actor.profileId, "form_external_party", party!.id, "create", null, { submissionId: submission.id, sectionKeys: keys });
  return { partyId: party!.id, url };
}

export async function createPublicLink(actor: ProfileActor, input: { formId: string; expiresInDays?: number }): Promise<{ partyId: string; url: string }> {
  if (actor.kind !== "profile" || !actor.isFormAdmin) throw new Error("Only form admins create public links.");
  if (!isUuid(input.formId)) throw new Error("Form not found.");
  const db = await getDb();
  const form = await db.query.forms.findFirst({ where: and(eq(forms.id, input.formId), eq(forms.orgId, actor.orgId)) });
  if (!form || form.archivedAt) throw new Error("Form not found.");
  if (!formSettingsSchema.parse(form.settings ?? {}).allowPublicLink) throw new Error("Turn on public links in the form settings first.");
  if (form.status !== "published" || !form.latestVersionId) throw new Error("Publish the form before creating a public link.");
  const days = Math.min(Math.max(Math.trunc(input.expiresInDays ?? DEFAULT_EXPIRY_DAYS), 1), 365);
  const token = newToken();
  const [party] = await db.insert(formExternalParties).values({
    orgId: actor.orgId, formId: form.id, submissionId: null, kind: "public", sectionKeys: [], tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + days * 86_400_000), invitedBy: actor.profileId,
  }).returning();
  await logEvent(db, { orgId: actor.orgId, formId: form.id, actorId: actor.profileId, partyId: party!.id, label: actor.label, kind: "external_invited", after: { kind: "public", expiresInDays: days } });
  await auditEntry(db, actor.orgId, actor.profileId, "form_external_party", party!.id, "create", null, { formId: form.id, kind: "public" });
  return { partyId: party!.id, url: `${await baseUrl()}/fill/${token}` };
}

export async function revokeParty(actor: ProfileActor, partyId: string): Promise<void> {
  requireContributor(actor);
  if (!isUuid(partyId)) throw new Error("Link not found.");
  const db = await getDb();
  const p = await db.query.formExternalParties.findFirst({ where: and(eq(formExternalParties.id, partyId), eq(formExternalParties.orgId, actor.orgId)) });
  if (!p) throw new Error("Link not found.");
  if (!(actor.isFormAdmin || actor.role === "admin" || p.invitedBy === actor.profileId)) throw new Error("Only the person who sent a link, or a form admin, can revoke it.");
  if (p.revokedAt) return;
  await db.update(formExternalParties).set({ revokedAt: new Date(), sessionHash: null, sessionExpiresAt: null, codeHash: null, codeExpiresAt: null })
    .where(and(eq(formExternalParties.id, p.id), eq(formExternalParties.orgId, actor.orgId)));
  await logEvent(db, { orgId: actor.orgId, formId: p.formId, submissionId: p.submissionId, actorId: actor.profileId, partyId: p.id, label: actor.label, kind: "external_revoked" });
  await auditEntry(db, actor.orgId, actor.profileId, "form_external_party", p.id, "revoke");
}

// ---------------------------------------------------------------- one-time codes

export type CodeResult = { ok: boolean; message: string };
const SENT_MESSAGE = "If that address can receive a code, one is on its way. It expires in 10 minutes.";
const UNAVAILABLE = "This link is not available.";

/** Finds or creates the row that holds code state for a public link visitor. The row is bound to a browser by the pending cookie. */
async function pendingVisitorRow(db: Db, parent: Party, token: string, contact: { email: string | null; phone: string | null }): Promise<Party> {
  const match = contact.email ? eq(formExternalParties.email, contact.email) : eq(formExternalParties.phone, contact.phone!);
  const [existing] = await db.select().from(formExternalParties).where(and(
    eq(formExternalParties.orgId, parent.orgId), eq(formExternalParties.formId, parent.formId), eq(formExternalParties.kind, "public"),
    isNull(formExternalParties.submissionId), isNull(formExternalParties.revokedAt), match,
  )).limit(1);
  let row = existing;
  if (!row) {
    [row] = await db.insert(formExternalParties).values({
      orgId: parent.orgId, formId: parent.formId, kind: "public", email: contact.email, phone: contact.phone, sectionKeys: [], tokenHash: sha256(newToken()), expiresAt: parent.expiresAt,
    }).returning();
  }
  const handle = newToken();
  await db.update(formExternalParties).set({ sessionHash: sha256(handle), sessionExpiresAt: new Date(Date.now() + PENDING_MS) }).where(and(eq(formExternalParties.id, row!.id), eq(formExternalParties.orgId, parent.orgId)));
  await setCookie(FILL_PENDING_COOKIE, handle, `/fill/${token}`, PENDING_MS / 1000);
  return { ...row!, sessionHash: sha256(handle) };
}

export async function requestCode(token: string, channel: "email" | "sms", contact?: string): Promise<CodeResult> {
  const db = await getDb();
  const link = await partyByToken(db, token);
  if (!link || partyState(link) !== "ok") return { ok: false, message: UNAVAILABLE };
  const now = new Date();
  const preferred = channel === "sms" ? "sms" : "email";

  let target: Party;
  let dest: Destination | null;
  if (isParent(link)) {
    const raw = (contact ?? "").trim();
    const email = preferred === "email" ? raw.toLowerCase() : "";
    const phone = preferred === "sms" ? normalizePhone(raw) : null;
    if (preferred === "email" ? !isEmail(email) : !phone) return { ok: false, message: preferred === "email" ? "Enter a valid email address." : "Enter a valid phone number." };
    // One public link cannot be used to send an unlimited number of codes to other people.
    const w = link.codeWindowStartedAt && now.getTime() - link.codeWindowStartedAt.getTime() < HOUR_MS ? link.codeWindowStartedAt : now;
    const used = w === link.codeWindowStartedAt ? link.codeSendCount : 0;
    if (used >= PUBLIC_LINK_MAX_SENDS_PER_HOUR) return { ok: false, message: "Too many codes were requested. Try again later." };
    await db.update(formExternalParties).set({ codeWindowStartedAt: w, codeSendCount: used + 1 }).where(and(eq(formExternalParties.id, link.id), eq(formExternalParties.orgId, link.orgId)));
    target = await pendingVisitorRow(db, link, token, { email: preferred === "email" ? email : null, phone: preferred === "sms" ? phone : null });
    dest = preferred === "email" ? { channel: "email", to: email } : { channel: "sms", to: phone! };
  } else {
    target = link;
    const wanted = (contact ?? "").trim();
    if (wanted) {
      const sameEmail = Boolean(target.email) && wanted.toLowerCase() === target.email;
      const samePhone = Boolean(target.phone) && normalizePhone(wanted) === target.phone;
      if (!sameEmail && !samePhone) return { ok: true, message: SENT_MESSAGE };
    }
    dest = pickDestination(target.email, target.phone, preferred, await consentFor(db, target));
    if (!dest) return { ok: true, message: SENT_MESSAGE };
  }

  const windowStart = target.codeWindowStartedAt && now.getTime() - target.codeWindowStartedAt.getTime() < HOUR_MS ? target.codeWindowStartedAt : now;
  const sends = windowStart === target.codeWindowStartedAt ? target.codeSendCount : 0;
  if (sends >= CODE_MAX_SENDS_PER_HOUR) return { ok: false, message: "Too many codes were requested. Try again in an hour." };
  if (target.lastCodeSentAt && now.getTime() - target.lastCodeSentAt.getTime() < CODE_MIN_GAP_MS) return { ok: false, message: "Wait 30 seconds before asking for another code." };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const [claimed] = await db.update(formExternalParties).set({
    codeHash: codeHashOf(target.id, code), codeExpiresAt: new Date(now.getTime() + CODE_TTL_MS), codeAttempts: 0, codeSendCount: sends + 1, codeWindowStartedAt: windowStart, lastCodeSentAt: now,
  }).where(and(
    eq(formExternalParties.id, target.id), eq(formExternalParties.orgId, target.orgId),
    target.lastCodeSentAt ? eq(formExternalParties.lastCodeSentAt, target.lastCodeSentAt) : isNull(formExternalParties.lastCodeSentAt),
  )).returning();
  if (!claimed) return { ok: false, message: "Wait 30 seconds before asking for another code." };

  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, target.orgId) });
  const text = `${org?.name ?? "Your team"}: your one-time code is ${code}. It expires in 10 minutes. Do not share it.`;
  if (isMockMessaging()) console.log(`[forms] mock one-time code partyId=${target.id} to=${dest.to} code=${code}`);
  const sent = await deliver(dest, "Your one-time code", text);
  if (!sent) return { ok: false, message: "We could not send a code. Try again shortly." };
  return { ok: true, message: SENT_MESSAGE };
}

export type VerifyResult = { ok: true; redirectTo: string } | { ok: false; message: string };

export async function verifyCode(token: string, code: string): Promise<VerifyResult> {
  if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) return { ok: false, message: "Enter the 6 digit code." };
  const clean = code.trim();
  const db = await getDb();
  const link = await partyByToken(db, token);
  if (!link || partyState(link) !== "ok") return { ok: false, message: UNAVAILABLE };
  const now = new Date();

  let row: Party | undefined = link;
  if (isParent(link)) {
    const handle = (await cookies()).get(FILL_PENDING_COOKIE)?.value;
    row = undefined;
    if (handle) {
      const hash = sha256(handle);
      [row] = await db.select().from(formExternalParties).where(and(
        eq(formExternalParties.orgId, link.orgId), eq(formExternalParties.formId, link.formId), eq(formExternalParties.kind, "public"), isNull(formExternalParties.submissionId), isNull(formExternalParties.revokedAt), eq(formExternalParties.sessionHash, hash),
      )).limit(1);
      if (row && (!row.sessionHash || !safeEqual(row.sessionHash, hash) || !row.sessionExpiresAt || row.sessionExpiresAt <= now)) row = undefined;
    }
    if (!row || row.id === link.id) return { ok: false, message: "Request a new code first." };
  }

  // The attempt is counted before the comparison, so parallel guesses cannot exceed the limit.
  const [attempt] = await db.update(formExternalParties).set({ codeAttempts: sql`${formExternalParties.codeAttempts} + 1` }).where(and(
    eq(formExternalParties.id, row.id), eq(formExternalParties.orgId, row.orgId), isNotNull(formExternalParties.codeHash), gt(formExternalParties.codeExpiresAt, now), lt(formExternalParties.codeAttempts, CODE_MAX_ATTEMPTS),
  )).returning();
  if (!attempt || !attempt.codeHash) return { ok: false, message: "That code has expired or is no longer valid. Request a new one." };
  if (!safeEqual(attempt.codeHash, codeHashOf(attempt.id, clean))) {
    if (attempt.codeAttempts >= CODE_MAX_ATTEMPTS) {
      await db.update(formExternalParties).set({ codeHash: null, codeExpiresAt: null }).where(and(eq(formExternalParties.id, attempt.id), eq(formExternalParties.orgId, attempt.orgId)));
      return { ok: false, message: "Too many incorrect attempts. Request a new code." };
    }
    return { ok: false, message: "That code is not correct." };
  }

  // A code works once: the update only matches while the hash is still stored.
  const sessionToken = newToken();
  const sessionPatch = { codeHash: null, codeExpiresAt: null, verifiedAt: now, sessionHash: sha256(sessionToken), sessionExpiresAt: new Date(now.getTime() + SESSION_MS) };
  let finalToken = token;
  let finalRow: Party = attempt;

  if (isParent(link)) {
    const form = await db.query.forms.findFirst({ where: and(eq(forms.id, link.formId), eq(forms.orgId, link.orgId)) });
    if (!form || form.archivedAt || form.status !== "published" || !form.latestVersionId || !formSettingsSchema.parse(form.settings ?? {}).allowPublicLink) return { ok: false, message: UNAVAILABLE };
    const version = await db.query.formVersions.findFirst({ where: and(eq(formVersions.id, form.latestVersionId), eq(formVersions.orgId, link.orgId)) });
    const first = version ? orderedSections(parseDefinition(version.definition)).find((s) => s.allowExternal) : undefined;
    if (!first) return { ok: false, message: UNAVAILABLE };
    const [consumed] = await db.update(formExternalParties).set({ codeHash: null, codeExpiresAt: null, sectionKeys: [first.key] }).where(and(eq(formExternalParties.id, attempt.id), eq(formExternalParties.orgId, attempt.orgId), eq(formExternalParties.codeHash, attempt.codeHash))).returning();
    if (!consumed) return { ok: false, message: "That code has expired or is no longer valid. Request a new one." };

    let submissionId: string;
    try {
      ({ submissionId } = await startPublicSubmission({ orgId: link.orgId, formId: form.id, partyId: attempt.id, label: labelOf(attempt) }));
    } catch (err) {
      console.error("[form public start]", err instanceof Error ? err.message : err);
      return { ok: false, message: "We could not start this form. Try again later." };
    }
    finalToken = newToken();
    const [converted] = await db.update(formExternalParties).set({
      ...sessionPatch, submissionId, kind: "invite", sectionKeys: [first.key], tokenHash: sha256(finalToken), expiresAt: new Date(now.getTime() + DEFAULT_EXPIRY_DAYS * 86_400_000), singleUse: false,
    }).where(and(eq(formExternalParties.id, attempt.id), eq(formExternalParties.orgId, attempt.orgId))).returning();
    finalRow = converted!;
    await assignToOpenTasks(db, link.orgId, submissionId, finalRow.id, [first.key]);
    await logEvent(db, { orgId: link.orgId, formId: form.id, submissionId, partyId: finalRow.id, label: labelOf(finalRow), kind: "external_invited", after: { kind: "public", sectionKeys: [first.key] } });
    (await cookies()).delete({ name: FILL_PENDING_COOKIE, path: `/fill/${token}` });
  } else {
    const [ok] = await db.update(formExternalParties).set(sessionPatch).where(and(eq(formExternalParties.id, attempt.id), eq(formExternalParties.orgId, attempt.orgId), eq(formExternalParties.codeHash, attempt.codeHash))).returning();
    if (!ok) return { ok: false, message: "That code has expired or is no longer valid. Request a new one." };
  }

  await setCookie(FILL_COOKIE, sessionToken, `/fill/${finalToken}`, SESSION_MS / 1000);
  await logEvent(db, { orgId: finalRow.orgId, formId: finalRow.formId, submissionId: finalRow.submissionId, partyId: finalRow.id, label: labelOf(finalRow), kind: "external_signin" });
  return { ok: true, redirectTo: `/fill/${finalToken}` };
}

/** Called after an external person completes a section. A single use link closes once all of their sections are done. */
export async function markUsedIfFinished(actor: ExternalActor): Promise<void> {
  const db = await getDb();
  const p = await db.query.formExternalParties.findFirst({ where: and(eq(formExternalParties.id, actor.partyId), eq(formExternalParties.orgId, actor.orgId)) });
  if (!p || !p.singleUse || p.usedAt || !p.submissionId) return;
  const tasks = await db.select({ status: formTasks.status }).from(formTasks)
    .where(and(eq(formTasks.orgId, actor.orgId), eq(formTasks.submissionId, p.submissionId), inArray(formTasks.sectionKey, p.sectionKeys)));
  if (tasks.length === 0 || tasks.some((t) => t.status !== "completed" && t.status !== "skipped")) return;
  await db.update(formExternalParties).set({ usedAt: new Date(), sessionHash: null, sessionExpiresAt: null }).where(and(eq(formExternalParties.id, p.id), eq(formExternalParties.orgId, actor.orgId)));
}

// ---------------------------------------------------------------- purge

function requireAdmin(actor: ProfileActor) {
  if (actor.kind !== "profile" || actor.role !== "admin") throw new Error("Only admins handle purge requests.");
}

export async function requestPurge(actor: ProfileActor, input: { targetType: "external_party" | "contact" | "buyer"; targetId: string; requestReference: string }): Promise<{ requestId: string }> {
  requireAdmin(actor);
  const reference = (input.requestReference ?? "").trim().slice(0, 200);
  if (reference.length < 3) throw new Error("Enter the reference for this request, such as a ticket or email subject.");
  if (!isUuid(input.targetId) || !["external_party", "contact", "buyer"].includes(input.targetType)) throw new Error("Person not found.");
  const db = await getDb();
  const exists = input.targetType === "external_party"
    ? await db.query.formExternalParties.findFirst({ where: and(eq(formExternalParties.id, input.targetId), eq(formExternalParties.orgId, actor.orgId)) })
    : input.targetType === "contact"
      ? await db.query.contacts.findFirst({ where: and(eq(contacts.id, input.targetId), eq(contacts.orgId, actor.orgId)) })
      : await db.query.buyers.findFirst({ where: and(eq(buyers.id, input.targetId), eq(buyers.orgId, actor.orgId)) });
  if (!exists) throw new Error("Person not found.");
  const pending = await db.query.formPurgeRequests.findFirst({ where: and(eq(formPurgeRequests.orgId, actor.orgId), eq(formPurgeRequests.targetType, input.targetType), eq(formPurgeRequests.targetId, input.targetId), eq(formPurgeRequests.status, "pending")) });
  if (pending) throw new Error("A purge request for this person is already waiting for approval.");
  const [req] = await db.insert(formPurgeRequests).values({ orgId: actor.orgId, targetType: input.targetType, targetId: input.targetId, requestReference: reference, requestedBy: actor.profileId }).returning();
  await auditEntry(db, actor.orgId, actor.profileId, "form_purge_request", req!.id, "request", null, { targetType: input.targetType, targetId: input.targetId, reference });
  return { requestId: req!.id };
}

export async function cancelPurge(actor: ProfileActor, requestId: string): Promise<void> {
  requireAdmin(actor);
  if (!isUuid(requestId)) throw new Error("Request not found.");
  const db = await getDb();
  const [req] = await db.update(formPurgeRequests).set({ status: "cancelled" })
    .where(and(eq(formPurgeRequests.id, requestId), eq(formPurgeRequests.orgId, actor.orgId), eq(formPurgeRequests.status, "pending"))).returning();
  if (!req) throw new Error("That request is not waiting for approval.");
  await auditEntry(db, actor.orgId, actor.profileId, "form_purge_request", req.id, "cancel");
}

const asIds = (v: unknown): string[] => (Array.isArray(v) ? v : v == null ? [] : [v]).filter((x): x is string => typeof x === "string" && isUuid(x));

export async function approvePurge(actor: ProfileActor, requestId: string): Promise<{ summary: Record<string, number> }> {
  requireAdmin(actor);
  if (!isUuid(requestId)) throw new Error("Request not found.");
  const db = await getDb();
  const req = await db.query.formPurgeRequests.findFirst({ where: and(eq(formPurgeRequests.id, requestId), eq(formPurgeRequests.orgId, actor.orgId)) });
  if (!req || req.status !== "pending") throw new Error("That request is not waiting for approval.");
  if (req.requestedBy === actor.profileId) throw new Error("A different admin must approve this request.");
  const orgId = actor.orgId;

  const parties = req.targetType === "external_party"
    ? await db.select().from(formExternalParties).where(and(eq(formExternalParties.orgId, orgId), eq(formExternalParties.id, req.targetId)))
    : await db.select().from(formExternalParties).where(and(eq(formExternalParties.orgId, orgId), req.targetType === "contact" ? eq(formExternalParties.contactId, req.targetId) : eq(formExternalParties.buyerId, req.targetId)));
  const partyIds = parties.map((p) => p.id);

  const summary: Record<string, number> = { answers: 0, comments: 0, events: 0, documents: 0, external_parties: 0, twilio_records: 0 };

  if (partyIds.length > 0) {
    // Documents they uploaded: marked in the storage path, or attached to their comments.
    const docIds = new Set<string>();
    const comments = await db.select().from(formComments).where(and(eq(formComments.orgId, orgId), inArray(formComments.authorExternalPartyId, partyIds)));
    for (const c of comments) asIds(c.documentIds).forEach((id) => docIds.add(id));
    const byPath = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.orgId, orgId), or(...partyIds.map((id) => like(documents.storagePath, `${orgId}/forms/%/ext-${id}/%`)))!));
    byPath.forEach((d) => docIds.add(d.id));
    const docs = docIds.size ? await db.select().from(documents).where(and(eq(documents.orgId, orgId), inArray(documents.id, [...docIds]), sql`${documents.submissionId} is not null`)) : [];
    // Files go first, as in deleteDocument. A retry after a failed transaction finds them already gone.
    for (const d of docs) if (d.storagePath.startsWith(`${orgId}/`)) await fileStorage().remove(d.storagePath).catch(() => {});

    type Tx = Db;
    await (db as unknown as { transaction: (fn: (tx: Tx) => Promise<void>) => Promise<void> }).transaction(async (tx) => {
      const answerEvents = await tx.select().from(formEvents).where(and(eq(formEvents.orgId, orgId), inArray(formEvents.actorExternalPartyId, partyIds), eq(formEvents.kind, "answer_changed")));
      const submissionIds = [...new Set([...answerEvents.map((e) => e.submissionId), ...parties.map((p) => p.submissionId)].filter((x): x is string => Boolean(x)))];
      const deletedDocIds = new Set(docs.map((d) => d.id));

      for (const sid of submissionIds) {
        const sub = await tx.query.formSubmissions.findFirst({ where: and(eq(formSubmissions.id, sid), eq(formSubmissions.orgId, orgId)) });
        if (!sub) continue;
        const answers = { ...sub.answers };
        let changed = false;
        const history = await tx.select().from(formEvents).where(and(eq(formEvents.orgId, orgId), eq(formEvents.submissionId, sid), eq(formEvents.kind, "answer_changed")));
        const latest = new Map<string, (typeof history)[number]>();
        for (const e of history) {
          if (!e.fieldKey) continue;
          const prior = latest.get(e.fieldKey);
          if (!prior || e.at >= prior.at) latest.set(e.fieldKey, e);
        }
        // Only a field whose most recent change was theirs is replaced. A later edit by a teammate stays.
        for (const [fieldKey, e] of latest) {
          if (e.actorExternalPartyId && partyIds.includes(e.actorExternalPartyId) && fieldKey in answers) {
            answers[fieldKey] = REMOVED; summary.answers! += 1; changed = true;
          }
        }
        for (const [k, v] of Object.entries(answers)) {
          if (Array.isArray(v) && v.some((x) => typeof x === "string" && deletedDocIds.has(x))) { answers[k] = v.filter((x) => !(typeof x === "string" && deletedDocIds.has(x))); changed = true; }
        }
        if (changed) await tx.update(formSubmissions).set({ answers }).where(and(eq(formSubmissions.id, sid), eq(formSubmissions.orgId, orgId)));
      }

      if (docs.length) {
        await tx.delete(documents).where(and(eq(documents.orgId, orgId), inArray(documents.id, docs.map((d) => d.id))));
        summary.documents = docs.length;
      }
      const delComments = await tx.delete(formComments).where(and(eq(formComments.orgId, orgId), inArray(formComments.authorExternalPartyId, partyIds))).returning();
      summary.comments = delComments.length;
      const delEvents = await tx.delete(formEvents).where(and(eq(formEvents.orgId, orgId), inArray(formEvents.actorExternalPartyId, partyIds))).returning();
      summary.events = delEvents.length;
      await tx.update(formSubmissions).set({ startedByExternalPartyId: null }).where(and(eq(formSubmissions.orgId, orgId), inArray(formSubmissions.startedByExternalPartyId, partyIds)));
      const delParties = await tx.delete(formExternalParties).where(and(eq(formExternalParties.orgId, orgId), inArray(formExternalParties.id, partyIds))).returning();
      summary.external_parties = delParties.length;

      await tx.insert(formEvents).values({ orgId, actorId: actor.profileId, kind: "purge", after: { requestId: req.id, ...summary } as never });
      await tx.update(formPurgeRequests).set({ status: "executed", executedAt: new Date(), approvedBy: actor.profileId, summary })
        .where(and(eq(formPurgeRequests.id, req.id), eq(formPurgeRequests.orgId, orgId), eq(formPurgeRequests.status, "pending")));
      await tx.insert(auditLog).values({ orgId, actorId: actor.profileId, entityType: "form_purge_request", entityId: req.id, action: "approve", before: null, after: summary as never });
    });
    return { summary };
  }

  // Nothing linked to this person in forms: close the request with zero counts.
  await db.update(formPurgeRequests).set({ status: "executed", executedAt: new Date(), approvedBy: actor.profileId, summary })
    .where(and(eq(formPurgeRequests.id, req.id), eq(formPurgeRequests.orgId, orgId), eq(formPurgeRequests.status, "pending")));
  await db.insert(formEvents).values({ orgId, actorId: actor.profileId, kind: "purge", after: { requestId: req.id, ...summary } as never });
  await auditEntry(db, orgId, actor.profileId, "form_purge_request", req.id, "approve", null, summary);
  return { summary };
}
