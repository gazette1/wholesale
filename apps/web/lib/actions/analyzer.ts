"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { dealAnalyses, activities, leads, dealPackages, dealSubmissions } from "@dealcalc/db";
import { DealInputSchema, type DealInput } from "@dealcalc/engine";
import { getDb } from "../db";
import { requireSession, requireCan } from "../auth";
import { audit } from "../audit";
import { buildDefaultInputs, nextVersion, persistAnalysis, runDeal } from "../services/analysis";
import type { ActionResult } from "./leads";
import { friendlyError, isUuid } from "../safe";
import { emitEvent } from "../services/integrations";

type Database = Awaited<ReturnType<typeof getDb>>;

/** Give the primary flag to the newest version of the property that is still usable (not trashed, not rejected). */
async function handOffPrimary(db: Database, orgId: string, propertyId: string, excludeId: string): Promise<void> {
  const candidates = await db.select({ id: dealAnalyses.id, status: dealAnalyses.status }).from(dealAnalyses)
    .where(and(eq(dealAnalyses.propertyId, propertyId), eq(dealAnalyses.orgId, orgId), isNull(dealAnalyses.trashedAt), ne(dealAnalyses.id, excludeId))).orderBy(desc(dealAnalyses.version));
  const next = candidates.find((c) => c.status === "approved_for_offer") ?? candidates.find((c) => c.status !== "rejected") ?? null;
  // Bookkeeping, not an edit: keep updated_at so the Updated column and the recent sort reflect real changes.
  if (next) await db.update(dealAnalyses).set({ isPrimary: true, updatedAt: sql`${dealAnalyses.updatedAt}` }).where(and(eq(dealAnalyses.id, next.id), eq(dealAnalyses.orgId, orgId)));
}

/** Schema errors in words a person can act on. Rates are stored as fractions, so 0.5 reads as 50%. */
function inputErrorText(issues: { path: (string | number)[]; message: string; code: string; maximum?: unknown; minimum?: unknown }[]): string {
  const words = (path: (string | number)[]) => String(path[path.length - 1] ?? "value").replace(/Pct$|Rate$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  const isRate = (path: (string | number)[]) => /Pct$|Rate$|arvFactor|probability/.test(String(path[path.length - 1] ?? ""));
  const fmt = (n: unknown, path: (string | number)[]) => (isRate(path) ? `${Math.round(Number(n) * 10000) / 100}%` : Number(n).toLocaleString("en-US"));
  return Array.from(new Set(issues.slice(0, 4).map((i) => {
    if (i.code === "too_big" && i.maximum != null) return `The ${words(i.path)} field must be ${fmt(i.maximum, i.path)} or less.`;
    if (i.code === "too_small" && i.minimum != null) return `The ${words(i.path)} field must be ${fmt(i.minimum, i.path)} or more.`;
    return `Check the ${words(i.path)} field.`;
  }))).join(" ");
}

export async function createAnalysis(propertyId: string, leadId: string | null): Promise<never> {
  const session = await requireSession();
  requireCan(session, "analysis:write");
  const db = await getDb();
  // A double click, a retry, or two tabs: if this person made an analysis for this property in the last 5 seconds, open that one.
  const recent = await db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.propertyId, propertyId), eq(dealAnalyses.orgId, session.orgId), eq(dealAnalyses.createdBy, session.profileId), gt(dealAnalyses.createdAt, new Date(Date.now() - 5000))), orderBy: desc(dealAnalyses.createdAt) });
  if (recent) redirect(`/analyzer/${recent.id}`);
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
  const source = isUuid(analysisId) ? await db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId)) }) : null;
  if (!source) redirect("/analyzer");
  const version = await nextVersion(source.propertyId);
  // "Base case copy", then "Base case copy 2", so two clones of one version can be told apart.
  const siblings = await db.select({ name: dealAnalyses.name }).from(dealAnalyses).where(and(eq(dealAnalyses.propertyId, source.propertyId), eq(dealAnalyses.orgId, session.orgId)));
  const base = `${source.name.replace(/ copy( \d+)?$/, "")} copy`.slice(0, 70);
  let name = base;
  for (let n = 2; siblings.some((x) => x.name === name); n++) name = `${base} ${n}`;
  const inputs = { ...source.inputs, meta: { ...source.inputs.meta, name } } as DealInput;
  const [row] = await db.insert(dealAnalyses).values({ orgId: session.orgId, propertyId: source.propertyId, leadId: source.leadId, version, name, status: "draft", inputs, outputs: {}, engineVersion: "pending", notes: source.notes, strategy: source.strategy, createdBy: session.profileId }).returning();
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
    if (!isUuid(analysisId)) return { ok: false, error: "Analysis not found." };
    const row = await db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId)) });
    if (!row) return { ok: false, error: "Analysis not found." };
    if (row.status !== "draft" && row.status !== "reviewing") return { ok: false, error: "This version is locked. Clone it to make changes." };
    const parsed = DealInputSchema.safeParse(payload.inputs);
    if (!parsed.success) return { ok: false, error: inputErrorText(parsed.error.issues as never) };
    if (row.trashedAt) return { ok: false, error: "This version is in the trash. Restore it before editing." };
    await persistAnalysis(analysisId, session.orgId, parsed.data);
    await db.update(dealAnalyses).set({ name: payload.name?.trim() || row.name, notes: payload.notes ?? row.notes }).where(eq(dealAnalyses.id, analysisId));
    revalidatePath(`/analyzer/${analysisId}`); revalidatePath("/analyzer"); if (row.leadId) revalidatePath(`/leads/${row.leadId}`); revalidatePath("/pipeline");
    const out = runDeal(parsed.data);
    void emitEvent(session.orgId, "analysis.saved", { analysisId, leadId: row.leadId, propertyId: row.propertyId, version: row.version, name: payload.name?.trim() || row.name, arv: out.effectiveArv, purchasePrice: parsed.data.acquisitions.purchasePrice, maxAllowableOffer: out.wholesale.maxAllowableOffer, spread: out.wholesale.spread, netProfit: out.acquisitions.netProfit, strategy: parsed.data.meta.strategy ?? "wholesale" });
    return { ok: true, message: "Saved" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not save the analysis.") };
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
  try {
    requireCan(session, "analysis:write");
    if (!isUuid(analysisId) || !["draft", "reviewing", "approved_for_offer", "rejected"].includes(status)) return { ok: false, error: "Analysis not found." };
    const db = await getDb();
    const row = await db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId)) });
    if (!row) return { ok: false, error: "Analysis not found." };
    if (row.trashedAt) return { ok: false, error: "This version is in the trash. Restore it first." };
    await db.update(dealAnalyses).set({ status }).where(and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId)));
    if (status === "approved_for_offer") {
      await db.update(dealAnalyses).set({ isPrimary: false }).where(and(eq(dealAnalyses.propertyId, row.propertyId), eq(dealAnalyses.orgId, session.orgId)));
      await db.update(dealAnalyses).set({ isPrimary: true }).where(and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId)));
    }
    if (status === "rejected" && row.isPrimary) {
      // A rejected version should not be the one the pipeline card and the lead show, when another version can take over.
      const others = await db.select({ id: dealAnalyses.id }).from(dealAnalyses).where(and(eq(dealAnalyses.propertyId, row.propertyId), eq(dealAnalyses.orgId, session.orgId), isNull(dealAnalyses.trashedAt), ne(dealAnalyses.id, analysisId), ne(dealAnalyses.status, "rejected")));
      if (others.length) {
        await db.update(dealAnalyses).set({ isPrimary: false }).where(and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId)));
        await handOffPrimary(db, session.orgId, row.propertyId, analysisId);
      }
    }
    if (row.leadId) await db.insert(activities).values({ orgId: session.orgId, leadId: row.leadId, actorId: session.profileId, type: "analysis", payload: { analysisId, status, text: `Analysis v${row.version} marked ${status.replace(/_/g, " ")}` } });
    await audit(session, { entityType: "analysis", entityId: analysisId, action: "status", before: { status: row.status }, after: { status } });
    void emitEvent(session.orgId, "analysis.status_changed", { analysisId, leadId: row.leadId, propertyId: row.propertyId, version: row.version, from: row.status, to: status });
    revalidatePath(`/analyzer/${analysisId}`); revalidatePath("/analyzer"); revalidatePath("/pipeline"); if (row.leadId) revalidatePath(`/leads/${row.leadId}`);
    return { ok: true, message: `Marked ${status.replace(/_/g, " ")}` };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not change the status.") };
  }
}

export async function deleteAnalysis(analysisId: string): Promise<never | ActionResult> {
  const session = await requireSession();
  let row: typeof dealAnalyses.$inferSelect | undefined;
  try {
    requireCan(session, "analysis:write");
    if (!isUuid(analysisId)) return { ok: false, error: "Analysis not found." };
    const db = await getDb();
    row = await db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId)) });
    if (!row) return { ok: false, error: "Analysis not found." };
    if (row.status === "approved_for_offer") return { ok: false, error: "Approved analyses cannot be deleted. Reject it first." };
    // Deleting cascades to deal packages (and their share links) and to the record of which buyers were sent the deal.
    const [pkg, sub] = await Promise.all([
      db.query.dealPackages.findFirst({ where: and(eq(dealPackages.analysisId, analysisId), eq(dealPackages.orgId, session.orgId)) }),
      db.query.dealSubmissions.findFirst({ where: and(eq(dealSubmissions.analysisId, analysisId), eq(dealSubmissions.orgId, session.orgId)) }),
    ]);
    if (pkg || sub) return { ok: false, error: `This version has ${pkg ? "a deal package with a share link" : ""}${pkg && sub ? " and " : ""}${sub ? "a record of buyers it was sent to" : ""}. Move it to trash from the analyzer list instead, which keeps those.` };
    await audit(session, { entityType: "analysis", entityId: analysisId, action: "delete", before: { version: row.version, name: row.name } });
    await db.delete(dealAnalyses).where(and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId)));
    if (row.isPrimary) await handOffPrimary(db, session.orgId, row.propertyId, analysisId);
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not delete the analysis.") };
  }
  revalidatePath("/analyzer"); revalidatePath("/pipeline");
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
    if (op === "trash" && row.isPrimary) await handOffPrimary(db, session.orgId, row.propertyId, analysisId);
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
