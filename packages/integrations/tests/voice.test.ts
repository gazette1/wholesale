import { describe, it, expect, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { mapTwilioCallStatus, CALL_STATUSES } from "../src/voice/types";
import { MockVoiceProvider } from "../src/voice/mock";
import { TwilioVoiceProvider, dialTwiml, sayTwiml, escapeXml } from "../src/voice/twilio";
import { voiceProvider, resetVoiceProvider } from "../src/voice";
import { resetEnv, providerStatus } from "../src/env";

describe("call status mapping", () => {
  it("maps the hyphenated Twilio values to the database enum", () => {
    expect(mapTwilioCallStatus("in-progress")).toBe("in_progress");
    expect(mapTwilioCallStatus("no-answer")).toBe("no_answer");
    expect(mapTwilioCallStatus("initiated")).toBe("queued");
    expect(mapTwilioCallStatus("Completed")).toBe("completed");
    for (const s of ["queued", "ringing", "busy", "failed", "canceled"]) expect(mapTwilioCallStatus(s)).toBe(s);
  });

  it("never returns a value outside the enum", () => {
    for (const raw of ["", "weird", "in progress", "answered"]) expect(CALL_STATUSES).toContain(mapTwilioCallStatus(raw));
    expect(mapTwilioCallStatus("weird")).toBe("failed");
  });
});

describe("TwiML", () => {
  it("escapes every XML special character", () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;");
  });

  it("builds a Dial with the caller id and number escaped", () => {
    const xml = dialTwiml({ to: `+14105550100</Number><Number>+19005550000`, callerId: `+14105550199" record="true` });
    expect(xml).toContain("<Number>+14105550100&lt;/Number&gt;&lt;Number&gt;+19005550000</Number>");
    expect(xml).toContain(`callerId="+14105550199&quot; record=&quot;true"`);
    expect(xml.match(/<Number>/g)).toHaveLength(1);
  });

  it("speaks a refusal", () => {
    expect(sayTwiml("Not allowed & logged")).toContain("<Say>Not allowed &amp; logged</Say>");
  });
});

describe("mock voice", () => {
  it("returns a fake call id, status completed, and no access token", async () => {
    const m = new MockVoiceProvider();
    const r = await m.startCall({ from: "+14105550199", to: "+14105550100" });
    expect(r.providerCallId).toMatch(/^mock-call-/);
    expect(r.status).toBe("completed");
    expect(m.placed).toHaveLength(1);
    expect(await m.accessToken("agent_1")).toBeNull();
    expect(m.outboundInstructions()).toContain("not connected");
  });

  it("parses a plain status body and rejects unknown statuses", () => {
    const m = new MockVoiceProvider();
    const req = (body: unknown) => ({ url: "http://x", method: "POST", headers: {}, rawBody: JSON.stringify(body) });
    expect(m.parseStatus(req({ id: "mock-call-1", status: "no_answer", duration: "12" }))).toMatchObject({ providerCallId: "mock-call-1", status: "no_answer", durationSeconds: 12, recordingUrl: null });
    expect(m.parseStatus(req({ id: "mock-call-1", status: "exploded" }))).toBeNull();
    expect(m.parseStatus(req({ status: "completed" }))).toBeNull();
  });
});

describe("twilio voice", () => {
  it("places a bridge call: rings the agent, dials the lead from inline TwiML", async () => {
    let sent: { url: string; body: URLSearchParams; auth: string } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, body: new URLSearchParams(String(init.body)), auth: String((init.headers as Record<string, string>).authorization) };
      return new Response(JSON.stringify({ sid: "CA123", status: "queued" }), { status: 201 });
    }) as unknown as typeof fetch;
    const p = new TwilioVoiceProvider("AC1", "token", { fetchImpl });
    const r = await p.startCall({ from: "+14105550199", to: "+14105550100", agentNumber: "+14105550111", statusCallbackUrl: "https://app.test/api/webhooks/twilio/voice-status" });
    expect(r).toEqual({ providerCallId: "CA123", status: "queued" });
    expect(sent!.url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Calls.json");
    expect(sent!.auth).toBe(`Basic ${Buffer.from("AC1:token").toString("base64")}`);
    expect(sent!.body.get("To")).toBe("+14105550111");
    expect(sent!.body.get("From")).toBe("+14105550199");
    expect(sent!.body.get("Twiml")).toContain("<Number>+14105550100</Number>");
    expect(sent!.body.getAll("StatusCallbackEvent")).toEqual(["initiated", "ringing", "answered", "completed"]);
  });

  it("reports a failure without throwing, and refuses a bridge call with no agent number", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ message: "Authenticate" }), { status: 401 })) as unknown as typeof fetch;
    const p = new TwilioVoiceProvider("AC1", "bad", { fetchImpl });
    expect(await p.startCall({ from: "+14105550199", to: "+14105550100", agentNumber: "+14105550111" })).toMatchObject({ status: "failed", error: "Authenticate" });
    expect((await p.startCall({ from: "+14105550199", to: "+14105550100" })).status).toBe("failed");
  });

  it("signs an access token with the API key secret, and returns null without one", async () => {
    const now = () => 1_800_000_000_000;
    expect(await new TwilioVoiceProvider("AC1", "token", { now }).accessToken("agent_1")).toBeNull();
    const p = new TwilioVoiceProvider("AC1", "token", { apiKeySid: "SK1", apiKeySecret: "secret", twimlAppSid: "AP1", now });
    const out = await p.accessToken("agent_1");
    const [h, b, sig] = out!.token.split(".");
    expect(sig).toBe(createHmac("sha256", "secret").update(`${h}.${b}`).digest("base64url"));
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" });
    const payload = JSON.parse(Buffer.from(b!, "base64url").toString());
    expect(payload).toMatchObject({ iss: "SK1", sub: "AC1", iat: 1_800_000_000, exp: 1_800_003_600, grants: { identity: "agent_1", voice: { outgoing: { application_sid: "AP1" } } } });
    expect(out!.expiresAt).toBe(new Date(1_800_003_600_000).toISOString());
  });

  it("verifies the webhook signature and parses a status callback", () => {
    const p = new TwilioVoiceProvider("AC1", "token");
    const form = { CallSid: "CA123", CallStatus: "no-answer", CallDuration: "0" };
    const url = "https://app.test/api/webhooks/twilio/voice-status";
    const signature = createHmac("sha1", "token").update(url + Object.keys(form).sort().map((k) => k + form[k as keyof typeof form]).join("")).digest("base64");
    const req = { url, method: "POST", headers: { "x-twilio-signature": signature }, rawBody: new URLSearchParams(form).toString(), form };
    expect(p.verifyWebhook(req)).toBe(true);
    expect(p.verifyWebhook({ ...req, headers: { "x-twilio-signature": "nope" } })).toBe(false);
    expect(p.parseStatus(req)).toMatchObject({ providerCallId: "CA123", status: "no_answer", durationSeconds: 0 });
  });
});

describe("voice provider selection", () => {
  const KEYS = ["VOICE_PROVIDER", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const reset = () => { resetEnv(); resetVoiceProvider(); };
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } reset(); });

  it("falls back to the mock when Twilio is selected with no keys", () => {
    process.env.VOICE_PROVIDER = "twilio"; delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; reset();
    expect(voiceProvider().name).toBe("mock");
    expect(providerStatus().voice).toBe("mock");
    expect(providerStatus().voiceBrowser).toBe(false);
  });

  it("uses Twilio when selected and the account keys are set", () => {
    process.env.VOICE_PROVIDER = "twilio"; process.env.TWILIO_ACCOUNT_SID = "AC1"; process.env.TWILIO_AUTH_TOKEN = "token"; reset();
    expect(voiceProvider().name).toBe("twilio");
    expect(providerStatus().voice).toBe("twilio");
  });
});
