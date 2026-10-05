import { createHmac } from "node:crypto";
import { TwilioSmsProvider } from "../messaging/twilio";
import type { WebhookRequest } from "../messaging/types";
import { mapTwilioCallStatus, type VoiceProvider, type StartCallInput, type StartCallResult, type CallStatusUpdate } from "./types";

export function escapeXml(value: string): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** TwiML that speaks one sentence and hangs up. Used when a call is refused. */
export function sayTwiml(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escapeXml(message)}</Say></Response>`;
}

/** TwiML that dials one number and shows callerId to the person answering. */
export function dialTwiml(input: { to: string; callerId: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${escapeXml(input.callerId)}" answerOnBridge="true"><Number>${escapeXml(input.to)}</Number></Dial></Response>`;
}

const b64url = (input: string | Buffer): string => Buffer.from(input).toString("base64url");

/** Browser softphone tokens live one hour. The client asks for a new one before it expires. */
export const ACCESS_TOKEN_TTL_SECONDS = 3600;

/**
 * Twilio Programmable Voice over the REST API. No SDK.
 * Bridge calls: one POST to the Calls endpoint rings the agent, and inline TwiML dials the lead when the agent answers.
 * Browser calls: the Voice JS SDK needs an access token, which is a JWT signed HS256 with an API key secret.
 */
export class TwilioVoiceProvider implements VoiceProvider {
  readonly name = "twilio";
  // Voice webhooks are signed exactly like SMS webhooks, so the check lives in one place.
  private readonly signer: TwilioSmsProvider;
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly opts: { apiKeySid?: string; apiKeySecret?: string; twimlAppSid?: string; fetchImpl?: typeof fetch; now?: () => number } = {},
  ) {
    this.signer = new TwilioSmsProvider(accountSid, authToken);
  }

  async accessToken(identity: string): Promise<{ token: string; expiresAt: string } | null> {
    const { apiKeySid, apiKeySecret, twimlAppSid } = this.opts;
    if (!apiKeySid || !apiKeySecret || !twimlAppSid || !identity) return null;
    const now = Math.floor((this.opts.now?.() ?? Date.now()) / 1000);
    const exp = now + ACCESS_TOKEN_TTL_SECONDS;
    const header = { typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" };
    // TODO(phase2): add incoming: { allow: true } to the voice grant when inbound calls should ring the browser.
    const payload = { jti: `${apiKeySid}-${now}`, iss: apiKeySid, sub: this.accountSid, iat: now, exp, grants: { identity, voice: { outgoing: { application_sid: twimlAppSid } } } };
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const signature = createHmac("sha256", apiKeySecret).update(signingInput).digest("base64url");
    return { token: `${signingInput}.${signature}`, expiresAt: new Date(exp * 1000).toISOString() };
  }

  async startCall(input: StartCallInput): Promise<StartCallResult> {
    if (!input.agentNumber) return { providerCallId: "", status: "failed", error: "A bridge call needs the agent's phone number. It rings the agent first, then the lead." };
    const params = new URLSearchParams();
    params.set("To", input.agentNumber);
    params.set("From", input.from);
    params.set("Twiml", dialTwiml({ to: input.to, callerId: input.from }));
    if (input.statusCallbackUrl) {
      params.set("StatusCallback", input.statusCallbackUrl);
      for (const event of ["initiated", "ringing", "answered", "completed"]) params.append("StatusCallbackEvent", event);
    }
    // TODO(phase2): the status callback reports the agent leg. Add a Dial action URL to record the lead leg result (DialCallStatus), and decide on call recording and its consent notice.
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");
    const res = await (this.opts.fetchImpl ?? fetch)(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Calls.json`, {
      method: "POST", headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" }, body: params.toString(),
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok || !raw.sid) return { providerCallId: raw.sid ?? "", status: "failed", error: raw.message ?? `HTTP ${res.status}` };
    return { providerCallId: raw.sid, status: mapTwilioCallStatus(raw.status ?? "queued") };
  }

  outboundInstructions(input: { to: string; callerId: string }): string {
    return dialTwiml(input);
  }

  verifyWebhook(req: WebhookRequest): boolean {
    return this.signer.verifyWebhook(req);
  }

  parseStatus(req: WebhookRequest): CallStatusUpdate | null {
    const p = req.form ?? Object.fromEntries(new URLSearchParams(req.rawBody));
    if (!p.CallSid || !p.CallStatus) return null;
    const duration = Number(p.CallDuration);
    return { provider: this.name, providerCallId: p.CallSid, status: mapTwilioCallStatus(p.CallStatus), durationSeconds: p.CallDuration && Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : null, recordingUrl: p.RecordingUrl || null, raw: p };
  }
}
