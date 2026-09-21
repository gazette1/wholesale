import { and, desc, eq, isNull } from "drizzle-orm";
import { leads, activities, messages, calls, dealAnalyses, propertyReports, properties, leadScores } from "@dealcalc/db";
import { judgmentProvider, scoreLead as runScoreLead, scoreToMotivation, AUTO_ACT_CONFIDENCE, SUGGEST_CONFIDENCE, type LeadTouches } from "@dealcalc/integrations";
import { getDb } from "../db";

/**
 * Converts a model's 0 to 100 score to the 1 to 10 scale leads.motivationScore has always used (the
 * lead page's "Motivation (1 to 10)" field, its sort, and its form validation, none of which change).
 * lead_scores.score keeps the model's native 0 to 100 scale; every write into the 1 to 10 column that
 * originates from a model score must go through this, and this is the only place that does the math.
 */
export const toMotivationScore = scoreToMotivation;

/** Most recent touches of each kind pulled into one scoring run. A log this long is plenty of signal; older history rarely changes the picture. */
const MAX_TOUCHES_PER_KIND = 100;

function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function gatherTouches(orgId: string, leadId: string): Promise<{ leadFound: boolean; touches: LeadTouches }> {
  const db = await getDb();
  const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, leadId), eq(leads.orgId, orgId)) });
  if (!lead) return { leadFound: false, touches: { notes: [], inboundMessages: [], outboundMessages: [], callOutcomes: [], flaggedIssues: [], sellerUrgency: "none", askingPrice: null, estimatedValue: null } };

  const [noteRows, callActivityRows, messageRows, callRows, analysis, report] = await Promise.all([
    db.select({ payload: activities.payload }).from(activities).where(and(eq(activities.orgId, orgId), eq(activities.leadId, leadId), eq(activities.type, "note"))).orderBy(desc(activities.occurredAt)).limit(MAX_TOUCHES_PER_KIND),
    db.select({ payload: activities.payload }).from(activities).where(and(eq(activities.orgId, orgId), eq(activities.leadId, leadId), eq(activities.type, "call"))).orderBy(desc(activities.occurredAt)).limit(MAX_TOUCHES_PER_KIND),
    db.select({ direction: messages.direction, body: messages.body }).from(messages).where(and(eq(messages.orgId, orgId), eq(messages.leadId, leadId))).orderBy(desc(messages.createdAt)).limit(MAX_TOUCHES_PER_KIND),
    db.select({ outcome: calls.outcome, notes: calls.notes }).from(calls).where(and(eq(calls.orgId, orgId), eq(calls.leadId, leadId))).orderBy(desc(calls.createdAt)).limit(MAX_TOUCHES_PER_KIND),
    db.select().from(dealAnalyses).where(and(eq(dealAnalyses.orgId, orgId), eq(dealAnalyses.propertyId, lead.propertyId), isNull(dealAnalyses.trashedAt))).orderBy(desc(dealAnalyses.isPrimary), desc(dealAnalyses.version)).limit(1).then((r) => r[0]),
    db.query.propertyReports.findFirst({ where: eq(propertyReports.propertyId, lead.propertyId), orderBy: desc(propertyReports.fetchedAt) }),
  ]);

  const notes = noteRows.map((r) => String((r.payload as Record<string, unknown>)?.text ?? "")).filter(Boolean);
  const callOutcomes = [
    ...callActivityRows.map((r) => String((r.payload as Record<string, unknown>)?.text ?? "")).filter(Boolean),
    ...callRows.map((r) => [r.outcome, r.notes].filter(Boolean).join(": ")).filter(Boolean),
  ];
  const inboundMessages = messageRows.filter((m) => m.direction === "in").map((m) => m.body).filter(Boolean);
  const outboundMessages = messageRows.filter((m) => m.direction === "out").map((m) => m.body).filter(Boolean);
  const issues = (lead.dealIssues ?? {}) as Record<string, { flagged?: boolean } | number | undefined>;
  const flaggedIssues = Object.entries(issues).filter(([k, v]) => k !== "messyScore" && v && typeof v === "object" && v.flagged).map(([k]) => k);
  const estimatedValue = toNum(analysis?.arv) ?? report?.normalized?.arv?.estimate ?? report?.normalized?.valuation?.avm ?? null;

  const touches: LeadTouches = { notes, inboundMessages, outboundMessages, callOutcomes, flaggedIssues, sellerUrgency: lead.sellerUrgency, askingPrice: toNum(lead.askingPrice), estimatedValue };
  return { leadFound: true, touches };
}

export type RescoreResult = { ran: true; leadScoreId: string; score: number; confidence: number; reviewStatus: string } | { ran: false; reason: string };

/**
 * Score a lead from every touch recorded on it and store the result as a new lead_scores row.
 * Confidence, not the score itself, decides what happens next: above AUTO_ACT_CONFIDENCE the score is
 * written straight to leads.motivationScore and reviewStatus is auto_applied; above SUGGEST_CONFIDENCE it
 * is stored as a suggestion; otherwise it waits in the review queue. Thresholds are the fixed
 * AUTO_ACT_CONFIDENCE and SUGGEST_CONFIDENCE constants from @dealcalc/integrations. Never throws: callers
 * (including the two suggestIssuesFromText call sites in apps/web/lib/actions/leads.ts, and the Rescore
 * button) can call this best effort, the way autoEnrichNewLead is called after a lead is created.
 */
export async function rescoreLead(orgId: string, leadId: string): Promise<RescoreResult> {
  try {
    const { leadFound, touches } = await gatherTouches(orgId, leadId);
    if (!leadFound) return { ran: false, reason: "Lead not found." };
    const result = await runScoreLead(judgmentProvider(), touches);
    const reviewStatus = result.confidence > AUTO_ACT_CONFIDENCE ? "auto_applied" : result.confidence > SUGGEST_CONFIDENCE ? "suggested" : "needs_review";
    const db = await getDb();
    const [row] = await db.insert(leadScores).values({ orgId, leadId, score: result.score, confidence: result.confidence.toFixed(3), reasons: result.reasons, provider: result.provider, reviewStatus }).returning();
    if (reviewStatus === "auto_applied") await db.update(leads).set({ motivationScore: toMotivationScore(result.score) }).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
    return { ran: true, leadScoreId: row!.id, score: result.score, confidence: result.confidence, reviewStatus };
  } catch (err) {
    console.error("[lead scoring]", err);
    return { ran: false, reason: "The lead could not be scored." };
  }
}

export type ReviewQueueRow = { id: string; leadId: string; score: number; confidence: number; reasons: string[]; reviewStatus: string; createdAt: Date; address: string | null; city: string | null; motivation: number };

/**
 * The most recent score per lead that is still suggested or needs review, newest first. Read only, used
 * by the /review page. A lead scored more than once only shows its latest run; an older run that was
 * superseded is not shown even though its row is kept.
 */
export async function listReviewQueue(orgId: string): Promise<ReviewQueueRow[]> {
  const db = await getDb();
  const rows = await db.select({ id: leadScores.id, leadId: leadScores.leadId, score: leadScores.score, confidence: leadScores.confidence, reasons: leadScores.reasons, reviewStatus: leadScores.reviewStatus, createdAt: leadScores.createdAt, address: properties.addressLine1, city: properties.city })
    .from(leadScores).innerJoin(leads, eq(leadScores.leadId, leads.id)).innerJoin(properties, eq(leads.propertyId, properties.id))
    .where(eq(leadScores.orgId, orgId)).orderBy(desc(leadScores.createdAt)).limit(500);
  const latestByLead = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latestByLead.has(r.leadId)) latestByLead.set(r.leadId, r);
  return Array.from(latestByLead.values())
    .filter((r) => r.reviewStatus === "needs_review" || r.reviewStatus === "suggested")
    .map((r) => ({ ...r, confidence: Number(r.confidence), reasons: r.reasons ?? [], motivation: toMotivationScore(r.score) }));
}
