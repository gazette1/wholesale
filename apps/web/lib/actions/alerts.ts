"use server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, or } from "drizzle-orm";
import { alerts } from "@dealcalc/db";
import { getDb } from "../db";
import { requireSession } from "../auth";
import { isUuid, friendlyError } from "../safe";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

async function ownedAlert(orgId: string, profileId: string, alertId: string) {
  const db = await getDb();
  const alert = await db.query.alerts.findFirst({ where: and(eq(alerts.id, alertId), eq(alerts.orgId, orgId)) });
  // An org wide alert (no recipient) belongs to everyone in the org; a targeted one belongs only to its recipient.
  if (alert && alert.recipientId && alert.recipientId !== profileId) return null;
  return alert ?? null;
}

export async function markAlertRead(alertId: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    if (!isUuid(alertId)) return { ok: false, error: "Alert not found." };
    const alert = await ownedAlert(session.orgId, session.profileId, alertId);
    if (!alert) return { ok: false, error: "Alert not found." };
    if (!alert.readAt) {
      const db = await getDb();
      await db.update(alerts).set({ readAt: new Date() }).where(and(eq(alerts.id, alertId), eq(alerts.orgId, session.orgId)));
    }
    revalidatePath("/alerts"); revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not mark the alert read.") };
  }
}

export async function dismissAlert(alertId: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    if (!isUuid(alertId)) return { ok: false, error: "Alert not found." };
    const alert = await ownedAlert(session.orgId, session.profileId, alertId);
    if (!alert) return { ok: false, error: "Alert not found." };
    const db = await getDb();
    await db.update(alerts).set({ dismissedAt: new Date(), readAt: alert.readAt ?? new Date() }).where(and(eq(alerts.id, alertId), eq(alerts.orgId, session.orgId)));
    revalidatePath("/alerts"); revalidatePath("/dashboard");
    return { ok: true, message: "Dismissed" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not dismiss the alert.") };
  }
}

/** Marks every alert visible to this profile as read: its own, plus org wide alerts with no recipient. */
export async function markAllAlertsRead(): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const db = await getDb();
    await db.update(alerts).set({ readAt: new Date() }).where(and(eq(alerts.orgId, session.orgId), or(eq(alerts.recipientId, session.profileId), isNull(alerts.recipientId)), isNull(alerts.readAt)));
    revalidatePath("/alerts"); revalidatePath("/dashboard");
    return { ok: true, message: "Marked all read" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not mark alerts read.") };
  }
}
