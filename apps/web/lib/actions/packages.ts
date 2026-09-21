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
import type { ActionResult } from "./leads";

export async function createPackage(analysisId: string): Promise<never> {
  const session = await requireSession();
  requireCan(session, "buyer:write");
  const db = await getDb();
  const analysis = await db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.id, analysisId), eq(dealAnalyses.orgId, session.orgId)) });
  if (!analysis) redirect("/analyzer");
  const last = await db.query.dealPackages.findFirst({ where: eq(dealPackages.analysisId, analysisId), orderBy: desc(dealPackages.version) });
  const [pkg] = await db.insert(dealPackages).values({ orgId: session.orgId, analysisId, version: (last?.version ?? 0) + 1, shareToken: randomBytes(18).toString("base64url"), sections: DEFAULT_SECTIONS, generatedBy: session.profileId, expiresAt: new Date(Date.now() + 30 * 86_400_000) }).returning();
  await audit(session, { entityType: "package", entityId: pkg!.id, action: "create", after: { analysisId } });
  await emitEvent(session.orgId, "package.created", { packageId: pkg!.id, analysisId, propertyId: analysis.propertyId, leadId: analysis.leadId, version: pkg!.version, expiresAt: pkg!.expiresAt });
  redirect(`/packages/${pkg!.id}/preview`);
}

export async function updatePackageSections(pkgId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  requireCan(session, "buyer:write");
  const db = await getDb();
  const pkg = await db.query.dealPackages.findFirst({ where: and(eq(dealPackages.id, pkgId), eq(dealPackages.orgId, session.orgId)) });
  if (!pkg) return { ok: false, error: "Package not found." };
  const sections = Object.fromEntries(Object.keys(DEFAULT_SECTIONS).map((k) => [k, form.get(`section_${k}`) === "on"]));
  const days = Number(form.get("expiresDays") ?? 30);
  await db.update(dealPackages).set({ sections, expiresAt: days > 0 ? new Date(Date.now() + days * 86_400_000) : null }).where(eq(dealPackages.id, pkgId));
  revalidatePath(`/packages/${pkgId}/preview`);
  return { ok: true, message: "Package updated" };
}
