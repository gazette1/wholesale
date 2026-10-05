"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { dealPackages, dealAnalyses } from "@dealcalc/db";
import { getDb } from "../db";
import { requireSession, requireCan } from "../auth";
import { audit } from "../audit";
import { DEFAULT_SECTIONS } from "../services/packages";
import { emitEvent } from "../services/integrations";
import { friendlyError, isUuid, numberField } from "../safe";
import type { ActionResult } from "./leads";

export async function createPackage(analysisId: string): Promise<never> {
  const session = await requireSession();
  requireCan(session, "buyer:write");
  if (!isUuid(analysisId)) redirect("/analyzer");
  const db = await getDb();
  const analysis = await db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId)) });
  if (!analysis) redirect("/analyzer");
  const last = await db.query.dealPackages.findFirst({ where: and(eq(dealPackages.analysisId, analysisId), eq(dealPackages.orgId, session.orgId)), orderBy: desc(dealPackages.version) });
  const [pkg] = await db.insert(dealPackages).values({ orgId: session.orgId, analysisId, version: (last?.version ?? 0) + 1, shareToken: randomBytes(18).toString("base64url"), sections: DEFAULT_SECTIONS, generatedBy: session.profileId, expiresAt: new Date(Date.now() + 30 * 86_400_000) }).returning();
  await audit(session, { entityType: "package", entityId: pkg!.id, action: "create", after: { analysisId } });
  await emitEvent(session.orgId, "package.created", { packageId: pkg!.id, analysisId, propertyId: analysis.propertyId, leadId: analysis.leadId, version: pkg!.version, expiresAt: pkg!.expiresAt });
  redirect(`/packages/${pkg!.id}/preview`);
}

export async function updatePackageSections(pkgId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "buyer:write");
    if (!isUuid(pkgId)) return { ok: false, error: "Package not found." };
    const db = await getDb();
    const pkg = await db.query.dealPackages.findFirst({ where: and(eq(dealPackages.id, pkgId), eq(dealPackages.orgId, session.orgId)) });
    if (!pkg) return { ok: false, error: "Package not found." };
    const sections = Object.fromEntries(Object.keys(DEFAULT_SECTIONS).map((k) => [k, form.get(`section_${k}`) === "on"]));
    const days = numberField(form.get("expiresDays"), "Days until the link expires", 0, 365, { integer: true });
    if (!days.ok) return days;
    const n = days.value ?? 30;
    await db.update(dealPackages).set({ sections, expiresAt: n > 0 ? new Date(Date.now() + n * 86_400_000) : null }).where(and(eq(dealPackages.id, pkgId), eq(dealPackages.orgId, session.orgId)));
    revalidatePath(`/packages/${pkgId}/preview`);
    return { ok: true, message: n > 0 ? `Package updated. The link works for ${n} more ${n === 1 ? "day" : "days"}.` : "Package updated. The link does not expire." };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not update the package.") };
  }
}

/** Turn the public link off right away, or back on for 30 days. The owner can always open the preview. */
export async function setShareLinkEnabled(pkgId: string, enabled: boolean): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "buyer:write");
    if (!isUuid(pkgId)) return { ok: false, error: "Package not found." };
    const db = await getDb();
    const pkg = await db.query.dealPackages.findFirst({ where: and(eq(dealPackages.id, pkgId), eq(dealPackages.orgId, session.orgId)) });
    if (!pkg) return { ok: false, error: "Package not found." };
    await db.update(dealPackages).set({ expiresAt: enabled ? new Date(Date.now() + 30 * 86_400_000) : new Date(Date.now() - 1000) }).where(and(eq(dealPackages.id, pkgId), eq(dealPackages.orgId, session.orgId)));
    await audit(session, { entityType: "package", entityId: pkgId, action: enabled ? "share_enabled" : "share_disabled" });
    revalidatePath(`/packages/${pkgId}/preview`);
    return { ok: true, message: enabled ? "Link turned on for 30 days" : "Link turned off" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not change the share link.") };
  }
}

/** Open the newest package for an analysis, creating the first one if none exists. Safe to call from a plain link. */
export async function openPackage(analysisId: string): Promise<never> {
  const session = await requireSession();
  if (!isUuid(analysisId)) redirect("/analyzer");
  const db = await getDb();
  const last = await db.query.dealPackages.findFirst({ where: and(eq(dealPackages.analysisId, analysisId), eq(dealPackages.orgId, session.orgId)), orderBy: desc(dealPackages.version) });
  if (last) redirect(`/packages/${last.id}/preview`);
  return createPackage(analysisId);
}
