import { createHmac, timingSafeEqual } from "node:crypto";
import type { SmsProvider, OutboundSms, SendResult, WebhookRequest, InboundMessage, StatusUpdate } from "./types";

/**
 * Twilio Programmable Messaging over the REST API. No SDK; one POST per send.
 * Webhooks: Twilio signs form encoded requests with HMAC-SHA1 of the full URL
 * plus the sorted POST params, base64, in the X-Twilio-Signature header.
 */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio";
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly opts: { messagingServiceSid?: string; fromNumber?: string; fetchImpl?: typeof fetch } = {},
  ) {}

  async sendSms(message: OutboundSms): Promise<SendResult> {
    const params = new URLSearchParams();
    params.set("To", message.to);
    params.set("Body", message.body);
    if (message.from ?? this.opts.fromNumber) params.set("From", (message.from ?? this.opts.fromNumber)!);
    else if (this.opts.messagingServiceSid) params.set("MessagingServiceSid", this.opts.messagingServiceSid);
    if (message.statusCallbackUrl) params.set("StatusCallback", message.statusCallbackUrl);
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");
    const res = await (this.opts.fetchImpl ?? fetch)(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`, {
      method: "POST", headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" }, body: params.toString(),
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) return { provider: this.name, providerMessageId: raw.sid ?? "", status: "failed", error: raw.message ?? `HTTP ${res.status}`, raw };
    return { provider: this.name, providerMessageId: raw.sid, status: raw.status === "queued" || raw.status === "accepted" ? "queued" : "sent", raw };
  }

  verifyWebhook(req: WebhookRequest): boolean {
    const signature = req.headers["x-twilio-signature"] ?? req.headers["X-Twilio-Signature"];
    if (!signature) return false;
    const params = req.form ?? Object.fromEntries(new URLSearchParams(req.rawBody));
    const data = req.url + Object.keys(params).sort().map((k) => k + params[k]).join("");
    const expected = createHmac("sha1", this.authToken).update(data).digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseInbound(req: WebhookRequest): InboundMessage | null {
    const p = req.form ?? Object.fromEntries(new URLSearchParams(req.rawBody));
    if (!p.From || !p.MessageSid) return null;
    return { provider: this.name, providerMessageId: p.MessageSid, from: p.From, to: p.To ?? "", body: p.Body ?? "", receivedAt: new Date().toISOString(), raw: p };
  }

  parseStatus(req: WebhookRequest): StatusUpdate | null {
    const p = req.form ?? Object.fromEntries(new URLSearchParams(req.rawBody));
    if (!p.MessageSid || !p.MessageStatus) return null;
    const map: Record<string, StatusUpdate["status"]> = { queued: "queued", accepted: "queued", sending: "sent", sent: "sent", delivered: "delivered", undelivered: "undelivered", failed: "failed" };
    return { provider: this.name, providerMessageId: p.MessageSid, status: map[p.MessageStatus] ?? "sent", error: p.ErrorCode ? `Twilio error ${p.ErrorCode}` : undefined, raw: p };
  }
}
