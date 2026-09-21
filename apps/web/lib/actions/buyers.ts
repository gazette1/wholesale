"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { buyers, buyerCriteria, buyerPurchases, dealSubmissions, dealAnalyses, activities } from "@dealcalc/db";
import { judgmentProvider, inferBuyerCriteria } from "@dealcalc/integrations";
import { getDb } from "../db";
import { requireSession, requireCan } from "../auth";
import { audit } from "../audit";
import { toNumber, toOptionalNumber } from "../utils";
import { emitEvent } from "../services/integrations";
import type { ActionResult } from "./leads";

function list(v: FormDataEntryValue | null): string[] {
  return String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export async function createBuyer(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "buyer:write");
    const db = await getDb();
    const firstName = String(form.get("firstName") ?? "").trim();
    if (!firstName) return { ok: false, error: "First name is required." };
    const [buyer] = await db.insert(buyers).values({
      orgId: session.orgId, company: String(form.get("company") ?? "") || null, firstName, lastName: String(form.get("lastName") ?? "") || null,
      phones: form.get("phone") ? [{ number: String(form.get("phone")), type: "mobile", isPrimary: true }] : [], emails: form.get("email") ? [{ address: String(form.get("email")), isPrimary: true }] : [],
      website: String(form.get("website") ?? "") || null, source: String(form.get("source") ?? "") || null, notes: String(form.get("notes") ?? "") || null,
    }).returning();
    await db.insert(buyerCriteria).values({ orgId: session.orgId, buyerId: buyer!.id, states: list(form.get("states")).map((s) => s.toUpperCase()) });
    await audit(session, { entityType: "buyer", entityId: buyer!.id, action: "create" });
    await emitEvent(session.orgId, "buyer.created", { buyerId: buyer!.id, firstName: buyer!.firstName, lastName: buyer!.lastName, company: buyer!.company, phone: buyer!.phones[0]?.number ?? null, email: buyer!.emails[0]?.address ?? null, source: buyer!.source, via: "app" });
    revalidatePath("/buyers");
    return { ok: true, id: buyer!.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the buyer." };
  }
}

export async function updateBuyer(buyerId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "buyer:write");
    const db = await getDb();
    const buyer = await db.query.buyers.findFirst({ where: and(eq(buyers.id, buyerId), eq(buyers.orgId, session.orgId)) });
    if (!buyer) return { ok: false, error: "Buyer not found." };
    await db.update(buyers).set({
      company: String(form.get("company") ?? "") || null, firstName: String(form.get("firstName") ?? buyer.firstName), lastName: String(form.get("lastName") ?? "") || null,
      phones: form.get("phone") ? [{ number: String(form.get("phone")), type: "mobile", isPrimary: true }] : buyer.phones, emails: form.get("email") ? [{ address: String(form.get("email")), isPrimary: true }] : buyer.emails,
      website: String(form.get("website") ?? "") || null, source: String(form.get("source") ?? "") || null, notes: String(form.get("notes") ?? "") || null, active: form.get("active") !== "off",
      lastContactedAt: form.get("touched") === "on" ? new Date() : buyer.lastContactedAt,
    }).where(eq(buyers.id, buyerId));
    revalidatePath(`/buyers/${buyerId}`); revalidatePath("/buyers");
    return { ok: true, message: "Saved" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not save." };
  }
}

export async function updateCriteria(buyerId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "buyer:write");
    const db = await getDb();
    const values = {
      states: list(form.get("states")).map((s) => s.toUpperCase()), counties: list(form.get("counties")), zips: list(form.get("zips")), propertyTypes: list(form.get("propertyTypes")),
      priceMin: toOptionalNumber(form.get("priceMin"))?.toString() ?? null, priceMax: toOptionalNumber(form.get("priceMax"))?.toString() ?? null,
      arvPctMax: toOptionalNumber(form.get("arvPctMax")) != null ? (toNumber(form.get("arvPctMax")) / 100).toFixed(4) : null, buyingFormula: String(form.get("buyingFormula") ?? "") || null,
      conditionLevels: list(form.get("conditionLevels")).map(Number).filter((n) => n >= 1 && n <= 5), occupancyPrefs: list(form.get("occupancyPrefs")),
      funding: (String(form.get("funding") || "cash")) as any, proofOfFundsOnFile: form.get("proofOfFundsOnFile") === "on", sightUnseen: form.get("sightUnseen") === "on",
      minMarginAmount: toOptionalNumber(form.get("minMarginAmount"))?.toString() ?? null, minMarginPct: toOptionalNumber(form.get("minMarginPct")) != null ? (toNumber(form.get("minMarginPct")) / 100).toFixed(4) : null,
      closesInDays: toOptionalNumber(form.get("closesInDays")),
    };
    const existing = await db.query.buyerCriteria.findFirst({ where: eq(buyerCriteria.buyerId, buyerId) });
    if (existing) await db.update(buyerCriteria).set(values).where(eq(buyerCriteria.id, existing.id));
    else await db.insert(buyerCriteria).values({ orgId: session.orgId, buyerId, ...values });
    await audit(session, { entityType: "buyer_criteria", entityId: buyerId, action: "update", before: existing, after: values });
    revalidatePath(`/buyers/${buyerId}`); revalidatePath("/buyers");
    return { ok: true, message: "Buy box saved" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not save." };
  }
}

/** Suggest buy box fields from call notes through the judgment provider. Never saves; the user confirms. */
export async function suggestCriteria(buyerId: string): Promise<{ ok: true; funding: string; sightUnseen: number; conditionLevels: number[]; provider: string; confidence: number } | { ok: false; error: string }> {
  const session = await requireSession();
  const db = await getDb();
  const buyer = await db.query.buyers.findFirst({ where: and(eq(buyers.id, buyerId), eq(buyers.orgId, session.orgId)) });
  if (!buyer?.notes) return { ok: false, error: "Add call notes first." };
  try {
    const r = await inferBuyerCriteria(judgmentProvider(), buyer.notes);
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Judgment provider failed." };
  }
}

export async function addPurchase(buyerId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  requireCan(session, "buyer:write");
  const db = await getDb();
  await db.insert(buyerPurchases).values({ orgId: session.orgId, buyerId, address: String(form.get("address") ?? "") || null, price: toOptionalNumber(form.get("price"))?.toString() ?? null, closedAt: form.get("closedAt") ? new Date(String(form.get("closedAt"))) : null, notes: String(form.get("notes") ?? "") || null });
  revalidatePath(`/buyers/${buyerId}`);
  return { ok: true };
}

export async function recordSubmission(analysisId: string, buyerId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "buyer:write");
    const db = await getDb();
    const analysis = await db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId)) });
    if (!analysis) return { ok: false, error: "Analysis not found." };
    const response = String(form.get("response") ?? "none") as any;
    await db.insert(dealSubmissions).values({ orgId: session.orgId, analysisId, buyerId, packageId: String(form.get("packageId") ?? "") || null, sentAt: new Date(), sentVia: String(form.get("sentVia") ?? "email"), response, responseAmount: toOptionalNumber(form.get("responseAmount"))?.toString() ?? null, notes: String(form.get("notes") ?? "") || null });
    await db.update(buyers).set({ lastContactedAt: new Date() }).where(eq(buyers.id, buyerId));
    if (analysis.leadId) await db.insert(activities).values({ orgId: session.orgId, leadId: analysis.leadId, actorId: session.profileId, type: "system", payload: { text: `Deal sent to buyer`, buyerId, analysisId } });
    revalidatePath(`/buyers/${buyerId}`); revalidatePath(`/buyers/match/${analysisId}`);
    return { ok: true, message: "Recorded" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not record." };
  }
}

export async function updateSubmission(submissionId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  requireCan(session, "buyer:write");
  const db = await getDb();
  const s = await db.query.dealSubmissions.findFirst({ where: and(eq(dealSubmissions.id, submissionId), eq(dealSubmissions.orgId, session.orgId)) });
  if (!s) return { ok: false, error: "Submission not found." };
  await db.update(dealSubmissions).set({ response: String(form.get("response") ?? s.response) as any, responseAmount: toOptionalNumber(form.get("responseAmount"))?.toString() ?? s.responseAmount, notes: String(form.get("notes") ?? "") || s.notes }).where(eq(dealSubmissions.id, submissionId));
  revalidatePath(`/buyers/${s.buyerId}`); revalidatePath(`/buyers/match/${s.analysisId}`);
  return { ok: true, message: "Updated" };
}

export async function deleteBuyer(buyerId: string): Promise<never | ActionResult> {
  const session = await requireSession();
  if (session.role !== "admin") return { ok: false, error: "Only admins delete buyers." };
  const db = await getDb();
  await db.delete(buyers).where(and(eq(buyers.id, buyerId), eq(buyers.orgId, session.orgId)));
  revalidatePath("/buyers");
  redirect("/buyers");
}
