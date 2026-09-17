import { describe, it, expect } from "vitest";
import { MockPropertyDataProvider } from "../src/property-data/mock";
import { RealEstateApiProvider } from "../src/property-data/realestateapi";
import { MockMessagingProvider } from "../src/messaging/mock";
import { TwilioSmsProvider } from "../src/messaging/twilio";
import { keywordIntent, renderTemplate, normalizePhone } from "../src/messaging/types";
import { MockJudgmentProvider } from "../src/judgment/mock";
import { TypeSafeJudgmentProvider } from "../src/judgment/typesafe";
import { classifyReply, extractDollarAmounts, assessDistress } from "../src/judgment/uses";
import { createHmac } from "node:crypto";

describe("property data", () => {
  it("mock is deterministic per address", async () => {
    const p = new MockPropertyDataProvider();
    const a = await p.lookup({ addressLine1: "123 Main St", city: "Baltimore", state: "MD", postalCode: "21201" });
    const b = await p.lookup({ addressLine1: "123 Main St", city: "Baltimore", state: "MD", postalCode: "21201" });
    expect(a.normalized.valuation.avm).toBe(b.normalized.valuation.avm);
    expect(a.normalized.characteristics.sqft).toBeGreaterThan(0);
  });

  it("realestateapi maps a sample response and survives unknown fields", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      data: {
        propertyInfo: { address: { address: "1 Test Rd", city: "Towson", state: "MD", zip: "21204", latitude: 39.4, longitude: -76.6 }, bedrooms: 3, bathrooms: "2", livingSquareFeet: 1400, yearBuilt: 1955, somethingNew: true },
        ownerInfo: { owner1FullName: "Jane Doe", absenteeOwner: true, ownershipLength: 12 },
        estimatedValue: 250000, currentMortgages: [{ lenderName: "Bank", amount: 100000, estimatedBalance: 80000, position: 1 }],
        taxInfo: { assessedValue: 200000, taxAmount: 2200, year: 2025 }, preForeclosure: true, vacant: false,
      },
    }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const p = new RealEstateApiProvider("key", "https://example.test/v2", fetchImpl);
    const r = await p.lookup({ addressLine1: "1 Test Rd", city: "Towson", state: "MD", postalCode: "21204" });
    expect(r.status).toBe("ok");
    expect(r.normalized.characteristics.baths).toBe(2);
    expect(r.normalized.owner.names).toEqual(["Jane Doe"]);
    expect(r.normalized.distress.flags).toContain("pre_foreclosure");
    expect(r.normalized.mortgages[0]?.estimatedBalance).toBe(80000);
  });

  it("realestateapi reports failures without throwing", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    const p = new RealEstateApiProvider("bad", "https://example.test/v2", fetchImpl);
    const r = await p.lookup({ addressLine1: "1 Test Rd", city: "Towson", state: "MD", postalCode: "21204" });
    expect(r.status).toBe("failed");
    expect(r.error).toContain("401");
  });
});

describe("messaging", () => {
  it("mock records sends", async () => {
    const m = new MockMessagingProvider();
    const r = await m.sendSms({ to: "+14105550100", body: "hi" });
    expect(r.status).toBe("sent");
    expect(m.sent.length).toBe(1);
  });

  it("keyword intents and templates", () => {
    expect(keywordIntent("STOP")).toBe("stop");
    expect(keywordIntent("Stop.")).toBe("stop");
    expect(keywordIntent("help")).toBe("help");
    expect(keywordIntent("yes I am interested")).toBeNull();
    expect(renderTemplate("Hi {{first_name}} about {{property_address}} {{missing}}", { first_name: "Sam", property_address: "1 Main" })).toBe("Hi Sam about 1 Main ");
    expect(normalizePhone("(410) 555-0100")).toBe("+14105550100");
    expect(normalizePhone("1-410-555-0100")).toBe("+14105550100");
    expect(normalizePhone("12")).toBeNull();
  });

  it("twilio signature verification and inbound parsing", () => {
    const token = "secret";
    const url = "https://app.example.com/api/webhooks/twilio/sms";
    const form = { From: "+14105550100", To: "+14105550000", Body: "yes", MessageSid: "SM123" };
    const data = url + Object.keys(form).sort().map((k) => k + (form as any)[k]).join("");
    const sig = createHmac("sha1", token).update(data).digest("base64");
    const t = new TwilioSmsProvider("AC", token);
    const req = { url, method: "POST", headers: { "x-twilio-signature": sig }, rawBody: new URLSearchParams(form).toString(), form };
    expect(t.verifyWebhook(req)).toBe(true);
    expect(t.verifyWebhook({ ...req, headers: { "x-twilio-signature": "bad" } })).toBe(false);
    const inbound = t.parseInbound(req);
    expect(inbound?.body).toBe("yes");
    expect(inbound?.providerMessageId).toBe("SM123");
  });
});

describe("judgment", () => {
  it("mock classifies with low confidence so nothing auto fires", async () => {
    const j = new MockJudgmentProvider();
    const r = await classifyReply(j, { body: "Yes I'm interested, what can you offer? I need to sell fast, asking 150k" });
    expect(r.intent).toBe("interested");
    expect(r.action).not.toBe("auto");
    expect(r.amountMentioned).toBe(150000);
    const stop = await classifyReply(j, { body: "stop texting me" });
    expect(["stop", "not_interested"]).toContain(stop.intent);
  });

  it("extracts dollar amounts", () => {
    expect(extractDollarAmounts("I want $150k for it")).toEqual([150000]);
    expect(extractDollarAmounts("maybe 200,000 or 1.2 million")).toEqual([200000, 1200000]);
    expect(extractDollarAmounts("call me at 5")).toEqual([]);
  });

  it("typesafe parses a systemone response", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      model: "jev-latest",
      answers: [
        { id: "intent", type: "choice", choice: "interested", confidence: 0.94, probabilities: { interested: 0.94, other: 0.06 } },
        { id: "urgent", type: "noul", probability: 0.81 },
      ],
    }), { status: 200 })) as unknown as typeof fetch;
    const j = new TypeSafeJudgmentProvider("key", { fetchImpl, baseUrl: "https://example.test/v1" });
    const r = await classifyReply(j, { body: "yes" });
    expect(r.intent).toBe("interested");
    expect(r.action).toBe("auto");
    expect(r.urgency).toBeCloseTo(0.81);
    const d = await assessDistress(j, "inherited the house, behind on taxes");
    expect(d.provider).toBe("typesafe");
  });

  it("typesafe retries 429 then succeeds", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) return new Response("slow down", { status: 429 });
      return new Response(JSON.stringify({ answers: [{ id: "intent", choice: "other", confidence: 0.5 }, { id: "urgent", probability: 0.1 }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const j = new TypeSafeJudgmentProvider("key", { fetchImpl, baseUrl: "https://example.test/v1", maxRetries: 2 });
    const r = await classifyReply(j, { body: "hmm" });
    expect(calls).toBe(2);
    expect(r.action).toBe("review");
  });
});
