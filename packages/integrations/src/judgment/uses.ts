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
