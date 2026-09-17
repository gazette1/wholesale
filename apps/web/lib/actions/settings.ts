"use server";
import { revalidatePath } from "next/cache";
import { and, eq, max } from "drizzle-orm";
import { profiles, pipelineStages, leadSources, orgs, tags } from "@dealcalc/db";
import { getDb } from "../db";
import { requireSession } from "../auth";
import { audit } from "../audit";
import type { ActionResult } from "./leads";

function admin(session: Awaited<ReturnType<typeof requireSession>>) {
  if (session.role !== "admin") throw new Error("Admins only.");
}

export async function inviteProfile(form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    admin(session);
    const db = await getDb();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const fullName = String(form.get("fullName") ?? "").trim();
    if (!email || !fullName) return { ok: false, error: "Name and email are required." };
    const [p] = await db.insert(profiles).values({ orgId: session.orgId, email, fullName, role: (String(form.get("role") || "viewer")) as any, phone: String(form.get("phone") ?? "") || null, twilioNumber: String(form.get("twilioNumber") ?? "") || null }).returning();
    await audit(session, { entityType: "profile", entityId: p!.id, action: "invite", after: { email, role: p!.role } });
    revalidatePath("/settings");
    return { ok: true, message: `${fullName} can now sign in with ${email}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not add the team member." };
  }
}

export async function updateProfile(profileId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    admin(session);
    const db = await getDb();
    const p = await db.query.profiles.findFirst({ where: and(eq(profiles.id, profileId), eq(profiles.orgId, session.orgId)) });
    if (!p) return { ok: false, error: "Profile not found." };
    const role = String(form.get("role") ?? p.role) as any;
    const active = form.get("active") !== "off";
    if (p.id === session.profileId && (role !== "admin" || !active)) return { ok: false, error: "You cannot remove your own admin access." };
    await db.update(profiles).set({ role, active, fullName: String(form.get("fullName") || p.fullName), email: String(form.get("email") || p.email).toLowerCase(), twilioNumber: String(form.get("twilioNumber") ?? "") || null, phone: String(form.get("phone") ?? "") || null }).where(eq(profiles.id, profileId));
    await audit(session, { entityType: "profile", entityId: profileId, action: "update", before: { role: p.role, active: p.active }, after: { role, active } });
    revalidatePath("/settings");
    return { ok: true, message: "Saved" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not save." };
  }
}

export async function saveStage(stageId: string | null, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    admin(session);
    const db = await getDb();
    const name = String(form.get("name") ?? "").trim();
    if (!name) return { ok: false, error: "Stage needs a name." };
    const key = String(form.get("key") ?? "").trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const color = String(form.get("color") ?? "#6b7280");
    const isTerminal = form.get("isTerminal") === "on";
    if (stageId) await db.update(pipelineStages).set({ name, color, isTerminal }).where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.orgId, session.orgId)));
    else {
      const [pos] = await db.select({ p: max(pipelineStages.position) }).from(pipelineStages).where(eq(pipelineStages.orgId, session.orgId));
      await db.insert(pipelineStages).values({ orgId: session.orgId, key, name, color, isTerminal, position: (pos?.p ?? 0) + 1 });
    }
    revalidatePath("/settings"); revalidatePath("/pipeline");
    return { ok: true, message: "Stage saved" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not save." };
  }
}

export async function moveStage(stageId: string, direction: -1 | 1): Promise<ActionResult> {
  const session = await requireSession();
  admin(session);
  const db = await getDb();
  const all = await db.select().from(pipelineStages).where(eq(pipelineStages.orgId, session.orgId)).orderBy(pipelineStages.position);
  const i = all.findIndex((s) => s.id === stageId);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= all.length) return { ok: true };
  await db.update(pipelineStages).set({ position: all[j]!.position }).where(eq(pipelineStages.id, all[i]!.id));
  await db.update(pipelineStages).set({ position: all[i]!.position }).where(eq(pipelineStages.id, all[j]!.id));
  revalidatePath("/settings"); revalidatePath("/pipeline");
  return { ok: true };
}

export async function saveSource(form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  admin(session);
  const db = await getDb();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Source needs a name." };
  await db.insert(leadSources).values({ orgId: session.orgId, name, costPerLead: form.get("costPerLead") ? String(Number(form.get("costPerLead"))) : null }).onConflictDoNothing();
  revalidatePath("/settings");
  return { ok: true };
}

export async function saveBranding(form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  admin(session);
  const db = await getDb();
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, session.orgId) });
  const branding = { ...(org?.branding ?? {}), companyName: String(form.get("companyName") ?? "") || undefined, phone: String(form.get("phone") ?? "") || undefined, email: String(form.get("email") ?? "") || undefined, primaryColor: String(form.get("primaryColor") ?? "") || undefined, disclosure: String(form.get("disclosure") ?? "") || undefined, logoUrl: String(form.get("logoUrl") ?? "") || undefined };
  await db.update(orgs).set({ name: String(form.get("orgName") || org?.name || "Workspace"), branding }).where(eq(orgs.id, session.orgId));
  revalidatePath("/settings"); revalidatePath("/", "layout");
  return { ok: true, message: "Branding saved" };
}

export async function deleteTag(tagId: string): Promise<ActionResult> {
  const session = await requireSession();
  admin(session);
  const db = await getDb();
  await db.delete(tags).where(and(eq(tags.id, tagId), eq(tags.orgId, session.orgId)));
  revalidatePath("/settings");
  return { ok: true };
}
