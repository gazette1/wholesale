import { createHmac, timingSafeEqual } from "node:crypto";
import type { EmailProvider, OutboundEmail, SendResult, WebhookRequest, StatusUpdate } from "./types";

/** Resend transactional email over the REST API. Webhooks are Svix signed (HMAC-SHA256 over id.timestamp.body). */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  constructor(private readonly apiKey: string, private readonly from: string, private readonly opts: { webhookSecret?: string; fetchImpl?: typeof fetch } = {}) {}

  async sendEmail(message: OutboundEmail): Promise<SendResult> {
    const res = await (this.opts.fetchImpl ?? fetch)("https://api.resend.com/emails", {
      method: "POST", headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: message.from ?? this.from, to: [message.to], subject: message.subject, text: message.text, html: message.html, reply_to: message.replyTo }),
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) return { provider: this.name, providerMessageId: "", status: "failed", error: raw.message ?? `HTTP ${res.status}`, raw };
    return { provider: this.name, providerMessageId: raw.id, status: "sent", raw };
  }

  verifyWebhook(req: WebhookRequest): boolean {
    const secret = this.opts.webhookSecret;
    if (!secret) return false;
    const id = req.headers["svix-id"], ts = req.headers["svix-timestamp"], sig = req.headers["svix-signature"];
    if (!id || !ts || !sig) return false;
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const expected = createHmac("sha256", key).update(`${id}.${ts}.${req.rawBody}`).digest("base64");
    return sig.split(" ").some((part) => {
      const [, value] = part.split(",");
      if (!value) return false;
      const a = Buffer.from(expected), b = Buffer.from(value);
      return a.length === b.length && timingSafeEqual(a, b);
    });
  }

  parseStatus(req: WebhookRequest): StatusUpdate | null {
    let body: any;
    try { body = JSON.parse(req.rawBody); } catch { return null; }
    const id = body?.data?.email_id;
    if (!id || !body?.type) return null;
    const map: Record<string, StatusUpdate["status"]> = { "email.sent": "sent", "email.delivered": "delivered", "email.bounced": "failed", "email.complained": "failed", "email.delivery_delayed": "queued" };
    return { provider: this.name, providerMessageId: id, status: map[body.type] ?? "sent", raw: body };
  }
}
