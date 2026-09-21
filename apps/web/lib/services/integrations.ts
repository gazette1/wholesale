import { createHash, randomBytes, randomUUID } from "node:crypto";
import { after } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { apiKeys, webhookEndpoints, webhookDeliveries, contacts } from "@dealcalc/db";
import { EVENTS, SUBSCRIBABLE_EVENTS, signPayload, safeEqual, checkWebhookUrl, type WebhookEvent, type WebhookEnvelope } from "@dealcalc/integrations";
import { getDb } from "../db";

export { EVENTS, SUBSCRIBABLE_EVENTS };
export type { WebhookEvent, WebhookEnvelope };

/* API keys */

const KEY_PREFIX = "dc_live_";
const KEY_PATTERN = /^dc_live_[A-Za-z0-9_-]{32}$/;

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

/** New inbound API key. Only the hash is stored. The raw key is shown to the admin once and never logged. */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = KEY_PREFIX + randomBytes(24).toString("base64url");
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

export function generateWebhookSecret(): string {
  return "whsec_" + randomBytes(24).toString("base64url");
}

export type VerifiedKey = { orgId: string; keyId: string; keyName: string; defaultSource: string | null };

/** Look up a key by its SHA-256 hash. Revoked and unknown keys return null. Bumps lastUsedAt and useCount on success. */
export async function verifyApiKey(rawKey: string | null | undefined): Promise<VerifiedKey | null> {
  if (!rawKey || !KEY_PATTERN.test(rawKey)) return null;
  const hash = hashApiKey(rawKey);
  const db = await getDb();
  const row = await db.query.apiKeys.findFirst({ where: eq(apiKeys.keyHash, hash) });
  if (!row || !safeEqual(row.keyHash, hash) || row.revokedAt) return null;
  await db.update(apiKeys).set({ lastUsedAt: new Date(), useCount: sql`${apiKeys.useCount} + 1` }).where(eq(apiKeys.id, row.id));
  return { orgId: row.orgId, keyId: row.id, keyName: row.name, defaultSource: row.defaultSource };
}

/* Outbound webhooks */

const DELIVERY_TIMEOUT_MS = 5000;
const MAX_CONSECUTIVE_FAILURES = 10;

type Endpoint = typeof webhookEndpoints.$inferSelect;
export type DeliveryResult = { ok: boolean; statusCode: number | null; error: string | null; durationMs: number };

export function validateWebhookUrl(raw: string) {
  return checkWebhookUrl(raw, { production: process.env.NODE_ENV === "production" });
}

function envelope(orgId: string, event: WebhookEvent, data: Record<string, unknown>): WebhookEnvelope {
  return { id: randomUUID(), event, createdAt: new Date().toISOString(), orgId, data };
}

/** One signed POST to one endpoint. Always records a webhook_deliveries row and updates the endpoint counters. Never throws. */
export async function deliverToEndpoint(endpoint: Endpoint, env: WebhookEnvelope): Promise<DeliveryResult> {
  const started = Date.now();
  let statusCode: number | null = null;
  let error: string | null = null;
  let ok = false;
  try {
    const checked = validateWebhookUrl(endpoint.url);
    if (!checked.ok) throw new Error(checked.error);
    const body = JSON.stringify(env);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    try {
      // Redirects are not followed so a public URL cannot bounce the request to an internal host.
      const res = await fetch(checked.url, {
        method: "POST", redirect: "manual", signal: controller.signal, body,
        headers: {
          "content-type": "application/json", "user-agent": "DealCalc-Webhooks/1.0",
          "x-dealcalc-event": env.event, "x-dealcalc-delivery": env.id, "x-dealcalc-timestamp": timestamp,
          "x-dealcalc-signature": `sha256=${signPayload(endpoint.secret, timestamp, body)}`,
        },
      });
      statusCode = res.status;
      ok = res.status >= 200 && res.status < 300;
      if (!ok) error = res.status >= 300 && res.status < 400 ? `HTTP ${res.status} (redirects are not followed)` : `HTTP ${res.status}`;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    error = aborted ? `Timed out after ${DELIVERY_TIMEOUT_MS / 1000} seconds` : (err instanceof Error ? err.message : "Delivery failed").slice(0, 500);
  }
  const durationMs = Date.now() - started;
  try {
    const db = await getDb();
    await db.insert(webhookDeliveries).values({ orgId: endpoint.orgId, endpointId: endpoint.id, event: env.event, payload: env as unknown as Record<string, unknown>, statusCode, ok, error, durationMs });
    if (ok) {
      await db.update(webhookEndpoints).set({ lastStatus: statusCode, lastDeliveryAt: new Date(), failureCount: 0 }).where(eq(webhookEndpoints.id, endpoint.id));
    } else {
      const [row] = await db.update(webhookEndpoints).set({ lastStatus: statusCode, lastDeliveryAt: new Date(), failureCount: sql`${webhookEndpoints.failureCount} + 1` }).where(eq(webhookEndpoints.id, endpoint.id)).returning();
      if (row && row.failureCount >= MAX_CONSECUTIVE_FAILURES) await db.update(webhookEndpoints).set({ active: false }).where(eq(webhookEndpoints.id, endpoint.id));
    }
  } catch {
    /* bookkeeping must not break the caller */
  }
  return { ok, statusCode, error, durationMs };
}

async function subscribedEndpoints(orgId: string, event: WebhookEvent): Promise<Endpoint[]> {
  const db = await getDb();
  const rows = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.orgId, orgId), eq(webhookEndpoints.active, true)));
  // An empty events list means every event.
  return rows.filter((e) => !e.events?.length || e.events.includes(event));
}

async function deliverEvent(orgId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
  try {
    const endpoints = await subscribedEndpoints(orgId, event);
    if (!endpoints.length) return;
    const env = envelope(orgId, event, data);
    await Promise.allSettled(endpoints.map((e) => deliverToEndpoint(e, env)));
  } catch {
    /* never surface delivery problems to the user action */
  }
}

/** Run work after the response is sent when a request scope exists (route handlers, server actions). Otherwise run it now. */
async function afterResponse(work: () => Promise<void>): Promise<void> {
  let scheduled = false;
  try { after(work); scheduled = true; } catch { scheduled = false; }
  if (!scheduled) await work();
}

/**
 * Deliver one CRM event to every active endpoint in the org that subscribes to it.
 * Safe to await from any server action or route handler: it never throws, and inside a request the
 * deliveries run after the response has been sent, so the user action does not wait on the receiver.
 */
export async function emitEvent(orgId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
  try {
    await afterResponse(() => deliverEvent(orgId, event, data));
  } catch {
    /* never throw into the caller */
  }
}

/** Same as emitEvent for callers that know the contact but not the org, such as inbound message webhooks. */
export async function emitEventForContact(contactId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
  try {
    const db = await getDb();
    const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, contactId), columns: { orgId: true } });
    if (contact) await emitEvent(contact.orgId, event, data);
  } catch {
    /* never throw into the caller */
  }
}

/** Deliver a batch of events of one type, a few at a time, so a bulk import does not flood the receiver. */
export async function emitEvents(orgId: string, event: WebhookEvent, items: Record<string, unknown>[]): Promise<void> {
  if (!items.length) return;
  try {
    await afterResponse(async () => {
      try {
        const endpoints = await subscribedEndpoints(orgId, event);
        if (!endpoints.length) return;
        const CONCURRENCY = 5;
        for (let i = 0; i < items.length; i += CONCURRENCY) {
          const slice = items.slice(i, i + CONCURRENCY);
          await Promise.allSettled(slice.flatMap((data) => { const env = envelope(orgId, event, data); return endpoints.map((e) => deliverToEndpoint(e, env)); }));
        }
      } catch {
        /* never surface delivery problems */
      }
    });
  } catch {
    /* never throw into the caller */
  }
}

/** Send a ping to one endpoint and wait for the result. Used by the Send test button; works on paused endpoints too. */
export async function sendTestPing(orgId: string, endpointId: string): Promise<DeliveryResult | null> {
  const db = await getDb();
  const endpoint = await db.query.webhookEndpoints.findFirst({ where: and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.orgId, orgId)) });
  if (!endpoint) return null;
  return deliverToEndpoint(endpoint, envelope(orgId, "ping", { message: "Test delivery from DealCalc", endpointId: endpoint.id, endpointName: endpoint.name }));
}

/* Settings page data */

export type ApiKeyView = { id: string; name: string; prefix: string; defaultSource: string | null; lastUsedAt: Date | null; useCount: number; revokedAt: Date | null; createdAt: Date };
export type DeliveryView = { id: string; event: string; ok: boolean; statusCode: number | null; error: string | null; durationMs: number | null; createdAt: Date };
export type WebhookView = { id: string; name: string; url: string; secret: string; events: string[]; active: boolean; lastStatus: number | null; lastDeliveryAt: Date | null; failureCount: number; createdAt: Date; deliveries: DeliveryView[] };

/** Keys (never the hash) and endpoints with their last 10 deliveries. Call for admins only; endpoint secrets are included. */
export async function loadIntegrationSettings(orgId: string): Promise<{ keys: ApiKeyView[]; webhooks: WebhookView[] }> {
  const db = await getDb();
  const [keys, endpoints] = await Promise.all([
    db.select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, defaultSource: apiKeys.defaultSource, lastUsedAt: apiKeys.lastUsedAt, useCount: apiKeys.useCount, revokedAt: apiKeys.revokedAt, createdAt: apiKeys.createdAt })
      .from(apiKeys).where(eq(apiKeys.orgId, orgId)).orderBy(desc(apiKeys.createdAt)),
    db.select().from(webhookEndpoints).where(eq(webhookEndpoints.orgId, orgId)).orderBy(desc(webhookEndpoints.createdAt)),
  ]);
  const webhooks: WebhookView[] = [];
  for (const e of endpoints) {
    const deliveries = await db.select({ id: webhookDeliveries.id, event: webhookDeliveries.event, ok: webhookDeliveries.ok, statusCode: webhookDeliveries.statusCode, error: webhookDeliveries.error, durationMs: webhookDeliveries.durationMs, createdAt: webhookDeliveries.createdAt })
      .from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, e.id)).orderBy(desc(webhookDeliveries.createdAt)).limit(10);
    webhooks.push({ id: e.id, name: e.name, url: e.url, secret: e.secret, events: e.events ?? [], active: e.active, lastStatus: e.lastStatus, lastDeliveryAt: e.lastDeliveryAt, failureCount: e.failureCount, createdAt: e.createdAt, deliveries });
  }
  return { keys, webhooks };
}
