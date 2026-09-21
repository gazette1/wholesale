"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { dealAnalyses, activities, leads } from "@dealcalc/db";
import { DealInputSchema, type DealInput } from "@dealcalc/engine";
import { getDb } from "../db";
import { requireSession, requireCan } from "../auth";
import { audit } from "../audit";
import { buildDefaultInputs, nextVersion, persistAnalysis, runDeal } from "../services/analysis";
import type { ActionResult } from "./leads";
import { emitEvent } from "../services/integrations";

export async function createAnalysis(propertyId: string, leadId: string | null): Promise<never> {
  const session = await requireSession();
  requireCan(session, "analysis:write");
  const db = await getDb();
  const inputs = await buildDefaultInputs(session.orgId, propertyId);
  const version = await nextVersion(propertyId);
  const [row] = await db.insert(dealAnalyses).values({
    orgId: session.orgId, propertyId, leadId, version, name: version === 1 ? "Base case" : `Scenario ${version}`, status: "draft", inputs, outputs: {}, engineVersion: "pending", isPrimary: version === 1, createdBy: session.profileId,
  }).returning();
  await persistAnalysis(row!.id, session.orgId, inputs);
  if (leadId) await db.insert(activities).values({ orgId: session.orgId, leadId, actorId: session.profileId, type: "analysis", payload: { analysisId: row!.id, version, text: `Analysis v${version} created` } });
  await audit(session, { entityType: "analysis", entityId: row!.id, action: "create", after: { version } });
  revalidatePath("/analyzer");
  redirect(`/analyzer/${row!.id}`);
}

export async function cloneAnalysis(analysisId: string): Promise<never> {
  const session = await requireSession();
  requireCan(session, "analysis:write");
  const db = await getDb();
  const source = await db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId)) });
  if (!source) redirect("/analyzer");
  const version = await nextVersion(source.propertyId);
  const inputs = { ...source.inputs, meta: { ...source.inputs.meta, name: `${source.name} copy` } } as DealInput;
  const [row] = await db.insert(dealAnalyses).values({ orgId: session.orgId, propertyId: source.propertyId, leadId: source.leadId, version, name: `${source.name} copy`, status: "draft", inputs, outputs: {}, engineVersion: "pending", createdBy: session.profileId }).returning();
  await persistAnalysis(row!.id, session.orgId, inputs);
  revalidatePath("/analyzer");
  redirect(`/analyzer/${row!.id}`);
}

/** Save the full DealInput JSON posted by the analyzer editor. */
export async function saveAnalysis(analysisId: string, payload: { inputs: unknown; name?: string; notes?: string }): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "analysis:write");
    const db = await getDb();
    const row = await db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId)) });
    if (!row) return { ok: false, error: "Analysis not found." };
    if (row.status !== "draft" && row.status !== "reviewing") return { ok: false, error: "This version is locked. Clone it to make changes." };
    const parsed = DealInputSchema.safeParse(payload.inputs);
    if (!parsed.success) return { ok: false, error: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    await persistAnalysis(analysisId, session.orgId, parsed.data);
    await db.update(dealAnalyses).set({ name: payload.name?.trim() || row.name, notes: payload.notes ?? row.notes }).where(eq(dealAnalyses.id, analysisId));
    revalidatePath(`/analyzer/${analysisId}`); revalidatePath("/analyzer"); if (row.leadId) revalidatePath(`/leads/${row.leadId}`); revalidatePath("/pipeline");
    const out = runDeal(parsed.data);
    void emitEvent(session.orgId, "analysis.saved", { analysisId, leadId: row.leadId, propertyId: row.propertyId, version: row.version, name: payload.name?.trim() || row.name, arv: out.effectiveArv, purchasePrice: parsed.data.acquisitions.purchasePrice, maxAllowableOffer: out.wholesale.maxAllowableOffer, spread: out.wholesale.spread, netProfit: out.acquisitions.netProfit, strategy: parsed.data.meta.strategy ?? "wholesale" });
    return { ok: true, message: "Saved" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not save." };
  }
}

/** Compute without saving, for the live preview. */
export async function previewAnalysis(inputs: unknown): Promise<{ ok: true; outputs: ReturnType<typeof runDeal> } | { ok: false; error: string }> {
  await requireSession();
  const parsed = DealInputSchema.safeParse(inputs);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { ok: true, outputs: runDeal(parsed.data, { sensitivity: true }) };
}

export async function setAnalysisStatus(analysisId: string, status: "draft" | "reviewing" | "approved_for_offer" | "rejected"): Promise<ActionResult> {
  const session = await requireSession();
  requireCan(session, "analysis:write");
  const db = await getDb();
  const row = await db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId)) });
  if (!row) return { ok: false, error: "Analysis not found." };
  await db.update(dealAnalyses).set({ status }).where(eq(dealAnalyses.id, analysisId));
  if (status === "approved_for_offer") {
    await db.update(dealAnalyses).set({ isPrimary: false }).where(eq(dealAnalyses.propertyId, row.propertyId));
    await db.update(dealAnalyses).set({ isPrimary: true }).where(eq(dealAnalyses.id, analysisId));
  }
  if (row.leadId) await db.insert(activities).values({ orgId: session.orgId, leadId: row.leadId, actorId: session.profileId, type: "analysis", payload: { analysisId, status, text: `Analysis v${row.version} marked ${status.replace(/_/g, " ")}` } });
  await audit(session, { entityType: "analysis", entityId: analysisId, action: "status", before: { status: row.status }, after: { status } });
  void emitEvent(session.orgId, "analysis.status_changed", { analysisId, leadId: row.leadId, propertyId: row.propertyId, version: row.version, from: row.status, to: status });
  revalidatePath(`/analyzer/${analysisId}`); revalidatePath("/analyzer"); if (row.leadId) revalidatePath(`/leads/${row.leadId}`);
  return { ok: true, message: `Marked ${status.replace(/_/g, " ")}` };
}

export async function deleteAnalysis(analysisId: string): Promise<never | ActionResult> {
  const session = await requireSession();
  requireCan(session, "analysis:write");
  const db = await getDb();
  const row = await db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId)) });
  if (!row) return { ok: false, error: "Analysis not found." };
  if (row.status === "approved_for_offer") return { ok: false, error: "Approved analyses cannot be deleted. Reject it first." };
  await audit(session, { entityType: "analysis", entityId: analysisId, action: "delete", before: { version: row.version, name: row.name } });
  await db.delete(dealAnalyses).where(eq(dealAnalyses.id, analysisId));
  revalidatePath("/analyzer");
  redirect(row.leadId ? `/leads/${row.leadId}?tab=analyzer` : "/analyzer");
}

/** Library state: archive keeps a version out of the default list, trash hides it until restored or deleted for good. */
export async function setAnalysisLibraryState(analysisId: string, op: "archive" | "unarchive" | "trash" | "restore"): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "analysis:write");
    const db = await getDb();
    const row = await db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId)) });
    if (!row) return { ok: false, error: "Analysis not found." };
    if (op === "trash" && row.status === "approved_for_offer") return { ok: false, error: "Approved analyses cannot be moved to trash. Reject or reopen it first." };
    const now = new Date();
    const set = op === "archive" ? { archivedAt: now } : op === "unarchive" ? { archivedAt: null } : op === "trash" ? { trashedAt: now, isPrimary: false } : { trashedAt: null };
    await db.update(dealAnalyses).set(set).where(and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId)));
    if (op === "trash" && row.isPrimary) {
      // Hand the primary flag to the newest version that is still in the library.
      const next = await db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.propertyId, row.propertyId), eq(dealAnalyses.orgId, session.orgId), isNull(dealAnalyses.trashedAt), ne(dealAnalyses.id, analysisId)), orderBy: desc(dealAnalyses.version) });
      if (next) await db.update(dealAnalyses).set({ isPrimary: true }).where(eq(dealAnalyses.id, next.id));
    }
    if (op === "restore") {
      const primary = await db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.propertyId, row.propertyId), eq(dealAnalyses.orgId, session.orgId), isNull(dealAnalyses.trashedAt), eq(dealAnalyses.isPrimary, true)) });
      if (!primary) await db.update(dealAnalyses).set({ isPrimary: true }).where(eq(dealAnalyses.id, analysisId));
    }
    await audit(session, { entityType: "analysis", entityId: analysisId, action: op, before: { version: row.version, name: row.name } });
    revalidatePath("/analyzer"); revalidatePath(`/analyzer/${analysisId}`); revalidatePath("/pipeline"); if (row.leadId) revalidatePath(`/leads/${row.leadId}`);
    const label = { archive: "Moved to archive", unarchive: "Moved back to active", trash: "Moved to trash", restore: "Restored from trash" }[op];
    return { ok: true, message: label };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the analysis." };
  }
}

/** Permanent delete, only from trash. */
export async function purgeAnalysis(analysisId: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "analysis:write");
    const db = await getDb();
    const row = await db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId)) });
    if (!row) return { ok: false, error: "Analysis not found." };
    if (!row.trashedAt) return { ok: false, error: "Move the analysis to trash before deleting it for good." };
    await audit(session, { entityType: "analysis", entityId: analysisId, action: "purge", before: { version: row.version, name: row.name } });
    await db.delete(dealAnalyses).where(and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId)));
    revalidatePath("/analyzer");
    return { ok: true, message: "Deleted for good" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not delete the analysis." };
  }
}

/** New analysis from the analyzer list: the form carries "leadId|propertyId" picked from open leads. */
export async function createAnalysisFromPicker(form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try { requireCan(session, "analysis:write"); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : "Not allowed." }; }
  const [leadId, propertyId] = String(form.get("target") ?? "").split("|");
  if (!leadId || !propertyId) return { ok: false, error: "Pick a lead to analyze." };
  const db = await getDb();
  const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, leadId), eq(leads.orgId, session.orgId), eq(leads.propertyId, propertyId)) });
  if (!lead) return { ok: false, error: "That lead was not found." };
  return createAnalysis(propertyId, leadId);
}
