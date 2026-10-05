"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { comps, dealAnalyses } from "@dealcalc/db";
import { compsArv, type CompsRates, type DealInput } from "@dealcalc/engine";
import { getDb } from "../db";
import { requireSession, requireCan } from "../auth";
import { audit } from "../audit";
import { friendlyError, isUuid, moneyField, numberField, textField, dateOnlyField } from "../safe";
import { compsWorkspace } from "../data/comps";
import { dayKey } from "../utils";
import type { ActionResult } from "./leads";
import { saveAnalysis } from "./analyzer";

/** The offers block the analyzer writes when a property has never been through it. Matches buildDefaultInputs. */
const DEFAULT_PER_SQFT = { light: 15, medium: 30, full: 50 };

/** The most comparables DealOffersSchema accepts. */
const MAX_COMPARABLES = 12;

const RatesSchema = z.object({
  perSqft: z.number().finite().min(0).max(10_000),
  perBed: z.number().finite().min(0).max(1_000_000),
  perBath: z.number().finite().min(0).max(1_000_000),
  perYearBuilt: z.number().finite().min(0).max(100_000),
  perLotSqft: z.number().finite().min(0).max(10_000),
  monthlyMarket: z.number().finite().min(-0.1).max(0.1),
}).partial();

/** Rates travel with the form so the saved math matches what the person was looking at. Anything unparseable falls back to the defaults. */
function parseRates(raw: FormDataEntryValue | null | undefined): Partial<CompsRates> {
  try {
    const parsed = RatesSchema.safeParse(JSON.parse(String(raw ?? "{}")));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Manual adjustments post as parallel label and amount fields. Blank labels and zero amounts are dropped. */
function parseManual(form: FormData): Record<string, number> {
  const labels = form.getAll("adjustmentLabel").map((v) => String(v).trim().slice(0, 80));
  const amounts = form.getAll("adjustmentAmount").map((v) => Number(String(v).replace(/[$,\s]/g, "")));
  const out: Record<string, number> = {};
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const amount = amounts[i];
    if (!label || !Number.isFinite(amount) || amount === 0 || Math.abs(amount as number) > 10_000_000) continue;
    out[label] = Math.round((amount as number) * 100) / 100;
  }
  return out;
}

/** Recompute with the posted rates and store the adjusted price on every row, so the table and the database agree. */
async function persistAdjustedPrices(orgId: string, propertyId: string, rates: Partial<CompsRates>) {
  const workspace = await compsWorkspace(orgId, propertyId);
  if (!workspace) return null;
  // The page runs the same math with a date only as of, so the stored adjusted price matches what the person saw.
  const result = compsArv({ subject: workspace.subject, comps: workspace.rows.map((r) => r.input), asOf: dayKey(new Date()), rates });
  const db = await getDb();
  await Promise.all(result.comps.map((c) => db.update(comps).set({ adjustedPrice: String(c.adjustedPrice) }).where(and(eq(comps.id, c.id), eq(comps.orgId, orgId)))));
  return { workspace, result };
}

function revalidateComps(propertyId: string, leadId: string | null) {
  revalidatePath(`/properties/${propertyId}/comps`);
  revalidatePath(`/properties/${propertyId}/report`);
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

/** Keep or drop one comp from the ARV. */
export async function setCompIncluded(compId: string, included: boolean): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "lead:write");
    if (!isUuid(compId)) return { ok: false, error: "Comp not found." };
    const db = await getDb();
    const row = await db.query.comps.findFirst({ where: and(eq(comps.id, compId), eq(comps.orgId, session.orgId)) });
    if (!row) return { ok: false, error: "Comp not found." };
    await db.update(comps).set({ included }).where(and(eq(comps.id, compId), eq(comps.orgId, session.orgId)));
    revalidateComps(row.propertyId, null);
    return { ok: true, message: included ? "Included" : "Excluded" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not change the comp.") };
  }
}

/** A comp the user found themselves, stored beside the provider rows and marked manual. */
export async function addManualComp(propertyId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "lead:write");
    if (!isUuid(propertyId)) return { ok: false, error: "Property not found." };
    const workspace = await compsWorkspace(session.orgId, propertyId);
    if (!workspace) return { ok: false, error: "Property not found." };
    if (workspace.rows.length >= 60) return { ok: false, error: "This property already has 60 comps. Remove one before adding another." };

    const address = textField(form.get("address"), 200);
    if (!address) return { ok: false, error: "Enter the comp address." };
    const price = moneyField(form.get("soldPrice"), "Sold price", { required: true });
    if (!price.ok) return { ok: false, error: price.error };
    const soldAt = dateOnlyField(form.get("soldAt"));
    if (!soldAt.ok) return { ok: false, error: soldAt.error };
    const sqft = numberField(form.get("sqft"), "Square feet", 0, 1_000_000, { integer: true });
    if (!sqft.ok) return { ok: false, error: sqft.error };
    const beds = numberField(form.get("beds"), "Beds", 0, 50);
    if (!beds.ok) return { ok: false, error: beds.error };
    const baths = numberField(form.get("baths"), "Baths", 0, 50);
    if (!baths.ok) return { ok: false, error: baths.error };
    const yearBuilt = numberField(form.get("yearBuilt"), "Year built", 1600, 2100, { integer: true });
    if (!yearBuilt.ok) return { ok: false, error: yearBuilt.error };
    const distance = numberField(form.get("distanceMi"), "Distance in miles", 0, 500);
    if (!distance.ok) return { ok: false, error: distance.error };

    const db = await getDb();
    const [row] = await db.insert(comps).values({
      orgId: session.orgId, propertyId, source: "manual", address,
      soldPrice: price.value === null ? null : String(price.value), soldAt: soldAt.value, sqft: sqft.value,
      beds: beds.value === null ? null : String(beds.value), baths: baths.value === null ? null : String(baths.value),
      yearBuilt: yearBuilt.value, distanceMi: distance.value === null ? null : String(distance.value),
      included: true, notes: textField(form.get("notes"), 500), adjustments: {},
    }).returning();
    await persistAdjustedPrices(session.orgId, propertyId, parseRates(form.get("rates")));
    await audit(session, { entityType: "comp", entityId: row!.id, action: "create", after: { address, propertyId } });
    revalidateComps(propertyId, workspace.lead?.id ?? null);
    return { ok: true, message: "Comp added", id: row!.id };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not add the comp.") };
  }
}

/** Replace the manual adjustments and the note on one comp. */
export async function saveCompAdjustments(compId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "lead:write");
    if (!isUuid(compId)) return { ok: false, error: "Comp not found." };
    const db = await getDb();
    const row = await db.query.comps.findFirst({ where: and(eq(comps.id, compId), eq(comps.orgId, session.orgId)) });
    if (!row) return { ok: false, error: "Comp not found." };
    const adjustments = parseManual(form);
    if (Object.keys(adjustments).length > 10) return { ok: false, error: "A comp takes up to 10 manual adjustments." };
    await db.update(comps).set({ adjustments, notes: textField(form.get("notes"), 500) }).where(and(eq(comps.id, compId), eq(comps.orgId, session.orgId)));
    await persistAdjustedPrices(session.orgId, row.propertyId, parseRates(form.get("rates")));
    revalidateComps(row.propertyId, null);
    return { ok: true, message: "Adjustments saved" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not save the adjustments.") };
  }
}

/**
 * Write the included comps and their adjusted prices into the primary analysis and switch its ARV
 * to the comparable average. The write goes through saveAnalysis, the same path the analyzer editor
 * uses, so validation, the lock rule, the audit trail, and the outbound event all stay in one place.
 */
export async function useArvInAnalysis(propertyId: string, analysisId: string, ratesJson: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "analysis:write");
    if (!isUuid(propertyId) || !isUuid(analysisId)) return { ok: false, error: "Analysis not found." };
    const db = await getDb();
    const analysis = await db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId), eq(dealAnalyses.propertyId, propertyId)) });
    if (!analysis) return { ok: false, error: "Analysis not found." };
    if (analysis.trashedAt) return { ok: false, error: "That analysis version is in the trash. Restore it in the analyzer before writing an ARV into it." };
    if (analysis.status !== "draft" && analysis.status !== "reviewing") return { ok: false, error: `Analysis v${analysis.version} is ${analysis.status.replace(/_/g, " ")} and locked. Clone it in the analyzer, then run this again. Nothing was changed.` };

    const computed = await persistAdjustedPrices(session.orgId, propertyId, parseRates(ratesJson));
    if (!computed) return { ok: false, error: "Property not found." };
    const { workspace, result } = computed;
    const usable = result.comps.filter((c) => c.included && c.weight > 0 && c.adjustedPrice > 0).sort((a, b) => b.weight - a.weight).slice(0, MAX_COMPARABLES);
    if (usable.length === 0) return { ok: false, error: "No included comp has an adjusted price above zero. Nothing was changed." };

    const current = analysis.inputs as DealInput;
    const offers = current.offers ?? { comparables: [], useComparableAverage: false, squareFeet: workspace.property.sqft ?? 0, perSqft: DEFAULT_PER_SQFT, sellerCurrent: null, sellerDesired: null };
    const inputs: DealInput = { ...current, offers: { ...offers, comparables: usable.map((c) => ({ label: c.label.slice(0, 120), value: Math.round(c.adjustedPrice * 100) / 100 })), useComparableAverage: true } };
    const saved = await saveAnalysis(analysisId, { inputs });
    if (!saved.ok) return saved;

    // The analyzer averages its comparables evenly, so the figure it will show is not the weighted ARV.
    const evenAverage = Math.round(usable.reduce((a, c) => a + c.adjustedPrice, 0) / usable.length);
    await audit(session, { entityType: "analysis", entityId: analysisId, action: "comps_arv", after: { compCount: usable.length, confidence: result.confidence, weightedArv: result.arv, evenAverage } });
    revalidateComps(propertyId, workspace.lead?.id ?? null);
    return { ok: true, message: `Wrote ${usable.length} comparables into v${analysis.version}. The analyzer now uses their even average, ${evenAverage.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}, as the ARV.` };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not write the ARV into the analysis.") };
  }
}
