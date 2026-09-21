"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { buyers, buyerCriteria, buyerPurchases, dealSubmissions, dealAnalyses, dealPackages, activities } from "@dealcalc/db";
import { judgmentProvider, inferBuyerCriteria, normalizePhone } from "@dealcalc/integrations";
import { getDb } from "../db";
import { requireSession, requireCan } from "../auth";
import { audit } from "../audit";
import { emitEvent } from "../services/integrations";
import { friendlyError, isEmail, isUuid, moneyField, numberField, textField, dateOnlyField } from "../safe";
import type { ActionResult } from "./leads";

function list(v: FormDataEntryValue | null, maxItems = 60, maxLen = 60): string[] {
  return Array.from(new Set(String(v ?? "").split(",").map((s) => s.trim().slice(0, maxLen)).filter(Boolean))).slice(0, maxItems);
}

const OCCUPANCY = ["owner", "tenant", "vacant"];
const FUNDING = ["cash", "hard_money", "conventional", "mixed"] as const;
const RESPONSES = ["none", "interested", "pass", "offer"] as const;

/** Contact fields shared by create and edit. Returns an error string or the cleaned values. */
function contactFields(form: FormData): { error: string } | { firstName: string; lastName: string | null; company: string | null; phone: string | null; email: string | null; website: string | null; source: string | null; notes: string | null } {
  const firstName = textField(form.get("firstName"), 80);
  if (!firstName) return { error: "First name is required." };
  const email = textField(form.get("email"), 254);
  if (email && !isEmail(email)) return { error: "Enter a valid email address, or leave it blank." };
  const phoneRaw = textField(form.get("phone"), 40);
  if (phoneRaw && phoneRaw.replace(/\D/g, "").length < 7) return { error: "Enter a phone number with at least 7 digits, or leave it blank." };
  // Same stored format as lead phones, so tel links and texting agree. Numbers that are not US 10 digit stay as typed.
  const phone = phoneRaw ? normalizePhone(phoneRaw) ?? phoneRaw : null;
  return {
    firstName, lastName: textField(form.get("lastName"), 80), company: textField(form.get("company"), 120), phone, email: email ? email.toLowerCase() : null,
    website: textField(form.get("website"), 200), source: textField(form.get("source"), 120), notes: textField(form.get("notes"), 8000),
  };
}

export async function createBuyer(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "buyer:write");
    const c = contactFields(form);
    if ("error" in c) return { ok: false, error: c.error };
    const db = await getDb();
    const [buyer] = await db.insert(buyers).values({
      orgId: session.orgId, company: c.company, firstName: c.firstName, lastName: c.lastName,
      phones: c.phone ? [{ number: c.phone, type: "mobile", isPrimary: true }] : [], emails: c.email ? [{ address: c.email, isPrimary: true }] : [],
      website: c.website, source: c.source, notes: c.notes,
    }).returning();
    await db.insert(buyerCriteria).values({ orgId: session.orgId, buyerId: buyer!.id, states: list(form.get("states")).map((s) => s.toUpperCase().slice(0, 2)) });
    await audit(session, { entityType: "buyer", entityId: buyer!.id, action: "create" });
    await emitEvent(session.orgId, "buyer.created", { buyerId: buyer!.id, firstName: buyer!.firstName, lastName: buyer!.lastName, company: buyer!.company, phone: buyer!.phones[0]?.number ?? null, email: buyer!.emails[0]?.address ?? null, source: buyer!.source, via: "app" });
    revalidatePath("/buyers");
    return { ok: true, id: buyer!.id };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not create the buyer.") };
  }
}

export async function updateBuyer(buyerId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "buyer:write");
    if (!isUuid(buyerId)) return { ok: false, error: "Buyer not found." };
    const c = contactFields(form);
    if ("error" in c) return { ok: false, error: c.error };
    const db = await getDb();
    const buyer = await db.query.buyers.findFirst({ where: and(eq(buyers.id, buyerId), eq(buyers.orgId, session.orgId)) });
    if (!buyer) return { ok: false, error: "Buyer not found." };
    // A blank phone or email clears the primary entry and keeps any secondary ones.
    const phones = c.phone ? [{ number: c.phone, type: buyer.phones[0]?.type ?? "mobile", isPrimary: true }, ...buyer.phones.slice(1)] : buyer.phones.slice(1);
    const emails = c.email ? [{ address: c.email, isPrimary: true }, ...buyer.emails.slice(1)] : buyer.emails.slice(1);
    await db.update(buyers).set({
      company: c.company, firstName: c.firstName, lastName: c.lastName, phones, emails, website: c.website, source: c.source, notes: c.notes,
      lastContactedAt: form.get("touched") === "on" ? new Date() : buyer.lastContactedAt,
    }).where(and(eq(buyers.id, buyerId), eq(buyers.orgId, session.orgId)));
    await audit(session, { entityType: "buyer", entityId: buyerId, action: "update" });
    revalidatePath(`/buyers/${buyerId}`); revalidatePath("/buyers");
    return { ok: true, message: "Saved" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not save the buyer.") };
  }
}

/** Inactive buyers stay on file but drop out of deal matching. */
export async function setBuyerActive(buyerId: string, active: boolean): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "buyer:write");
    if (!isUuid(buyerId)) return { ok: false, error: "Buyer not found." };
    const db = await getDb();
    const buyer = await db.query.buyers.findFirst({ where: and(eq(buyers.id, buyerId), eq(buyers.orgId, session.orgId)) });
    if (!buyer) return { ok: false, error: "Buyer not found." };
    await db.update(buyers).set({ active }).where(and(eq(buyers.id, buyerId), eq(buyers.orgId, session.orgId)));
    await audit(session, { entityType: "buyer", entityId: buyerId, action: active ? "reactivate" : "deactivate" });
    revalidatePath(`/buyers/${buyerId}`); revalidatePath("/buyers");
    return { ok: true, message: active ? "Buyer reactivated" : "Buyer deactivated" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not update the buyer.") };
  }
}

export async function updateCriteria(buyerId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "buyer:write");
    if (!isUuid(buyerId)) return { ok: false, error: "Buyer not found." };
    const db = await getDb();
    const buyer = await db.query.buyers.findFirst({ where: and(eq(buyers.id, buyerId), eq(buyers.orgId, session.orgId)) });
    if (!buyer) return { ok: false, error: "Buyer not found." };

    const priceMin = moneyField(form.get("priceMin"), "Price min"); if (!priceMin.ok) return priceMin;
    const priceMax = moneyField(form.get("priceMax"), "Price max"); if (!priceMax.ok) return priceMax;
    if (priceMin.value != null && priceMax.value != null && priceMin.value > priceMax.value) return { ok: false, error: "Price min is above price max." };
    const arvPct = numberField(form.get("arvPctMax"), "Max all in % of ARV", 1, 150); if (!arvPct.ok) return arvPct;
    const marginAmount = moneyField(form.get("minMarginAmount"), "Minimum margin ($)"); if (!marginAmount.ok) return marginAmount;
    const marginPct = numberField(form.get("minMarginPct"), "Minimum margin (%)", 0, 100); if (!marginPct.ok) return marginPct;
    const closes = numberField(form.get("closesInDays"), "Closes in (days)", 1, 365, { integer: true }); if (!closes.ok) return closes;

    const zips = list(form.get("zips"));
    const badZip = zips.find((z) => !/^\d{5}$/.test(z));
    if (badZip) return { ok: false, error: `"${badZip}" is not a 5 digit ZIP code.` };
    const states = list(form.get("states")).map((s) => s.toUpperCase());
    const badState = states.find((s) => !/^[A-Z]{2}$/.test(s));
    if (badState) return { ok: false, error: `"${badState}" is not a two letter state code.` };
    const occupancy = list(form.get("occupancyPrefs")).map((s) => s.toLowerCase());
    const badOcc = occupancy.find((o) => !OCCUPANCY.includes(o));
    if (badOcc) return { ok: false, error: `Occupancy "${badOcc}" is not one of ${OCCUPANCY.join(", ")}.` };
    const levelsRaw = list(form.get("conditionLevels"));
    const badLevel = levelsRaw.find((l) => !/^[1-5]$/.test(l));
    if (badLevel) return { ok: false, error: `Condition level "${badLevel}" must be a number from 1 to 5.` };
    const fundingRaw = String(form.get("funding") || "cash");
    const funding = (FUNDING as readonly string[]).includes(fundingRaw) ? (fundingRaw as (typeof FUNDING)[number]) : "cash";

    const values = {
      states, counties: list(form.get("counties")), zips, propertyTypes: list(form.get("propertyTypes")),
      priceMin: priceMin.value?.toString() ?? null, priceMax: priceMax.value?.toString() ?? null,
      arvPctMax: arvPct.value != null ? (arvPct.value / 100).toFixed(4) : null, buyingFormula: textField(form.get("buyingFormula"), 300),
      conditionLevels: levelsRaw.map(Number), occupancyPrefs: occupancy, funding,
      proofOfFundsOnFile: form.get("proofOfFundsOnFile") === "on", sightUnseen: form.get("sightUnseen") === "on",
      minMarginAmount: marginAmount.value?.toString() ?? null, minMarginPct: marginPct.value != null ? (marginPct.value / 100).toFixed(4) : null,
      closesInDays: closes.value,
    };
    const existing = await db.query.buyerCriteria.findFirst({ where: and(eq(buyerCriteria.buyerId, buyerId), eq(buyerCriteria.orgId, session.orgId)) });
    if (existing) await db.update(buyerCriteria).set(values).where(eq(buyerCriteria.id, existing.id));
    else await db.insert(buyerCriteria).values({ orgId: session.orgId, buyerId, ...values });
    await audit(session, { entityType: "buyer_criteria", entityId: buyerId, action: "update", before: existing, after: values });
    revalidatePath(`/buyers/${buyerId}`); revalidatePath("/buyers");
    return { ok: true, message: "Buy box saved" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not save the buy box.") };
  }
}

/** Suggest buy box fields from call notes through the judgment provider. Never saves; the user confirms. */
export async function suggestCriteria(buyerId: string): Promise<{ ok: true; funding: string; sightUnseen: number; conditionLevels: number[]; provider: string; confidence: number } | { ok: false; error: string }> {
  const session = await requireSession();
  if (!isUuid(buyerId)) return { ok: false, error: "Buyer not found." };
  const db = await getDb();
  const buyer = await db.query.buyers.findFirst({ where: and(eq(buyers.id, buyerId), eq(buyers.orgId, session.orgId)) });
  if (!buyer) return { ok: false, error: "Buyer not found." };
  if (!buyer.notes) return { ok: false, error: "Add notes from a buyer call in the Contact card first, then save." };
  try {
    const r = await inferBuyerCriteria(judgmentProvider(), buyer.notes);
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "The judgment provider did not answer. Try again.") };
  }
}

export async function addPurchase(buyerId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "buyer:write");
    if (!isUuid(buyerId)) return { ok: false, error: "Buyer not found." };
    const address = textField(form.get("address"), 200);
    if (!address) return { ok: false, error: "Enter the address of the purchase." };
    const price = moneyField(form.get("price"), "Price"); if (!price.ok) return price;
    const closedAt = dateOnlyField(form.get("closedAt")); if (!closedAt.ok) return closedAt;
    const db = await getDb();
    const buyer = await db.query.buyers.findFirst({ where: and(eq(buyers.id, buyerId), eq(buyers.orgId, session.orgId)) });
    if (!buyer) return { ok: false, error: "Buyer not found." };
    await db.insert(buyerPurchases).values({ orgId: session.orgId, buyerId, address, price: price.value?.toString() ?? null, closedAt: closedAt.value, notes: textField(form.get("notes"), 1000) });
    revalidatePath(`/buyers/${buyerId}`);
    return { ok: true, message: "Purchase added" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not add the purchase.") };
  }
}

export async function removePurchase(purchaseId: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "buyer:write");
    if (!isUuid(purchaseId)) return { ok: false, error: "Purchase not found." };
    const db = await getDb();
    const row = await db.query.buyerPurchases.findFirst({ where: and(eq(buyerPurchases.id, purchaseId), eq(buyerPurchases.orgId, session.orgId)) });
    if (!row) return { ok: false, error: "Purchase not found." };
    await db.delete(buyerPurchases).where(and(eq(buyerPurchases.id, purchaseId), eq(buyerPurchases.orgId, session.orgId)));
    revalidatePath(`/buyers/${row.buyerId}`);
    return { ok: true, message: "Removed" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not remove the purchase.") };
  }
}

export async function recordSubmission(analysisId: string, buyerId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "buyer:write");
    if (!isUuid(analysisId) || !isUuid(buyerId)) return { ok: false, error: "Analysis or buyer not found." };
    const db = await getDb();
    const [analysis, buyer] = await Promise.all([
      db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId)) }),
      db.query.buyers.findFirst({ where: and(eq(buyers.id, buyerId), eq(buyers.orgId, session.orgId)) }),
    ]);
    if (!analysis || !buyer) return { ok: false, error: "Analysis or buyer not found." };
    // The package id rides in the URL, so it is checked before it reaches the foreign key.
    const packageRaw = String(form.get("packageId") ?? "");
    const pkg = isUuid(packageRaw) ? await db.query.dealPackages.findFirst({ where: and(eq(dealPackages.id, packageRaw), eq(dealPackages.orgId, session.orgId), eq(dealPackages.analysisId, analysisId)) }) : null;
    const existing = await db.query.dealSubmissions.findFirst({ where: and(eq(dealSubmissions.analysisId, analysisId), eq(dealSubmissions.buyerId, buyerId), eq(dealSubmissions.orgId, session.orgId)) });
    if (existing) return { ok: false, error: "This deal was already sent to this buyer. Update the response on the buyer's page." };
    const responseRaw = String(form.get("response") ?? "none");
    const response = (RESPONSES as readonly string[]).includes(responseRaw) ? (responseRaw as (typeof RESPONSES)[number]) : "none";
    const amount = moneyField(form.get("responseAmount"), "Offer amount"); if (!amount.ok) return amount;
    const viaRaw = String(form.get("sentVia") ?? "email");
    const sentVia = ["email", "text", "phone", "in_person", "other"].includes(viaRaw) ? viaRaw : "email";
    await db.insert(dealSubmissions).values({ orgId: session.orgId, analysisId, buyerId, packageId: pkg?.id ?? null, sentAt: new Date(), sentVia, response, responseAmount: response === "offer" ? amount.value?.toString() ?? null : null, notes: textField(form.get("notes"), 1000) });
    await db.update(buyers).set({ lastContactedAt: new Date() }).where(and(eq(buyers.id, buyerId), eq(buyers.orgId, session.orgId)));
    if (analysis.leadId) await db.insert(activities).values({ orgId: session.orgId, leadId: analysis.leadId, actorId: session.profileId, type: "system", payload: { text: `Deal sent to buyer ${buyer.company ?? buyer.firstName}`, buyerId, analysisId } });
    revalidatePath(`/buyers/${buyerId}`); revalidatePath(`/buyers/match/${analysisId}`); revalidatePath("/buyers");
    return { ok: true, message: "Recorded" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not record that the deal was sent.") };
  }
}

export async function updateSubmission(submissionId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "buyer:write");
    if (!isUuid(submissionId)) return { ok: false, error: "Submission not found." };
    const db = await getDb();
    const s = await db.query.dealSubmissions.findFirst({ where: and(eq(dealSubmissions.id, submissionId), eq(dealSubmissions.orgId, session.orgId)) });
    if (!s) return { ok: false, error: "Submission not found." };
    const responseRaw = String(form.get("response") ?? s.response);
    const response = (RESPONSES as readonly string[]).includes(responseRaw) ? (responseRaw as (typeof RESPONSES)[number]) : s.response;
    const amount = moneyField(form.get("responseAmount"), "Offer amount"); if (!amount.ok) return amount;
    if (response === "offer" && amount.value == null && s.responseAmount == null) return { ok: false, error: "Enter the amount the buyer offered." };
    // Only an offer carries an amount. Any other response clears it.
    const responseAmount = response === "offer" ? (amount.value != null ? amount.value.toString() : s.responseAmount) : null;
    await db.update(dealSubmissions).set({ response, responseAmount, notes: form.has("notes") ? textField(form.get("notes"), 1000) : s.notes }).where(and(eq(dealSubmissions.id, submissionId), eq(dealSubmissions.orgId, session.orgId)));
    revalidatePath(`/buyers/${s.buyerId}`); revalidatePath(`/buyers/match/${s.analysisId}`); revalidatePath("/buyers");
    return { ok: true, message: "Updated" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not update the response.") };
  }
}

export async function deleteBuyer(buyerId: string): Promise<never | ActionResult> {
  const session = await requireSession();
  if (session.role !== "admin") return { ok: false, error: "Only admins delete buyers." };
  if (!isUuid(buyerId)) return { ok: false, error: "Buyer not found." };
  const db = await getDb();
  const buyer = await db.query.buyers.findFirst({ where: and(eq(buyers.id, buyerId), eq(buyers.orgId, session.orgId)) });
  if (!buyer) return { ok: false, error: "Buyer not found." };
  await audit(session, { entityType: "buyer", entityId: buyerId, action: "delete", before: { company: buyer.company, firstName: buyer.firstName, lastName: buyer.lastName } });
  await db.delete(buyers).where(and(eq(buyers.id, buyerId), eq(buyers.orgId, session.orgId)));
  revalidatePath("/buyers");
  redirect("/buyers");
}
