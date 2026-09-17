/**
 * Judgment boundary. Used wherever the CRM needs a classification or a
 * probability from free text: an inbound reply, a call note, a listing
 * remark. Never used for arithmetic; the engine does that.
 *
 * TypeSafe's Jev model answers with calibrated probabilities. The mock uses
 * keyword rules and returns low confidence so nothing automated fires on it.
 */
export type ChoiceQuestion = { id: string; type: "choice"; question: string; options: string[] };
export type ProbabilityQuestion = { id: string; type: "noul"; question: string };
export type JudgmentQuestion = ChoiceQuestion | ProbabilityQuestion;

export type ChoiceAnswer = { id: string; type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
export type ProbabilityAnswer = { id: string; type: "noul"; probability: number };
export type JudgmentAnswer = ChoiceAnswer | ProbabilityAnswer;

export type JudgmentResult = { provider: string; model: string; answers: Record<string, JudgmentAnswer>; latencyMs: number; raw?: unknown };

export interface JudgmentProvider {
  readonly name: string;
  ask(state: string, questions: JudgmentQuestion[]): Promise<JudgmentResult>;
}

/** Act without a human only above this confidence. Below it the answer is a suggestion. */
export const AUTO_ACT_CONFIDENCE = 0.9;
export const SUGGEST_CONFIDENCE = 0.6;
