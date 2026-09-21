"use server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { apiKeys, webhookEndpoints, buyers, buyerCriteria } from "@dealcalc/db";
import { parseCsvRecords, parseLeadPayload, parseBuyerPayload, isWebhookEvent, SUBSCRIBABLE_EVENTS } from "@dealcalc/integrations";
import { getDb } from "../db";
import { requireSession } from "../auth";
import { audit } from "../audit";
import { generateApiKey, generateWebhookSecret, validateWebhookUrl, sendTestPing, emitEvents } from "../services/integrations";
import { createLeadFromPayload, createIntakeContext } from "../services/lead-intake";
import type { ActionResult } from "./leads";

export type CreateApiKeyResult = { ok: true; message?: string; id: string; key: string; prefix: string } | { ok: false; error: string };
export type ImportResult = { ok: true; message: string; total: number; created: number; duplicates: number; errors: number; errorMessages: string[] } | { ok: false; error: string };

const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_CSV_ROWS = 2000;
/** Above this many new records one import does not send per record webhooks, so a large file cannot flood receivers. */
const MAX_IMPORT_EVENTS = 100;

function admin(session: Awaited<ReturnType<typeof requireSession>>) {
  if (session.role !== "admin") throw new Error("Admins only.");
}

function fail(err: unknown, fallback: string): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : fallback };
}

/* API keys */

/** Creates a key and returns the raw value once. Only the SHA-256 hash is stored, so it cannot be shown again. */
export async function createApiKey(form: FormData): Promise<CreateApiKeyResult> {
  const session = await requireSession();
  try {
    admin(session);
    const name = String(form.get("name") ?? "").trim().slice(0, 100);
    if (!name) return { ok: false, error: "Give the key a name, for example the tool that will use it." };
    const defaultSource = String(form.get("defaultSource") ?? "").trim().slice(0, 100) || null;
    const { key, prefix, hash } = generateApiKey();
    const db = await getDb();
    const [row] = await db.insert(apiKeys).values({ orgId: session.orgId, name, prefix, keyHash: hash, defaultSource, createdBy: session.profileId }).returning();
    await audit(session, { entityType: "api_key", entityId: row!.id, action: "create", after: { name, prefix, defaultSource } });
    revalidatePath("/settings");
    return { ok: true, id: row!.id, key, prefix, message: "Key created" };
  } catch (err) {
    return fail(err, "Could not create the key.");
  }
}

export async function revokeApiKey(id: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    admin(session);
    const db = await getDb();
    const row = await db.query.apiKeys.findFirst({ where: and(eq(apiKeys.id, id), eq(apiKeys.orgId, session.orgId)), columns: { id: true, name: true, prefix: true, revokedAt: true } });
    if (!row) return { ok: false, error: "Key not found." };
    if (row.revokedAt) return { ok: true, message: "Already revoked" };
    await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, session.orgId), isNull(apiKeys.revokedAt)));
    await audit(session, { entityType: "api_key", entityId: id, action: "revoke", before: { name: row.name, prefix: row.prefix } });
    revalidatePath("/settings");
    return { ok: true, message: "Key revoked" };
  } catch (err) {
    return fail(err, "Could not revoke the key.");
  }
}

/* Webhooks */

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return ""; }
}

export async function saveWebhook(id: string | null, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    admin(session);
    const name = String(form.get("name") ?? "").trim().slice(0, 100);
    if (!name) return { ok: false, error: "Give the webhook a name." };
    const checked = validateWebhookUrl(String(form.get("url") ?? "").trim());
    if (!checked.ok) return { ok: false, error: checked.error };
    const url = checked.url.toString();
    const picked = form.getAll("events").map(String).filter((e) => isWebhookEvent(e) && e !== "ping");
    // Every event selected is stored as an empty list, which means all events, including ones added later.
    const events = picked.length === SUBSCRIBABLE_EVENTS.length ? [] : picked;
    const db = await getDb();
    if (id) {
      const existing = await db.query.webhookEndpoints.findFirst({ where: and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.orgId, session.orgId)) });
      if (!existing) return { ok: false, error: "Webhook not found." };
      await db.update(webhookEndpoints).set({ name, url, events }).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.orgId, session.orgId)));
      await audit(session, { entityType: "webhook", entityId: id, action: "update", before: { name: existing.name, host: hostOf(existing.url), events: existing.events }, after: { name, host: hostOf(url), events } });
      revalidatePath("/settings");
      return { ok: true, id, message: "Webhook saved" };
    }
    const [row] = await db.insert(webhookEndpoints).values({ orgId: session.orgId, name, url, secret: generateWebhookSecret(), events, active: true, createdBy: session.profileId }).returning();
    await audit(session, { entityType: "webhook", entityId: row!.id, action: "create", after: { name, host: hostOf(url), events } });
    revalidatePath("/settings");
    return { ok: true, id: row!.id, message: "Webhook added" };
  } catch (err) {
    return fail(err, "Could not save the webhook.");
  }
}

export async function deleteWebhook(id: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    admin(session);
    const db = await getDb();
    const existing = await db.query.webhookEndpoints.findFirst({ where: and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.orgId, session.orgId)) });
    if (!existing) return { ok: false, error: "Webhook not found." };
    await audit(session, { entityType: "webhook", entityId: id, action: "delete", before: { name: existing.name, host: hostOf(existing.url), events: existing.events } });
    await db.delete(webhookEndpoints).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.orgId, session.orgId)));
    revalidatePath("/settings");
    return { ok: true, message: "Webhook deleted" };
  } catch (err) {
    return fail(err, "Could not delete the webhook.");
  }
}

/** Pause or resume deliveries. Resuming clears the failure count so the endpoint gets a fresh run of 10 attempts. */
export async function toggleWebhook(id: string, active: boolean): Promise<ActionResult> {
  const session = await requireSession();
  try {
    admin(session);
    const db = await getDb();
    const existing = await db.query.webhookEndpoints.findFirst({ where: and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.orgId, session.orgId)) });
    if (!existing) return { ok: false, error: "Webhook not found." };
    await db.update(webhookEndpoints).set(active ? { active: true, failureCount: 0 } : { active: false }).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.orgId, session.orgId)));
    await audit(session, { entityType: "webhook", entityId: id, action: active ? "resume" : "pause", before: { active: existing.active }, after: { active } });
    revalidatePath("/settings");
    return { ok: true, message: active ? "Webhook resumed" : "Webhook paused" };
  } catch (err) {
    return fail(err, "Could not update the webhook.");
  }
}

/** Replace the signing secret. The receiver must be updated with the new value or its signature checks will fail. */
export async function rotateWebhookSecret(id: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    admin(session);
    const db = await getDb();
    const existing = await db.query.webhookEndpoints.findFirst({ where: and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.orgId, session.orgId)), columns: { id: true } });
    if (!existing) return { ok: false, error: "Webhook not found." };
    await db.update(webhookEndpoints).set({ secret: generateWebhookSecret() }).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.orgId, session.orgId)));
    await audit(session, { entityType: "webhook", entityId: id, action: "rotate_secret" });
    revalidatePath("/settings");
    return { ok: true, message: "New secret generated" };
  } catch (err) {
    return fail(err, "Could not rotate the secret.");
  }
}

/** Sends a signed "ping" event to this endpoint only and reports the HTTP status. */
export async function testWebhook(id: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    admin(session);
    const result = await sendTestPing(session.orgId, id);
    if (!result) return { ok: false, error: "Webhook not found." };
    revalidatePath("/settings");
    if (!result.ok) return { ok: false, error: `Test failed: ${result.error ?? "no response"} (${result.durationMs} ms)` };
    return { ok: true, message: `Test delivered: HTTP ${result.statusCode} in ${result.durationMs} ms` };
  } catch (err) {
    return fail(err, "Could not send the test.");
  }
}

/* CSV import */

async function readCsvUpload(form: FormData): Promise<{ ok: true; records: Record<string, string>[] } | { ok: false; error: string }> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a CSV file first." };
  if (file.size > MAX_CSV_BYTES) return { ok: false, error: "The file is larger than 2 MB. Split it into smaller files." };
  const { headers, records } = parseCsvRecords(await file.text());
  if (!headers.filter(Boolean).length) return { ok: false, error: "The file has no header row." };
  const rows = records.filter((r) => Object.values(r).some((v) => v !== ""));
  if (!rows.length) return { ok: false, error: "The file has a header row but no data rows." };
  if (rows.length > MAX_CSV_ROWS) return { ok: false, error: `The file has ${rows.length} rows. The limit is ${MAX_CSV_ROWS} per import.` };
  return { ok: true, records: rows };
}

function importSummary(noun: string, created: number, duplicates: number, errors: number, eventsSkipped: boolean): string {
  const parts = [`${created} ${noun} created`, `${duplicates} duplicates skipped`, `${errors} rows with errors`];
  return parts.join(", ") + (eventsSkipped ? `. Webhook events were not sent because more than ${MAX_IMPORT_EVENTS} records were created.` : ".");
}

/**
 * Import leads from a CSV upload. Columns are matched by header name with the same aliases as POST /api/v1/leads.
 * SMS consent is always set to unknown. Rows that match an open lead at the same address are counted as duplicates.
 */
export async function importLeadsCsv(form: FormData): Promise<ImportResult> {
  const session = await requireSession();
  try {
    admin(session);
    const upload = await readCsvUpload(form);
    if (!upload.ok) return upload;
    const defaultSource = String(form.get("defaultSource") ?? "").trim().slice(0, 100) || "CSV import";
    const actor = { profileId: session.profileId, label: `CSV import (${session.fullName})`, via: "csv" as const, defaultSource, createTask: false };
    const ctx = createIntakeContext();
    let created = 0; let duplicates = 0; let errors = 0;
    const errorMessages: string[] = [];
    const events: Record<string, unknown>[] = [];
    const noteError = (row: number, message: string) => { errors += 1; if (errorMessages.length < 10) errorMessages.push(`Row ${row}: ${message}`); };

    for (let i = 0; i < upload.records.length; i++) {
      const rowNumber = i + 2; // row 1 is the header
      const parsed = parseLeadPayload(upload.records[i]);
      if (!parsed.ok) { noteError(rowNumber, parsed.error); continue; }
      try {
        const r = await createLeadFromPayload(session.orgId, parsed.data, actor, ctx);
        if (r.duplicate) duplicates += 1; else { created += 1; if (r.event) events.push(r.event); }
      } catch (err) {
        noteError(rowNumber, err instanceof Error ? err.message : "Could not create the lead.");
      }
    }

    const eventsSkipped = events.length > MAX_IMPORT_EVENTS;
    if (!eventsSkipped) await emitEvents(session.orgId, "lead.created", events);
    await audit(session, { entityType: "import", entityId: session.orgId, action: "import_leads_csv", after: { total: upload.records.length, created, duplicates, errors } });
    revalidatePath("/leads"); revalidatePath("/pipeline"); revalidatePath("/dashboard"); revalidatePath("/settings");
    return { ok: true, total: upload.records.length, created, duplicates, errors, errorMessages, message: importSummary("leads", created, duplicates, errors, eventsSkipped) };
  } catch (err) {
    return fail(err, "Could not import the file.");
  }
}

const last10 = (phone: string) => phone.replace(/\D/g, "").slice(-10);

/** Import buyers from a CSV upload. A row is a duplicate when its email or phone already belongs to a buyer in the workspace. */
export async function importBuyersCsv(form: FormData): Promise<ImportResult> {
  const session = await requireSession();
  try {
    admin(session);
    const upload = await readCsvUpload(form);
    if (!upload.ok) return upload;
    const db = await getDb();
    const existing = await db.select({ phones: buyers.phones, emails: buyers.emails }).from(buyers).where(eq(buyers.orgId, session.orgId));
    const knownEmails = new Set(existing.flatMap((b) => b.emails.map((e) => e.address.toLowerCase())));
    const knownPhones = new Set(existing.flatMap((b) => b.phones.map((p) => last10(p.number))).filter((p) => p.length >= 7));

    let created = 0; let duplicates = 0; let errors = 0;
    const errorMessages: string[] = [];
    const events: Record<string, unknown>[] = [];
    const noteError = (row: number, message: string) => { errors += 1; if (errorMessages.length < 10) errorMessages.push(`Row ${row}: ${message}`); };

    for (let i = 0; i < upload.records.length; i++) {
      const rowNumber = i + 2;
      const parsed = parseBuyerPayload(upload.records[i]);
      if (!parsed.ok) { noteError(rowNumber, parsed.error); continue; }
      const d = parsed.data;
      const phoneKey = d.phone ? last10(d.phone) : "";
      if ((d.email && knownEmails.has(d.email)) || (phoneKey.length >= 7 && knownPhones.has(phoneKey))) { duplicates += 1; continue; }
      try {
        const [buyer] = await db.insert(buyers).values({
          orgId: session.orgId, company: d.company ?? null, firstName: d.firstName, lastName: d.lastName ?? null,
          phones: d.phone ? [{ number: d.phone, type: "mobile", isPrimary: true }] : [], emails: d.email ? [{ address: d.email, isPrimary: true }] : [],
          website: d.website ?? null, source: d.source ?? "CSV import", notes: d.notes ?? null,
        }).returning();
        await db.insert(buyerCriteria).values({ orgId: session.orgId, buyerId: buyer!.id, states: d.states });
        if (d.email) knownEmails.add(d.email);
        if (phoneKey.length >= 7) knownPhones.add(phoneKey);
        created += 1;
        events.push({ buyerId: buyer!.id, firstName: d.firstName, lastName: d.lastName ?? null, company: d.company ?? null, phone: d.phone ?? null, email: d.email ?? null, source: buyer!.source, via: "csv" });
      } catch (err) {
        noteError(rowNumber, err instanceof Error ? err.message : "Could not create the buyer.");
      }
    }

    const eventsSkipped = events.length > MAX_IMPORT_EVENTS;
    if (!eventsSkipped) await emitEvents(session.orgId, "buyer.created", events);
    await audit(session, { entityType: "import", entityId: session.orgId, action: "import_buyers_csv", after: { total: upload.records.length, created, duplicates, errors } });
    revalidatePath("/buyers"); revalidatePath("/settings");
    return { ok: true, total: upload.records.length, created, duplicates, errors, errorMessages, message: importSummary("buyers", created, duplicates, errors, eventsSkipped) };
  } catch (err) {
    return fail(err, "Could not import the file.");
  }
}
