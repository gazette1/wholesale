import { env } from "../env";
import { MockJudgmentProvider } from "./mock";
import { TypeSafeJudgmentProvider } from "./typesafe";
import type { JudgmentProvider } from "./types";

export * from "./types";
export * from "./uses";
export { MockJudgmentProvider } from "./mock";
export { TypeSafeJudgmentProvider } from "./typesafe";

let cached: JudgmentProvider | undefined;

export function judgmentProvider(): JudgmentProvider {
  if (cached) return cached;
  const e = env();
  cached = e.JUDGMENT_PROVIDER === "typesafe" && e.TYPESAFE_API_KEY
    ? new TypeSafeJudgmentProvider(e.TYPESAFE_API_KEY, { baseUrl: e.TYPESAFE_BASE_URL, model: e.TYPESAFE_MODEL })
    : new MockJudgmentProvider();
  return cached;
}
