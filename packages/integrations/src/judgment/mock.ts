import type { JudgmentProvider, JudgmentQuestion, JudgmentResult, JudgmentAnswer } from "./types";

/**
 * Keyword rules with deliberately low confidence (never above 0.55), so the
 * app shows suggestions but never acts on them automatically. Replace with
 * TypeSafe by setting JUDGMENT_PROVIDER=typesafe and TYPESAFE_API_KEY.
 */
export class MockJudgmentProvider implements JudgmentProvider {
  readonly name = "mock";

  async ask(state: string, questions: JudgmentQuestion[]): Promise<JudgmentResult> {
    const text = state.toLowerCase();
    const answers: Record<string, JudgmentAnswer> = {};
    for (const q of questions) {
      if (q.type === "choice") {
        const scores = q.options.map((opt) => [opt, score(text, opt)] as const);
        const total = scores.reduce((a, [, s]) => a + s, 0) || 1;
        const probabilities = Object.fromEntries(scores.map(([opt, s]) => [opt, s / total]));
        const [choice] = scores.sort((a, b) => b[1] - a[1])[0]!;
        answers[q.id] = { id: q.id, type: "choice", choice, confidence: Math.min(0.55, probabilities[choice] ?? 0), probabilities };
      } else {
        answers[q.id] = { id: q.id, type: "noul", probability: Math.min(0.55, score(text, q.question) / 3) };
      }
    }
    return { provider: this.name, model: "keyword-rules", answers, latencyMs: 0 };
  }
}

const HINTS: Record<string, string[]> = {
  interested: ["yes", "interested", "sure", "call me", "what can you offer", "how much", "make an offer", "still"],
  not_interested: ["no", "not interested", "stop", "don't", "dont", "remove", "leave me alone", "sold"],
  stop: ["stop", "unsubscribe", "remove", "quit"],
  wrong_number: ["wrong number", "who is this", "wrong person", "not mine"],
  question: ["?", "how", "what", "when", "why"],
  callback_request: ["call me", "call back", "after", "tomorrow", "later"],
  price_given: ["$", "k", "thousand", "000"],
  urgent: ["asap", "quick", "fast", "soon", "immediately", "behind", "foreclosure", "moving"],
  motivated: ["need to sell", "have to sell", "tired", "inherited", "probate", "behind", "vacant"],
};

function score(text: string, key: string): number {
  const hints = HINTS[key] ?? key.toLowerCase().split(/\s+/);
  let s = 0.1;
  for (const h of hints) if (text.includes(h)) s += 1;
  return s;
}
