import { describe, it, expect } from "vitest";
import { MockJudgmentProvider } from "../src/judgment/mock";
import { TypeSafeJudgmentProvider } from "../src/judgment/typesafe";
import { scoreLead, scoreToMotivation, type LeadTouches } from "../src/judgment/uses";
import { AUTO_ACT_CONFIDENCE, SUGGEST_CONFIDENCE } from "../src/judgment/types";

const EMPTY: LeadTouches = {
  notes: [], inboundMessages: [], outboundMessages: [], callOutcomes: [],
  flaggedIssues: [], sellerUrgency: "none", askingPrice: null, estimatedValue: null,
};

describe("scoreLead use case", () => {
  it("is deterministic: the same input always yields the same score, confidence, and reasons", async () => {
    const mock = new MockJudgmentProvider();
    const input: LeadTouches = {
      ...EMPTY,
      notes: ["Seller inherited the house from her mother, needs to sell fast, behind on taxes"],
      sellerUrgency: "high",
      flaggedIssues: ["probate_or_inherited", "tax_delinquent"],
      askingPrice: 120_000, estimatedValue: 180_000,
    };
    const a = await scoreLead(mock, input);
    const b = await scoreLead(mock, input);
    expect(a).toEqual(b);
    expect(a.provider).toBe("mock");
  });

  it("scores an empty lead near zero, with zero confidence since there is no evidence to back it", async () => {
    const mock = new MockJudgmentProvider();
    const r = await scoreLead(mock, EMPTY);
    expect(r.score).toBeLessThanOrEqual(5);
    expect(r.confidence).toBe(0);
    expect(r.reasons).toContain("Not enough signal yet in the notes, messages, and calls on this lead.");
  });

  it("scores higher for a lead with motivation, urgency, deal issues, and a price gap than for a bare lead", async () => {
    const mock = new MockJudgmentProvider();
    const rich: LeadTouches = {
      notes: ["Owner is tired of the property and needs to sell asap, foreclosure is coming"],
      inboundMessages: ["Yes I'm interested, how much can you offer? I need this done quick"],
      outboundMessages: ["Thanks for calling back, we can move fast"],
      callOutcomes: ["spoke: seller is motivated, wants a cash offer this week"],
      flaggedIssues: ["mortgage_default_or_foreclosure", "poor_condition", "tax_delinquent"],
      sellerUrgency: "immediate",
      askingPrice: 100_000, estimatedValue: 160_000,
    };
    const bare: LeadTouches = { ...EMPTY, notes: ["Left a voicemail"] };
    const richResult = await scoreLead(mock, rich);
    const bareResult = await scoreLead(mock, bare);
    expect(richResult.score).toBeGreaterThan(bareResult.score);
    expect(richResult.confidence).toBeGreaterThan(bareResult.confidence);
    expect(richResult.reasons.some((r) => r.includes("flagged deal issue"))).toBe(true);
    expect(richResult.reasons.some((r) => r.includes("below the known property value"))).toBe(true);
  });

  it("keeps the score within 0 to 100 and confidence within 0 to 1 even with heavy signal", async () => {
    const mock = new MockJudgmentProvider();
    const maxed: LeadTouches = {
      notes: Array(10).fill("Seller is motivated, needs to sell asap, foreclosure, behind on payments, tired of the house, inherited it during probate"),
      inboundMessages: Array(10).fill("Yes interested, how much, need it fast"),
      outboundMessages: Array(5).fill("We can close quickly"),
      callOutcomes: Array(5).fill("spoke: very motivated seller"),
      flaggedIssues: ["dirty_title", "probate_or_inherited", "liens_or_judgments", "mortgage_default_or_foreclosure", "code_violations", "poor_condition", "tax_delinquent"],
      sellerUrgency: "immediate",
      askingPrice: 50_000, estimatedValue: 200_000,
    };
    const r = await scoreLead(mock, maxed);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it("the mock never reaches auto apply confidence on its own touch based signals alone without enough recorded touches", async () => {
    const mock = new MockJudgmentProvider();
    const thin: LeadTouches = { ...EMPTY, notes: ["quick note"], sellerUrgency: "low" };
    const r = await scoreLead(mock, thin);
    expect(r.confidence).toBeLessThan(SUGGEST_CONFIDENCE);
  });

  it("confidence can clear both thresholds once there is enough evidence recorded", async () => {
    const mock = new MockJudgmentProvider();
    const thorough: LeadTouches = {
      notes: ["Note one about the seller", "Note two about the timeline", "Note three about condition"],
      inboundMessages: ["Seller reply one", "Seller reply two"],
      outboundMessages: ["Our message one"],
      callOutcomes: ["spoke: discussed timeline and price"],
      flaggedIssues: ["poor_condition"],
      sellerUrgency: "medium",
      askingPrice: 150_000, estimatedValue: 190_000,
    };
    const r = await scoreLead(mock, thorough);
    expect(r.confidence).toBeGreaterThan(SUGGEST_CONFIDENCE);
  });

  it("typesafe adapter answers scoreLead's two questions through the systemone endpoint", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      model: "jev-latest",
      answers: [
        { id: "motivated", type: "noul", probability: 0.8 },
        { id: "urgent", type: "noul", probability: 0.7 },
      ],
    }), { status: 200 })) as unknown as typeof fetch;
    const j = new TypeSafeJudgmentProvider("key", { fetchImpl, baseUrl: "https://example.test/v1" });
    const r = await scoreLead(j, { ...EMPTY, sellerUrgency: "low" });
    expect(r.provider).toBe("typesafe");
    expect(r.score).toBeGreaterThan(0);
    expect(r.reasons.some((x) => x.includes("motivated"))).toBe(true);
  });

  it("AUTO_ACT_CONFIDENCE is stricter than SUGGEST_CONFIDENCE, matching the fixed review thresholds", () => {
    expect(AUTO_ACT_CONFIDENCE).toBeGreaterThan(SUGGEST_CONFIDENCE);
  });
});

describe("scoreToMotivation", () => {
  it("converts the model's 0 to 100 score to the 1 to 10 leads.motivationScore scale", () => {
    expect(scoreToMotivation(0)).toBe(1);
    expect(scoreToMotivation(4)).toBe(1);
    expect(scoreToMotivation(5)).toBe(1);
    expect(scoreToMotivation(95)).toBe(10);
    expect(scoreToMotivation(100)).toBe(10);
  });

  it("never returns outside 1 to 10 for any score in range", () => {
    for (let s = 0; s <= 100; s += 1) {
      const m = scoreToMotivation(s);
      expect(m).toBeGreaterThanOrEqual(1);
      expect(m).toBeLessThanOrEqual(10);
    }
  });
});
