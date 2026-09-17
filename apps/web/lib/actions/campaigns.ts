"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, max } from "drizzle-orm";
import { campaigns, campaignSteps, campaignEnrollments, messageTemplates } from "@dealcalc/db";
import { getDb } from "../db";
import { requireSession, requireCan } from "../auth";
import { audit } from "../audit";
import { dispatchDue, enrollSegment } from "../services/campaigns";
import type { ActionResult } from "./leads";

export async function createCampaign(form: FormData): Promise<never> {
  const session = await requireSession();
  requireCan(session, "campaign:write");
  const db = await getDb();
  const name = String(form.get("name") ?? "").trim() || "New campaign";
  const stageKeys = String(form.get("stageKeys") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const [c] = await db.insert(campaigns).values({ orgId: session.orgId, name, channel: (String(form.get("channel") || "sms")) as any, status: "draft", segment: { stageKeys, maxAttempts: form.get("maxAttempts") ? Number(form.get("maxAttempts")) : undefined }, createdBy: session.profileId }).returning();
  await audit(session, { entityType: "campaign", entityId: c!.id, action: "create" });
  revalidatePath("/campaigns");
  redirect(`/campaigns/${c!.id}`);
}

export async function addStep(campaignId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  requireCan(session, "campaign:write");
  const db = await getDb();
  const templateId = String(form.get("templateId") ?? "");
  if (!templateId) return { ok: false, error: "Pick a template." };
  const [pos] = await db.select({ p: max(campaignSteps.position) }).from(campaignSteps).where(eq(campaignSteps.campaignId, campaignId));
  await db.insert(campaignSteps).values({ orgId: session.orgId, campaignId, position: (pos?.p ?? 0) + 1, delayHours: Number(form.get("delayHours") ?? 24), templateId, stopOnReply: form.get("stopOnReply") !== "off" });
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

export async function removeStep(campaignId: string, stepId: string): Promise<ActionResult> {
  const session = await requireSession();
  requireCan(session, "campaign:write");
  const db = await getDb();
  await db.delete(campaignSteps).where(and(eq(campaignSteps.id, stepId), eq(campaignSteps.orgId, session.orgId)));
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

export async function setCampaignStatus(campaignId: string, status: "draft" | "active" | "paused" | "done"): Promise<ActionResult> {
  const session = await requireSession();
  requireCan(session, "campaign:write");
  const db = await getDb();
  const c = await db.query.campaigns.findFirst({ where: and(eq(campaigns.id, campaignId), eq(campaigns.orgId, session.orgId)) });
  if (!c) return { ok: false, error: "Campaign not found." };
  await db.update(campaigns).set({ status }).where(eq(campaigns.id, campaignId));
  await audit(session, { entityType: "campaign", entityId: campaignId, action: "status", before: { status: c.status }, after: { status } });
  revalidatePath(`/campaigns/${campaignId}`); revalidatePath("/campaigns");
  return { ok: true, message: `Campaign ${status}` };
}

export async function enrollMatching(campaignId: string): Promise<ActionResult> {
  const session = await requireSession();
  requireCan(session, "campaign:write");
  const n = await enrollSegment(session.orgId, campaignId);
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true, message: `Enrolled ${n} lead${n === 1 ? "" : "s"}` };
}

export async function stopEnrollment(enrollmentId: string, campaignId: string): Promise<ActionResult> {
  const session = await requireSession();
  requireCan(session, "campaign:write");
  const db = await getDb();
  await db.update(campaignEnrollments).set({ status: "stopped", nextSendAt: null }).where(and(eq(campaignEnrollments.id, enrollmentId), eq(campaignEnrollments.orgId, session.orgId)));
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

export async function runDispatchNow(): Promise<ActionResult> {
  const session = await requireSession();
  requireCan(session, "campaign:write");
  const r = await dispatchDue(100);
  revalidatePath("/campaigns");
  return { ok: true, message: `Sent ${r.sent}, skipped ${r.skipped}, failed ${r.failed}${r.details.length ? `: ${r.details[0]}` : ""}` };
}

export async function saveTemplate(templateId: string | null, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "campaign:write");
    const db = await getDb();
    const values = { channel: (String(form.get("channel") || "sms")) as any, name: String(form.get("name") ?? "").trim(), subject: String(form.get("subject") ?? "") || null, body: String(form.get("body") ?? "").trim(), mergeFields: Array.from(new Set(Array.from(String(form.get("body") ?? "").matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)).map((m) => m[1]!))), active: form.get("active") !== "off" };
    if (!values.name || !values.body) return { ok: false, error: "Name and body are required." };
    if (templateId) await db.update(messageTemplates).set(values).where(and(eq(messageTemplates.id, templateId), eq(messageTemplates.orgId, session.orgId)));
    else await db.insert(messageTemplates).values({ orgId: session.orgId, ...values });
    revalidatePath("/templates");
    return { ok: true, message: "Template saved" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not save." };
  }
}

export async function deleteTemplate(templateId: string): Promise<ActionResult> {
  const session = await requireSession();
  requireCan(session, "campaign:write");
  const db = await getDb();
  try {
    await db.delete(messageTemplates).where(and(eq(messageTemplates.id, templateId), eq(messageTemplates.orgId, session.orgId)));
  } catch {
    return { ok: false, error: "This template is used by a campaign step. Remove the step first." };
  }
  revalidatePath("/templates");
  return { ok: true };
}
