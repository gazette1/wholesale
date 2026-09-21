import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq, gte, sql } from "drizzle-orm";
import { leads, properties, contacts, pipelineStages, leadSources } from "@dealcalc/db";
import { parseLeadPayload } from "@dealcalc/integrations";
import { getDb } from "@/lib/db";
import { authenticateApiRequest, apiError } from "@/lib/services/api-auth";
import { createLeadFromPayload, createIntakeContext } from "@/lib/services/lead-intake";
import { emitEvents } from "@/lib/services/integrations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ITEMS = 200;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

type ItemResult = { index: number; leadId: string | null; propertyId: string | null; duplicate: boolean; externalId?: string; error?: string };

async function readBody(request: NextRequest): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const form = await request.formData();
    const obj: Record<string, string> = {};
    for (const [k, v] of form.entries()) if (typeof v === "string") obj[k] = v;
    return obj;
  }
  return JSON.parse(await request.text());
}

/**
 * Create leads from other software. Body: one lead object, an array of lead objects, or { "leads": [...] } with up to 200 items.
 * Every item gets its own result, so one bad row does not reject the rest.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if ("response" in auth) return auth.response;
  const { key, headers } = auth;

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return apiError(413, "Request body is larger than 2 MB.", headers);
  let body: unknown;
  try { body = await readBody(request); } catch { return apiError(400, "Body must be valid JSON: a lead object or { \"leads\": [...] }.", headers); }

  const wrapped = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).leads : undefined;
  if (wrapped !== undefined && !Array.isArray(wrapped)) return apiError(400, "\"leads\" must be an array.", headers);
  const items: unknown[] = Array.isArray(body) ? body : Array.isArray(wrapped) ? wrapped : [body];
  if (!body || typeof body !== "object" || items.length === 0) return apiError(400, "Send a lead object or { \"leads\": [...] } with at least one lead.", headers);
  if (items.length > MAX_ITEMS) return apiError(413, `Too many leads in one request. The limit is ${MAX_ITEMS}.`, headers);

  const actor = { profileId: null, label: `API key ${key.keyName}`, via: "api" as const, defaultSource: key.defaultSource, createTask: true };
  const ctx = createIntakeContext();
  const results: ItemResult[] = [];
  const events: Record<string, unknown>[] = [];

  for (let index = 0; index < items.length; index++) {
    const parsed = parseLeadPayload(items[index]);
    if (!parsed.ok) { results.push({ index, leadId: null, propertyId: null, duplicate: false, error: parsed.error }); continue; }
    try {
      const r = await createLeadFromPayload(key.orgId, parsed.data, actor, ctx);
      results.push({ index, leadId: r.leadId, propertyId: r.propertyId, duplicate: r.duplicate, ...(parsed.data.externalId ? { externalId: parsed.data.externalId } : {}) });
      if (r.event) events.push(r.event);
    } catch (err) {
      results.push({ index, leadId: null, propertyId: null, duplicate: false, error: err instanceof Error ? err.message : "Could not create the lead." });
    }
  }

  const created = results.filter((r) => r.leadId && !r.duplicate).length;
  const duplicates = results.filter((r) => r.duplicate).length;
  const errors = results.filter((r) => r.error).length;
  if (created > 0) { try { revalidatePath("/leads"); revalidatePath("/pipeline"); revalidatePath("/dashboard"); } catch { /* cache refresh is best effort */ } }
  await emitEvents(key.orgId, "lead.created", events);

  // 201 when anything was created, 200 when every accepted item was a duplicate, 422 when every item failed.
  const status = created > 0 ? 201 : duplicates > 0 ? 200 : 422;
  return NextResponse.json({ ok: errors < results.length, created, duplicates, errors, results }, { status, headers });
}

function decodeCursor(cursor: string): { ts: string; id: string } | null {
  try {
    const [ts, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!ts || !id || Number.isNaN(new Date(ts).getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { ts: new Date(ts).toISOString(), id };
  } catch { return null; }
}

/** List leads for polling triggers, most recently updated first. Query: updatedSince (ISO 8601), limit (1 to 200, default 100), cursor. */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if ("response" in auth) return auth.response;
  const { key, headers } = auth;
  const q = request.nextUrl.searchParams;

  const limitRaw = Number(q.get("limit") ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 100;
  const sinceRaw = q.get("updatedSince") ?? q.get("updated_since");
  const since = sinceRaw ? new Date(sinceRaw) : null;
  if (since && Number.isNaN(since.getTime())) return apiError(400, "updatedSince must be an ISO 8601 date, for example 2026-01-31T00:00:00Z.", headers);
  const cursorRaw = q.get("cursor");
  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return apiError(400, "cursor is not valid. Use the nextCursor value from the previous page.", headers);

  // Order and page on the millisecond so the cursor, which travels as an ISO string, compares exactly.
  const updatedMs = sql`date_trunc('milliseconds', ${leads.updatedAt})`;
  const where = [eq(leads.orgId, key.orgId)];
  if (since) where.push(gte(leads.updatedAt, since));
  if (cursor) where.push(sql`(${updatedMs} < ${cursor.ts}::timestamptz or (${updatedMs} = ${cursor.ts}::timestamptz and ${leads.id} < ${cursor.id}::uuid))`);

  const db = await getDb();
  const rows = await db.select({ lead: leads, property: properties, contact: contacts, stage: pipelineStages, source: leadSources.name })
    .from(leads).innerJoin(properties, eq(leads.propertyId, properties.id)).innerJoin(pipelineStages, eq(leads.stageId, pipelineStages.id))
    .leftJoin(contacts, eq(leads.primaryContactId, contacts.id)).leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .where(and(...where)).orderBy(sql`${updatedMs} desc`, sql`${leads.id} desc`).limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last ? Buffer.from(`${new Date(last.lead.updatedAt).toISOString()}|${last.lead.id}`, "utf8").toString("base64url") : null;

  const data = page.map(({ lead, property, contact, stage, source }) => ({
    id: lead.id, status: lead.status, stage: { key: stage.key, name: stage.name },
    address: { line1: property.addressLine1, line2: property.addressLine2, city: property.city, state: property.state, postalCode: property.postalCode },
    propertyId: property.id,
    contact: contact ? {
      id: contact.id, firstName: contact.firstName, lastName: contact.lastName,
      phone: (contact.phones.find((p) => p.isPrimary) ?? contact.phones[0])?.number ?? null,
      email: (contact.emails.find((e) => e.isPrimary) ?? contact.emails[0])?.address ?? null,
      smsConsent: contact.smsConsent, doNotContact: contact.doNotContact,
    } : null,
    askingPrice: lead.askingPrice != null ? Number(lead.askingPrice) : null, urgency: lead.sellerUrgency, source: source ?? null,
    createdAt: lead.createdAt, updatedAt: lead.updatedAt, stageEnteredAt: lead.stageEnteredAt, nextFollowUpAt: lead.nextFollowUpAt, lastContactAt: lead.lastContactAt,
  }));
  return NextResponse.json({ ok: true, count: data.length, leads: data, nextCursor }, { headers });
}
