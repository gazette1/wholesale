import { z } from "zod";
import type { JudgmentProvider, JudgmentQuestion, JudgmentResult, JudgmentAnswer } from "./types";

/**
 * TypeSafe systemone API, model jev-latest.
 * POST {base}/systemone with Bearer key, body { model, state, questions }.
 * choice answers carry choice, probabilities, confidence. noul answers carry a
 * 0 to 1 probability. 429 and 529 are retried with backoff.
 * Response parsing is tolerant: field names are looked up under several
 * spellings and the raw body is kept. Tighten after the first live call.
 */
const AnswerSchema = z.object({
  id: z.string().optional(),
  question_id: z.string().optional(),
  type: z.string().optional(),
  choice: z.string().optional(),
  answer: z.union([z.string(), z.number()]).optional(),
  confidence: z.number().optional(),
  probability: z.number().optional(),
  value: z.number().optional(),
  probabilities: z.record(z.number()).optional(),
}).passthrough();

const ResponseSchema = z.object({
  answers: z.array(AnswerSchema).optional(),
  results: z.array(AnswerSchema).optional(),
  model: z.string().optional(),
}).passthrough();

export class TypeSafeJudgmentProvider implements JudgmentProvider {
  readonly name = "typesafe";
  constructor(private readonly apiKey: string, private readonly opts: { baseUrl?: string; model?: string; fetchImpl?: typeof fetch; maxRetries?: number } = {}) {}

  async ask(state: string, questions: JudgmentQuestion[]): Promise<JudgmentResult> {
    const started = Date.now();
    const model = this.opts.model ?? "jev-latest";
    const body = {
      model,
      state,
      questions: questions.map((q) => (q.type === "choice" ? { id: q.id, type: "choice", question: q.question, options: q.options } : { id: q.id, type: "noul", question: q.question })),
    };
    const raw = await this.postWithRetry(`${this.opts.baseUrl ?? "https://api.typesafe.ai/v1"}/systemone`, body);
    const parsed = ResponseSchema.safeParse(raw);
    const list = parsed.success ? (parsed.data.answers ?? parsed.data.results ?? []) : [];
    const answers: Record<string, JudgmentAnswer> = {};
    questions.forEach((q, i) => {
      const a = list.find((x) => (x.id ?? x.question_id) === q.id) ?? list[i];
      if (!a) return;
      if (q.type === "choice") {
        const probabilities = a.probabilities ?? {};
        const choice = a.choice ?? (typeof a.answer === "string" ? a.answer : undefined) ?? Object.entries(probabilities).sort((x, y) => y[1] - x[1])[0]?.[0] ?? q.options[0]!;
        const confidence = a.confidence ?? probabilities[choice] ?? 0;
        answers[q.id] = { id: q.id, type: "choice", choice, confidence, probabilities };
      } else {
        const probability = a.probability ?? a.value ?? (typeof a.answer === "number" ? a.answer : undefined) ?? 0;
        answers[q.id] = { id: q.id, type: "noul", probability };
      }
    });
    return { provider: this.name, model, answers, latencyMs: Date.now() - started, raw };
  }

  private async postWithRetry(url: string, body: unknown): Promise<unknown> {
    const maxRetries = this.opts.maxRetries ?? 3;
    let attempt = 0;
    for (;;) {
      const res = await (this.opts.fetchImpl ?? fetch)(url, { method: "POST", headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) return res.json();
      const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
      if (!retryable || attempt >= maxRetries) throw new Error(`TypeSafe responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
      attempt += 1;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}
