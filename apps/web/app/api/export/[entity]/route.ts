import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { leads, properties, contacts, pipelineStages, leadSources, profiles, buyers, buyerCriteria, dealAnalyses } from "@dealcalc/db";
import { recordsToCsv, LEAD_CSV_TEMPLATE_COLUMNS, BUYER_CSV_TEMPLATE_COLUMNS } from "@dealcalc/integrations";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ROWS = 50_000;

function csvResponse(filename: string, csv: string) {
  return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

const stamp = () => new Date().toISOString().slice(0, 10);
const primaryPhone = (list: { number: string; isPrimary?: boolean }[]) => (list.find((p) => p.isPrimary) ?? list[0])?.number ?? "";
const primaryEmail = (list: { address: string; isPrimary?: boolean }[]) => (list.find((e) => e.isPrimary) ?? list[0])?.address ?? "";

/**
 * Session authenticated CSV downloads: leads.csv, buyers.csv, analyses.csv, plus the import templates
 * leads-template.csv and buyers-template.csv. Every role may export. Cells are guarded against spreadsheet formula injection.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  const { entity } = await params;
  const db = await getDb();

  if (entity === "leads-template.csv") {
    return csvResponse("leads-template.csv", recordsToCsv(LEAD_CSV_TEMPLATE_COLUMNS, [{
      address: "123 Main St", city: "Baltimore", state: "MD", zip: "21201", first_name: "Jane", last_name: "Doe", phone: "410-555-0100", email: "jane@example.com",
      asking_price: "150000", source: "Direct mail", urgency: "medium", beds: "3", baths: "1.5", sqft: "1400", year_built: "1955", property_type: "Single family", notes: "Inherited, wants a quick sale", external_id: "row-1",
    }]));
  }
  if (entity === "buyers-template.csv") {
    return csvResponse("buyers-template.csv", recordsToCsv(BUYER_CSV_TEMPLATE_COLUMNS, [{
      first_name: "Sam", last_name: "Carter", company: "Carter Homes LLC", phone: "410-555-0101", email: "sam@example.com", website: "https://example.com", states: "MD, PA", source: "REIA meeting", notes: "Cash, closes in 14 days",
    }]));
  }

  if (entity === "leads.csv") {
    const rows = await db.select({ lead: leads, property: properties, contact: contacts, stage: pipelineStages, source: leadSources.name, assignee: profiles.fullName })
      .from(leads).innerJoin(properties, eq(leads.propertyId, properties.id)).innerJoin(pipelineStages, eq(leads.stageId, pipelineStages.id))
      .leftJoin(contacts, eq(leads.primaryContactId, contacts.id)).leftJoin(leadSources, eq(leads.sourceId, leadSources.id)).leftJoin(profiles, eq(leads.assignedTo, profiles.id))
      .where(eq(leads.orgId, session.orgId)).orderBy(desc(leads.createdAt)).limit(MAX_ROWS);
    const columns = ["lead_id", "status", "stage", "address", "address_2", "city", "state", "zip", "first_name", "last_name", "phone", "email", "sms_consent", "do_not_contact", "asking_price", "urgency", "motivation_score", "source", "assigned_to", "contact_attempts", "next_follow_up_at", "last_contact_at", "lost_reason", "beds", "baths", "sqft", "year_built", "property_type", "created_at", "updated_at"];
    const records = rows.map(({ lead, property, contact, stage, source, assignee }) => ({
      lead_id: lead.id, status: lead.status, stage: stage.name, address: property.addressLine1, address_2: property.addressLine2, city: property.city, state: property.state, zip: property.postalCode,
      first_name: contact?.firstName, last_name: contact?.lastName, phone: contact ? primaryPhone(contact.phones) : "", email: contact ? primaryEmail(contact.emails) : "",
      sms_consent: contact?.smsConsent, do_not_contact: contact ? (contact.doNotContact ? "yes" : "no") : "",
      asking_price: lead.askingPrice, urgency: lead.sellerUrgency, motivation_score: lead.motivationScore, source, assigned_to: assignee, contact_attempts: lead.contactAttempts,
      next_follow_up_at: lead.nextFollowUpAt, last_contact_at: lead.lastContactAt, lost_reason: lead.lostReason,
      beds: property.beds, baths: property.baths, sqft: property.sqft, year_built: property.yearBuilt, property_type: property.propertyType, created_at: lead.createdAt, updated_at: lead.updatedAt,
    }));
    return csvResponse(`leads-${stamp()}.csv`, recordsToCsv(columns, records, { bom: true }));
  }

  if (entity === "buyers.csv") {
    const rows = await db.select({ buyer: buyers, criteria: buyerCriteria }).from(buyers).leftJoin(buyerCriteria, eq(buyerCriteria.buyerId, buyers.id))
      .where(eq(buyers.orgId, session.orgId)).orderBy(desc(buyers.createdAt)).limit(MAX_ROWS);
    const columns = ["buyer_id", "first_name", "last_name", "company", "phone", "email", "website", "source", "active", "states", "counties", "zips", "property_types", "price_min", "price_max", "arv_pct_max", "funding", "proof_of_funds_on_file", "sight_unseen", "closes_in_days", "last_contacted_at", "notes", "created_at"];
    const seen = new Set<string>();
    const records = rows.filter(({ buyer }) => (seen.has(buyer.id) ? false : (seen.add(buyer.id), true))).map(({ buyer, criteria }) => ({
      buyer_id: buyer.id, first_name: buyer.firstName, last_name: buyer.lastName, company: buyer.company, phone: primaryPhone(buyer.phones), email: primaryEmail(buyer.emails), website: buyer.website, source: buyer.source,
      active: buyer.active ? "yes" : "no", states: (criteria?.states ?? []).join(", "), counties: (criteria?.counties ?? []).join("; "), zips: (criteria?.zips ?? []).join(" "), property_types: (criteria?.propertyTypes ?? []).join("; "),
      price_min: criteria?.priceMin, price_max: criteria?.priceMax, arv_pct_max: criteria?.arvPctMax, funding: criteria?.funding, proof_of_funds_on_file: criteria ? (criteria.proofOfFundsOnFile ? "yes" : "no") : "",
      sight_unseen: criteria ? (criteria.sightUnseen ? "yes" : "no") : "", closes_in_days: criteria?.closesInDays, last_contacted_at: buyer.lastContactedAt, notes: buyer.notes, created_at: buyer.createdAt,
    }));
    return csvResponse(`buyers-${stamp()}.csv`, recordsToCsv(columns, records, { bom: true }));
  }

  if (entity === "analyses.csv") {
    const rows = await db.select({ a: dealAnalyses, property: properties, author: profiles.fullName })
      .from(dealAnalyses).innerJoin(properties, eq(dealAnalyses.propertyId, properties.id)).leftJoin(profiles, eq(dealAnalyses.createdBy, profiles.id))
      .where(and(eq(dealAnalyses.orgId, session.orgId), isNull(dealAnalyses.trashedAt))).orderBy(desc(dealAnalyses.updatedAt)).limit(MAX_ROWS);
    const columns = ["analysis_id", "name", "version", "status", "strategy", "is_primary", "archived", "address", "city", "state", "zip", "lead_id", "purchase_price", "arv", "max_allowable_offer", "spread", "net_profit", "engine_version", "created_by", "created_at", "updated_at"];
    const records = rows.map(({ a, property, author }) => ({
      analysis_id: a.id, name: a.name, version: a.version, status: a.status, strategy: a.strategy, is_primary: a.isPrimary ? "yes" : "no", archived: a.archivedAt ? "yes" : "no",
      address: property.addressLine1, city: property.city, state: property.state, zip: property.postalCode, lead_id: a.leadId,
      purchase_price: a.purchasePrice, arv: a.arv, max_allowable_offer: a.maxAllowableOffer, spread: a.spread, net_profit: a.netProfit, engine_version: a.engineVersion, created_by: author, created_at: a.createdAt, updated_at: a.updatedAt,
    }));
    return csvResponse(`analyses-${stamp()}.csv`, recordsToCsv(columns, records, { bom: true }));
  }

  return new NextResponse("Not found. Use leads.csv, buyers.csv, or analyses.csv.", { status: 404 });
}
