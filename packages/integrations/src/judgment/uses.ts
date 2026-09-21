import type { JudgmentProvider, ChoiceAnswer, ProbabilityAnswer, ProbabilityQuestion } from "./types";
import { AUTO_ACT_CONFIDENCE, SUGGEST_CONFIDENCE } from "./types";

/**
 * The specific judgments the CRM asks for. Each returns a typed result plus
 * the provider's confidence so the caller can decide: act, suggest, or ask a
 * human. See docs/INTEGRATIONS.md for where each one is used.
 */

export const REPLY_INTENTS = ["interested", "not_interested", "stop", "wrong_number", "question", "callback_request", "price_given", "other"] as const;
export type ReplyIntent = (typeof REPLY_INTENTS)[number];

export type ReplyClassification = {
  intent: ReplyIntent;
  confidence: number;
  urgency: number;
  action: "auto" | "suggest" | "review";
  amountMentioned: number | null;
  provider: string;
};

/** Dollar amounts in free text: $150k, 150,000, 150 thousand. */
export function extractDollarAmounts(text: string): number[] {
  const out: number[] = [];
  const re = /\$?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|thousand|m|mm|million)?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let v = Number(m[1]!.replace(/,/g, ""));
    const unit = (m[2] ?? "").toLowerCase();
    if (unit === "k" || unit === "thousand") v *= 1000;
    if (unit === "m" || unit === "mm" || unit === "million") v *= 1_000_000;
    if (v >= 1000 && v < 50_000_000) out.push(v);
  }
  return Array.from(new Set(out));
}

function actionFor(confidence: number): ReplyClassification["action"] {
  if (confidence >= AUTO_ACT_CONFIDENCE) return "auto";
  if (confidence >= SUGGEST_CONFIDENCE) return "suggest";
  return "review";
}

/** Classify an inbound SMS or email reply from a seller. */
export async function classifyReply(provider: JudgmentProvider, input: { body: string; lastOutbound?: string; propertyAddress?: string }): Promise<ReplyClassification> {
  const state = [
    input.propertyAddress ? `Property: ${input.propertyAddress}` : null,
    input.lastOutbound ? `Our last message: ${input.lastOutbound}` : null,
    `Seller reply: ${input.body}`,
  ].filter(Boolean).join("\n");
  const result = await provider.ask(state, [
    { id: "intent", type: "choice", question: "What is the seller's intent in this reply?", options: [...REPLY_INTENTS] },
    { id: "urgent", type: "noul", question: "Does the seller need to sell soon or show urgency?" },
  ]);
  const intent = result.answers["intent"] as ChoiceAnswer | undefined;
  const urgent = result.answers["urgent"] as ProbabilityAnswer | undefined;
  const amounts = extractDollarAmounts(input.body);
  return {
    intent: (intent?.choice as ReplyIntent) ?? "other",
    confidence: intent?.confidence ?? 0,
    urgency: urgent?.probability ?? 0,
    action: actionFor(intent?.confidence ?? 0),
    amountMentioned: amounts[0] ?? null,
    provider: result.provider,
  };
}

export const DISTRESS_SIGNALS = ["dirty_title", "probate_or_inherited", "liens_or_judgments", "mortgage_default_or_foreclosure", "code_violations", "poor_condition", "occupied_by_tenant", "occupied_by_squatter", "seller_urgency", "divorce_or_partner_dispute", "tax_delinquent", "hoarder_or_environmental"] as const;

export type DistressAssessment = { signals: Record<string, number>; motivationScore: number; provider: string };

/** Read call notes and rate each deal thesis signal 0 to 1. Used to pre fill the deal issues checklist. */
export async function assessDistress(provider: JudgmentProvider, notes: string): Promise<DistressAssessment> {
  const questions: ProbabilityQuestion[] = DISTRESS_SIGNALS.map((s) => ({ id: s, type: "noul" as const, question: `Do these notes indicate ${s.replace(/_/g, " ")}?` }));
  questions.push({ id: "motivated", type: "noul", question: "Is the seller motivated to sell below market for speed or certainty?" });
  const result = await provider.ask(`Call notes: ${notes}`, questions);
  const signals: Record<string, number> = {};
  for (const s of DISTRESS_SIGNALS) signals[s] = (result.answers[s] as ProbabilityAnswer | undefined)?.probability ?? 0;
  const motivated = (result.answers["motivated"] as ProbabilityAnswer | undefined)?.probability ?? 0;
  return { signals, motivationScore: Math.round(motivated * 10), provider: result.provider };
}

export type BuyerCriteriaGuess = { funding: string; sightUnseen: number; conditionLevels: number[]; provider: string; confidence: number };

/** Turn buyer call notes into buy box fields for the dispositions team to confirm. */
export async function inferBuyerCriteria(provider: JudgmentProvider, notes: string): Promise<BuyerCriteriaGuess> {
  const result = await provider.ask(`Buyer call notes: ${notes}`, [
    { id: "funding", type: "choice", question: "How does this buyer fund purchases?", options: ["cash", "hard_money", "conventional", "mixed"] },
    { id: "sight_unseen", type: "noul", question: "Will this buyer close without walking the property?" },
    { id: "heavy_rehab", type: "noul", question: "Does this buyer take on heavy rehab or gut jobs?" },
    { id: "light_rehab", type: "noul", question: "Does this buyer prefer light cosmetic work only?" },
  ]);
  const funding = result.answers["funding"] as ChoiceAnswer | undefined;
  const heavy = (result.answers["heavy_rehab"] as ProbabilityAnswer | undefined)?.probability ?? 0;
  const light = (result.answers["light_rehab"] as ProbabilityAnswer | undefined)?.probability ?? 0;
  const conditionLevels = heavy > 0.5 ? [1, 2, 3] : light > 0.5 ? [3, 4, 5] : [2, 3, 4];
  return { funding: funding?.choice ?? "cash", sightUnseen: (result.answers["sight_unseen"] as ProbabilityAnswer | undefined)?.probability ?? 0, conditionLevels, provider: result.provider, confidence: funding?.confidence ?? 0 };
}

export type LeadUrgency = "none" | "low" | "medium" | "high" | "immediate";

/**
 * Every touch on a lead the score is built from. Free text (notes, messages, call outcomes) is sent to the
 * provider; structured facts already on the lead (flagged deal issues, stated urgency, asking price versus a
 * known value) are read directly rather than re-derived from text.
 */
export type LeadTouches = {
  notes: string[];
  inboundMessages: string[];
  outboundMessages: string[];
  callOutcomes: string[];
  /** Deal issue keys currently flagged on the lead, e.g. "probate_or_inherited". */
  flaggedIssues: string[];
  sellerUrgency: LeadUrgency;
  askingPrice: number | null;
  estimatedValue: number | null;
};

export type LeadScoreResult = { score: number; confidence: number; reasons: string[]; provider: string };

const URGENCY_WEIGHT: Record<LeadUrgency, number> = { none: 0, low: 0.25, medium: 0.5, high: 0.75, immediate: 1 };
/** A 30% discount to the known value maxes out the price signal. */
const FULL_DISCOUNT_FRACTION = 0.3;
/** How many flagged deal issues max out the issue signal. */
const ISSUES_FOR_FULL_SIGNAL = 6;
/** Score weights. Must add to 1. */
const SCORE_WEIGHTS = { motivated: 0.35, urgency: 0.25, issues: 0.25, price: 0.15 } as const;

/** 0 when the asking price is at or above the known value, 1 once it is FULL_DISCOUNT_FRACTION or more below it. */
function priceGapSignal(askingPrice: number | null, estimatedValue: number | null): number {
  if (askingPrice == null || estimatedValue == null || estimatedValue <= 0) return 0;
  return Math.max(0, Math.min(1, (estimatedValue - askingPrice) / estimatedValue / FULL_DISCOUNT_FRACTION));
}

/**
 * How much evidence backs the score, not how high the score is. More touches, more text, and known price
 * and urgency data all raise it. Deterministic so the same lead history always yields the same confidence.
 */
function scoreConfidence(input: LeadTouches, touchTexts: string[]): number {
  const nonEmpty = touchTexts.filter((t) => t.trim().length > 0);
  const totalChars = nonEmpty.reduce((sum, t) => sum + t.length, 0);
  let c = Math.min(0.4, nonEmpty.length * 0.08);
  c += Math.min(0.25, (totalChars / 2000) * 0.25);
  c += input.sellerUrgency !== "none" ? 0.1 : 0;
  c += input.flaggedIssues.length > 0 ? 0.1 : 0;
  c += input.askingPrice != null && input.estimatedValue != null ? 0.15 : 0;
  return Math.round(Math.min(1, c) * 1000) / 1000;
}

/**
 * Score a lead 0 to 100 from every touch recorded on it. Confidence measures how much evidence backs the
 * score, independent of its value, and is what the caller uses to decide whether the result is applied
 * automatically, offered as a suggestion, or sent to a human (see AUTO_ACT_CONFIDENCE and SUGGEST_CONFIDENCE
 * in ./types). Works against either adapter: the mock is deterministic and keyword based with no network
 * calls, TypeSafe answers the same two questions through Jev.
 */
export async function scoreLead(provider: JudgmentProvider, input: LeadTouches): Promise<LeadScoreResult> {
  const touchTexts = [...input.notes, ...input.inboundMessages, ...input.outboundMessages, ...input.callOutcomes];
  const state = [
    input.notes.length ? `Notes:\n${input.notes.join("\n")}` : null,
    input.inboundMessages.length ? `Seller messages:\n${input.inboundMessages.join("\n")}` : null,
    input.outboundMessages.length ? `Our messages:\n${input.outboundMessages.join("\n")}` : null,
    input.callOutcomes.length ? `Call outcomes:\n${input.callOutcomes.join("\n")}` : null,
  ].filter(Boolean).join("\n\n") || "No touches recorded yet.";
  const result = await provider.ask(state, [
    { id: "motivated", type: "noul", question: "Is the seller motivated to sell below market for speed or certainty?" },
    { id: "urgent", type: "noul", question: "Does the seller need to sell soon or show urgency?" },
  ]);
  const motivated = (result.answers["motivated"] as ProbabilityAnswer | undefined)?.probability ?? 0;
  const urgencySignal = Math.max((result.answers["urgent"] as ProbabilityAnswer | undefined)?.probability ?? 0, URGENCY_WEIGHT[input.sellerUrgency]);
  const issueSignal = Math.min(1, input.flaggedIssues.length / ISSUES_FOR_FULL_SIGNAL);
  const priceSignal = priceGapSignal(input.askingPrice, input.estimatedValue);
  const weighted = motivated * SCORE_WEIGHTS.motivated + urgencySignal * SCORE_WEIGHTS.urgency + issueSignal * SCORE_WEIGHTS.issues + priceSignal * SCORE_WEIGHTS.price;
  const score = Math.round(Math.max(0, Math.min(1, weighted)) * 100);

  const reasons: string[] = [];
  if (motivated >= 0.3) reasons.push("Notes or messages show the seller is motivated to sell.");
  if (urgencySignal >= 0.3) reasons.push(`Urgency signal present, stated urgency is ${input.sellerUrgency}.`);
  if (input.flaggedIssues.length) reasons.push(`${input.flaggedIssues.length} flagged deal issue${input.flaggedIssues.length === 1 ? "" : "s"}: ${input.flaggedIssues.map((k) => k.replace(/_/g, " ")).join(", ")}.`);
  if (priceSignal > 0) reasons.push("Asking price is below the known property value.");
  if (!reasons.length) reasons.push("Not enough signal yet in the notes, messages, and calls on this lead.");

  return { score, confidence: scoreConfidence(input, touchTexts), reasons, provider: result.provider };
}

/**
 * Converts a model's 0 to 100 score to the 1 to 10 scale that leads.motivationScore has always used
 * (the CRM's user facing field, its sort, and its form validation). lead_scores.score itself stays on
 * the model's native 0 to 100 scale; only a write into the 1 to 10 column goes through this.
 */
export function scoreToMotivation(score: number): number {
  return Math.min(10, Math.max(1, Math.round(score / 10)));
}
