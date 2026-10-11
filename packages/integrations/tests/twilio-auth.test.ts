import { describe, it, expect, afterEach } from "vitest";
import { twilioCredentials, twilioBasicAuth } from "../src/twilio-auth";
import { TwilioSmsProvider } from "../src/messaging/twilio";
import { TwilioVoiceProvider } from "../src/voice/twilio";
import { smsProvider } from "../src/messaging";
import { voiceProvider, resetVoiceProvider } from "../src/voice";
import { resetEnv, providerStatus } from "../src/env";

const b64 = (u: string, p: string) => Buffer.from(`${u}:${p}`).toString("base64");

describe("twilioCredentials", () => {
  it("prefers the API key pair over the auth token", () => {
    expect(twilioCredentials({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_API_KEY_SID: "SK1", TWILIO_API_KEY_SECRET: "sec" })).toEqual({ accountSid: "AC1", username: "SK1", password: "sec" });
  });
  it("uses the auth token when there is no complete key pair", () => {
    expect(twilioCredentials({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok" })).toEqual({ accountSid: "AC1", username: "AC1", password: "tok" });
    expect(twilioCredentials({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_API_KEY_SID: "SK1" })).toEqual({ accountSid: "AC1", username: "AC1", password: "tok" });
  });
  it("returns null without an account SID or without any secret", () => {
    expect(twilioCredentials({ TWILIO_AUTH_TOKEN: "tok", TWILIO_API_KEY_SID: "SK1", TWILIO_API_KEY_SECRET: "sec" })).toBeNull();
    expect(twilioCredentials({ TWILIO_ACCOUNT_SID: "AC1" })).toBeNull();
  });
  it("builds the basic auth value", () => {
    expect(twilioBasicAuth("a", "b")).toBe(b64("a", "b"));
  });
});

describe("authorization header", () => {
  const capture = () => {
    const seen: { url: string; auth: string }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, auth: (init.headers as Record<string, string>).authorization ?? "" });
      return new Response(JSON.stringify({ sid: "X1", status: "queued" }), { status: 201 });
    }) as unknown as typeof fetch;
    return { seen, fetchImpl };
  };

  it("sms uses the account SID and auth token by default", async () => {
    const { seen, fetchImpl } = capture();
    await new TwilioSmsProvider("AC1", "tok", { fromNumber: "+14105550000", fetchImpl }).sendSms({ to: "+14105550100", body: "hi" });
    expect(seen[0]!.auth).toBe(`Basic ${b64("AC1", "tok")}`);
  });
  it("sms uses the API key pair and keeps the account SID in the URL", async () => {
    const { seen, fetchImpl } = capture();
    await new TwilioSmsProvider("AC1", undefined, { auth: { username: "SK1", password: "sec" }, fromNumber: "+14105550000", fetchImpl }).sendSms({ to: "+14105550100", body: "hi" });
    expect(seen[0]!.auth).toBe(`Basic ${b64("SK1", "sec")}`);
    expect(seen[0]!.url).toContain("/Accounts/AC1/Messages.json");
  });
  it("voice uses the API key pair and keeps the account SID in the URL", async () => {
    const { seen, fetchImpl } = capture();
    await new TwilioVoiceProvider("AC1", undefined, { auth: { username: "SK1", password: "sec" }, fetchImpl }).startCall({ to: "+14105550100", from: "+14105550000", agentNumber: "+14105550199" });
    expect(seen[0]!.auth).toBe(`Basic ${b64("SK1", "sec")}`);
    expect(seen[0]!.url).toContain("/Accounts/AC1/Calls.json");
  });
});

describe("selection with an API key only", () => {
  const KEYS = ["MESSAGING_PROVIDER", "VOICE_PROVIDER", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "TWILIO_TWIML_APP_SID"] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const reset = () => { resetEnv(); resetVoiceProvider(); };
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } reset(); });

  it("reports twilio, flags the missing auth token, and refuses to verify webhooks", () => {
    Object.assign(process.env, { MESSAGING_PROVIDER: "twilio", VOICE_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_API_KEY_SID: "SK1", TWILIO_API_KEY_SECRET: "sec" });
    delete process.env.TWILIO_AUTH_TOKEN; delete process.env.TWILIO_TWIML_APP_SID; reset();
    const s = providerStatus();
    expect(s.sms).toBe("twilio");
    expect(s.voice).toBe("twilio");
    expect(s.voiceBrowser).toBe(false);
    expect(s.webhookVerification).toBe("auth_token_missing");
    const req = { url: "https://x.test/hook", method: "POST", headers: { "x-twilio-signature": "anything" }, rawBody: "A=1", form: { A: "1" } };
    expect(smsProvider().name).toBe("twilio");
    expect(smsProvider().verifyWebhook(req)).toBe(false);
    expect(voiceProvider().verifyWebhook(req)).toBe(false);
  });
  it("enables browser calling with the key pair and a TwiML app", () => {
    Object.assign(process.env, { VOICE_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_API_KEY_SID: "SK1", TWILIO_API_KEY_SECRET: "sec", TWILIO_TWIML_APP_SID: "AP1" });
    delete process.env.TWILIO_AUTH_TOKEN; reset();
    expect(providerStatus().voiceBrowser).toBe(true);
  });
});
