import { and, asc, eq, sql } from "drizzle-orm";
import { leads, properties, contacts, propertyContacts, pipelineStages, leadSources, activities, tasks } from "@dealcalc/db";
import { normalizeAddressKey, type LeadPayload } from "@dealcalc/integrations";
import { getDb } from "../db";

/**
 * Shared lead intake for the REST API and the CSV importer. Mirrors what the createLead server action writes
 * (property, contact, property_contacts link, lead in the first open stage, activity rows), and adds
 * property matching and duplicate handling because machine sources resend the same address.
 */

export type IntakeActor = {
  /** Profile that triggered the intake, or null for an API key. Used as activity actor and task assignee. */
  profileId: string | null;
  /** Shown in the activity timeline, for example "API key Zapier" or "CSV import". */
  label: string;
  via: "api" | "csv";
  /** Lead source used when the payload has none. Falls back to "API". */
  defaultSource?: string | null;
  /** Create the "First call" task that createLead creates. Off for bulk imports. */
  createTask?: boolean;
};

/** Per batch cache so a 200 item request or a 2000 row file does not repeat the same lookups. */
export type IntakeContext = {
  stage?: typeof pipelineStages.$inferSelect | null;
  sources: Map<string, { id: string; name: string }>;
  propertiesByZip: Map<string, { id: string; key: string }[]>;
};

export function createIntakeContext(): IntakeContext {
  return { sources: new Map(), propertiesByZip: new Map() };
}

export type IntakeResult = { leadId: string; propertyId: string; contactId: string | null; duplicate: boolean; event: Record<string, unknown> | null };

async function firstOpenStage(orgId: string, ctx: IntakeContext) {
  if (ctx.stage !== undefined) return ctx.stage;
  const db = await getDb();
  const all = await db.select().from(pipelineStages).where(eq(pipelineStages.orgId, orgId)).orderBy(asc(pipelineStages.position));
  ctx.stage = all.find((s) => s.key === "new_lead" && !s.isTerminal) ?? all.find((s) => !s.isTerminal) ?? all[0] ?? null;
  return ctx.stage;
}

async function resolveSource(orgId: string, name: string, ctx: IntakeContext) {
  const wanted = name.trim().slice(0, 100);
  const cacheKey = wanted.toLowerCase();
  const cached = ctx.sources.get(cacheKey);
  if (cached) return cached;
  const db = await getDb();
  let row = await db.query.leadSources.findFirst({ where: and(eq(leadSources.orgId, orgId), sql`lower(${leadSources.name}) = ${cacheKey}`) });
  if (!row) {
    [row] = await db.insert(leadSources).values({ orgId, name: wanted }).onConflictDoNothing().returning();
    if (!row) row = await db.query.leadSources.findFirst({ where: and(eq(leadSources.orgId, orgId), eq(leadSources.name, wanted)) });
  }
  if (!row) throw new Error("Could not create the lead source.");
  const value = { id: row.id, name: row.name };
  ctx.sources.set(cacheKey, value);
  return value;
}

async function findProperty(orgId: string, p: LeadPayload, ctx: IntakeContext) {
  const zip = p.postalCode.slice(0, 5);
  let candidates = ctx.propertiesByZip.get(zip);
  if (!candidates) {
    const db = await getDb();
    const rows = await db.select({ id: properties.id, addressLine1: properties.addressLine1, addressLine2: properties.addressLine2 }).from(properties)
      .where(and(eq(properties.orgId, orgId), sql`left(${properties.postalCode}, 5) = ${zip}`));
    candidates = rows.map((r) => ({ id: r.id, key: normalizeAddressKey(r.addressLine1, r.addressLine2) }));
    ctx.propertiesByZip.set(zip, candidates);
  }
  const key = normalizeAddressKey(p.addressLine1, p.addressLine2);
  return { match: candidates.find((c) => c.key === key) ?? null, key, candidates };
}

const last10 = (phone: string) => phone.replace(/\D/g, "").slice(-10);

/** Reuse a contact already linked to the property when the phone or email matches; otherwise null. */
async function findLinkedContact(orgId: string, propertyId: string, p: LeadPayload) {
  if (!p.phone && !p.email) return null;
  const db = await getDb();
  const linked = await db.select({ c: contacts }).from(propertyContacts).innerJoin(contacts, eq(propertyContacts.contactId, contacts.id))
    .where(and(eq(propertyContacts.propertyId, propertyId), eq(propertyContacts.orgId, orgId)));
  const phone = p.phone ? last10(p.phone) : "";
  return linked.map((l) => l.c).find((c) =>
    (phone.length >= 7 && c.phones.some((ph) => last10(ph.number) === phone)) || (p.email && c.emails.some((e) => e.address.toLowerCase() === p.email)),
  ) ?? null;
}

function summarize(p: LeadPayload): string {
  const parts = [[p.firstName, p.lastName].filter(Boolean).join(" "), p.phone, p.email, p.askingPrice != null ? `asking ${p.askingPrice}` : null].filter(Boolean);
  return parts.join(", ");
}

/**
 * Create a lead from a validated payload. When an open lead already exists for the same property,
 * nothing new is created: a note is added to that lead and it is returned with duplicate true.
 * SMS consent is always "unknown". Consent is never inferred from an import or an API call.
 */
export async function createLeadFromPayload(orgId: string, payload: LeadPayload, actor: IntakeActor, ctx: IntakeContext = createIntakeContext()): Promise<IntakeResult> {
  const db = await getDb();
  const stage = await firstOpenStage(orgId, ctx);
  if (!stage) throw new Error("No pipeline stages configured. Add stages under Settings.");
  const sourceName = payload.source ?? actor.defaultSource ?? "API";

  const found = await findProperty(orgId, payload, ctx);
  if (found.match) {
    const open = await db.query.leads.findFirst({ where: and(eq(leads.orgId, orgId), eq(leads.propertyId, found.match.id), eq(leads.status, "open")) });
    if (open) {
      const details = summarize(payload);
      const text = [`Duplicate submission from ${actor.label} (source ${sourceName}). No new lead was created.`, details ? `Submitted: ${details}.` : null, payload.notes ? `Notes: ${payload.notes}` : null].filter(Boolean).join(" ");
      await db.insert(activities).values({ orgId, leadId: open.id, actorId: actor.profileId, type: "note", payload: { text, via: actor.via, duplicate: true, externalId: payload.externalId ?? null } });
      return { leadId: open.id, propertyId: found.match.id, contactId: open.primaryContactId, duplicate: true, event: null };
    }
  }

  const source = await resolveSource(orgId, sourceName, ctx);

  let propertyId = found.match?.id ?? null;
  if (!propertyId) {
    const [property] = await db.insert(properties).values({
      orgId, addressLine1: payload.addressLine1, addressLine2: payload.addressLine2 ?? null, city: payload.city, state: payload.state, postalCode: payload.postalCode,
      propertyType: payload.propertyType ?? null, beds: payload.beds != null ? String(payload.beds) : null, baths: payload.baths != null ? String(payload.baths) : null,
      sqft: payload.sqft, yearBuilt: payload.yearBuilt, occupancy: "unknown", condition: "unknown", notes: payload.notes ?? null,
    }).returning();
    propertyId = property!.id;
    found.candidates.push({ id: propertyId, key: found.key });
  }

  let contactId: string | null = null;
  if (payload.firstName || payload.lastName || payload.phone || payload.email) {
    const existing = found.match ? await findLinkedContact(orgId, propertyId, payload) : null;
    if (existing) contactId = existing.id;
    else {
      const [contact] = await db.insert(contacts).values({
        orgId, firstName: payload.firstName ?? "Unknown", lastName: payload.lastName ?? null, relationship: "owner", smsConsent: "unknown", smsConsentAt: null,
        phones: payload.phone ? [{ number: payload.phone, type: "mobile", isPrimary: true }] : [], emails: payload.email ? [{ address: payload.email, isPrimary: true }] : [],
      }).returning();
      contactId = contact!.id;
      await db.insert(propertyContacts).values({ orgId, propertyId, contactId, role: "owner", isPrimary: !found.match }).onConflictDoNothing();
    }
  }

  const [lead] = await db.insert(leads).values({
    orgId, propertyId, primaryContactId: contactId, stageId: stage.id, sourceId: source.id, assignedTo: actor.profileId,
    askingPrice: payload.askingPrice != null ? String(payload.askingPrice) : null, sellerUrgency: payload.urgency, nextFollowUpAt: new Date(),
  }).returning();
  await db.insert(activities).values({ orgId, leadId: lead!.id, actorId: actor.profileId, type: "system", payload: { text: `Lead created by ${actor.label}`, via: actor.via, source: source.name, externalId: payload.externalId ?? null } });
  if (payload.notes) await db.insert(activities).values({ orgId, leadId: lead!.id, actorId: actor.profileId, type: "note", payload: { text: payload.notes } });
  if (actor.createTask) await db.insert(tasks).values({ orgId, leadId: lead!.id, assignedTo: actor.profileId, title: "First call", kind: "call", dueAt: new Date() });

  return {
    leadId: lead!.id, propertyId, contactId, duplicate: false,
    event: {
      leadId: lead!.id, propertyId, via: actor.via, externalId: payload.externalId ?? null,
      address: { line1: payload.addressLine1, line2: payload.addressLine2 ?? null, city: payload.city, state: payload.state, postalCode: payload.postalCode },
      contact: contactId ? { id: contactId, firstName: payload.firstName ?? null, lastName: payload.lastName ?? null, phone: payload.phone ?? null, email: payload.email ?? null } : null,
      askingPrice: payload.askingPrice, urgency: payload.urgency, source: source.name, stage: { key: stage.key, name: stage.name },
    },
  };
}
