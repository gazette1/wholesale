"use server";
import { revalidatePath } from "next/cache";
import { enrichmentSettings } from "@dealcalc/db";
import { getDb } from "../db";
import { requireSession } from "../auth";
import { audit } from "../audit";
import { friendlyError, moneyField } from "../safe";
import { getEnrichmentSettings } from "../services/enrichment-budget";
import type { ActionResult } from "./leads";

// integer cents columns hold about 21 million dollars; these limits keep typos out long before that.
const MAX_PER_LEAD_DOLLARS = 1_000;
const MAX_MONTHLY_DOLLARS = 100_000;

export async function saveEnrichmentSettings(form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    if (session.role !== "admin") return { ok: false, error: "Admins only." };
    const perLead = moneyField(form.get("perLeadCap"), "Per lead limit", { required: true, max: MAX_PER_LEAD_DOLLARS });
    if (!perLead.ok) return perLead;
    const monthly = moneyField(form.get("monthlyBudget"), "Monthly budget", { required: true, max: MAX_MONTHLY_DOLLARS });
    if (!monthly.ok) return monthly;
    const after = { autoEnrichOnCreate: form.get("autoEnrichOnCreate") === "on", perLeadCapCents: Math.round(perLead.value! * 100), monthlyBudgetCents: Math.round(monthly.value! * 100) };
    const before = await getEnrichmentSettings(session.orgId);
    const db = await getDb();
    const [row] = await db.insert(enrichmentSettings).values({ orgId: session.orgId, ...after }).onConflictDoUpdate({ target: enrichmentSettings.orgId, set: after }).returning();
    await audit(session, { entityType: "enrichment_settings", entityId: row!.id, action: "update", before, after });
    revalidatePath("/settings");
    return { ok: true, message: "Enrichment settings saved" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not save the enrichment settings.") };
  }
}
