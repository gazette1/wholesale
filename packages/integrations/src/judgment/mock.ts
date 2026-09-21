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
        answers[q.id] = { id: q.id, type: "noul", probability: Math.min(0.55, score(text, q.id, q.question) / 2) };
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
  price_given: ["$", "thousand", "grand"],
  urgent: ["asap", "quick", "fast", "soon", "immediately", "behind", "foreclosure", "moving"],
  // Deal issue signals, keyed by id.
  dirty_title: ["title", "cloud", "quiet title", "deed", "heirs", "unreleased"],
  probate_or_inherited: ["probate", "inherited", "inherit", "estate", "passed away", "deceased", "heir", "executor"],
  liens_or_judgments: ["lien", "judgment", "judgement", "back taxes", "tax sale", "irs", "water bill"],
  mortgage_default_or_foreclosure: ["foreclosure", "default", "behind on", "missed payments", "auction", "notice of sale", "pre foreclosure"],
  code_violations: ["code violation", "violation", "citation", "condemned", "city fine", "permit"],
  poor_condition: ["roof", "mold", "fire damage", "gut", "foundation", "rough shape", "needs work", "water damage"],
  occupied_by_tenant: ["tenant", "renter", "lease", "section 8", "rented"],
  occupied_by_squatter: ["squatter", "trespass", "unauthorized occupant"],
  seller_urgency: ["asap", "quick", "fast", "immediately", "urgent", "deadline", "moving", "relocating"],
  divorce_or_partner_dispute: ["divorce", "separated", "ex wife", "ex husband", "partner dispute", "co owner"],
  tax_delinquent: ["back taxes", "tax delinquent", "delinquent taxes", "tax sale", "owes taxes", "behind on taxes"],
  hoarder_or_environmental: ["hoarder", "hoarding", "junk", "oil tank", "asbestos", "lead paint", "environmental"],
  sight_unseen: ["sight unseen", "without walking", "without seeing", "no walkthrough"],
  heavy_rehab: ["gut", "heavy rehab", "full rehab", "fire damage", "teardown"],
  light_rehab: ["cosmetic", "light rehab", "paint and carpet", "turnkey"],
  motivated: ["need to sell", "have to sell", "tired", "inherited", "probate", "behind", "vacant"],
};

const STOP_WORDS = new Set(["do", "does", "is", "the", "these", "this", "notes", "note", "indicate", "or", "and", "to", "of", "for", "by", "a", "an", "in", "will", "how", "seller", "buyer", "with", "without", "on", "take", "only", "below", "show", "need", "soon"]);

/** Whole word or phrase match, so "or" does not hit "foreclosure" and "tenant" still matches "tenant?". */
function mentions(text: string, hint: string): boolean {
  if (/^[^a-z0-9]+$/i.test(hint)) return text.includes(hint);
  const escaped = hint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}(s|es|ed|ing)?([^a-z0-9]|$)`, "i").test(text);
}

function score(text: string, key: string, fallbackText?: string): number {
  // Known ids use their hint list. Anything else falls back to the meaningful words of the question.
  const hints = HINTS[key] ?? (fallbackText ?? key).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP_WORDS.has(w));
  let s = 0.1;
  for (const h of hints) if (mentions(text, h)) s += 1;
  // A figure such as 80k, 120 k, or 95,000 reads as a price even without a dollar sign.
  if (key === "price_given" && /\d{2,3}\s?k|\d{2,3},?\d{3}/i.test(text)) s += 1;
  return s;
}
