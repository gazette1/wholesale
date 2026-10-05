"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { leadScores, leads } from "@dealcalc/db";
import { getDb } from "../db";
import { requireSession, requireCan } from "../auth";
import { isUuid, friendlyError, numberField } from "../safe";
import { rescoreLead as runRescoreLead, toMotivationScore } from "../services/lead-scoring";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/** Runs a fresh score for the lead now. Bind the leadId and use with ActionButton (see review/rescore-button.tsx). */
export async function rescoreLeadAction(leadId: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "lead:write");
    if (!isUuid(leadId)) return { ok: false, error: "Lead not found." };
    const result = await runRescoreLead(session.orgId, leadId);
    if (!result.ran) return { ok: false, error: result.reason };
    revalidatePath(`/leads/${leadId}`); revalidatePath("/review");
    return { ok: true, message: `Scored ${result.score} of 100 (motivation ${toMotivationScore(result.score)}), ${result.reviewStatus.replace(/_/g, " ")}` };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not score the lead.") };
  }
}

/** Accepts the scorer's number as is and writes it to leads.motivationScore. */
export async function acceptLeadScore(scoreId: string, leadId: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "lead:write");
    if (!isUuid(scoreId) || !isUuid(leadId)) return { ok: false, error: "Score not found." };
    const db = await getDb();
    const score = await db.query.leadScores.findFirst({ where: and(eq(leadScores.id, scoreId), eq(leadScores.orgId, session.orgId), eq(leadScores.leadId, leadId)) });
    if (!score) return { ok: false, error: "Score not found." };
    await db.update(leadScores).set({ reviewStatus: "accepted", reviewedBy: session.profileId, reviewedAt: new Date() }).where(and(eq(leadScores.id, scoreId), eq(leadScores.orgId, session.orgId)));
    // leads.motivationScore stays on its 1 to 10 scale; lead_scores.score is the model's own 0 to 100.
    await db.update(leads).set({ motivationScore: toMotivationScore(score.score) }).where(and(eq(leads.id, leadId), eq(leads.orgId, session.orgId)));
    revalidatePath("/review"); revalidatePath(`/leads/${leadId}`);
    return { ok: true, message: "Accepted" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not accept the score.") };
  }
}

/**
 * Replaces the scorer's number with a human one. The reviewer types on the same 1 to 10 scale as the
 * lead page's Motivation field (leads.motivationScore is written exactly as typed); lead_scores keeps
 * its own history on the model's 0 to 100 scale, so overrideScore stores the typed value times 10.
 */
export async function overrideLeadScore(scoreId: string, leadId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "lead:write");
    if (!isUuid(scoreId) || !isUuid(leadId)) return { ok: false, error: "Score not found." };
    const parsed = numberField(form.get("overrideScore"), "Motivation", 1, 10, { integer: true });
    if (!parsed.ok) return parsed;
    if (parsed.value == null) return { ok: false, error: "Enter a motivation score from 1 to 10." };
    const db = await getDb();
    const score = await db.query.leadScores.findFirst({ where: and(eq(leadScores.id, scoreId), eq(leadScores.orgId, session.orgId), eq(leadScores.leadId, leadId)) });
    if (!score) return { ok: false, error: "Score not found." };
    await db.update(leadScores).set({ reviewStatus: "overridden", overrideScore: parsed.value * 10, reviewedBy: session.profileId, reviewedAt: new Date() }).where(and(eq(leadScores.id, scoreId), eq(leadScores.orgId, session.orgId)));
    await db.update(leads).set({ motivationScore: parsed.value }).where(and(eq(leads.id, leadId), eq(leads.orgId, session.orgId)));
    revalidatePath("/review"); revalidatePath(`/leads/${leadId}`);
    return { ok: true, message: "Saved" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not save the override.") };
  }
}
