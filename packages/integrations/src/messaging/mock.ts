import type { SmsProvider, EmailProvider, OutboundSms, OutboundEmail, SendResult, WebhookRequest, InboundMessage, StatusUpdate } from "./types";

/** Records every send in memory and returns fake ids. Webhooks accept a plain JSON body. */
export class MockMessagingProvider implements SmsProvider, EmailProvider {
  readonly name = "mock";
  readonly sent: Array<{ kind: "sms" | "email"; message: OutboundSms | OutboundEmail; id: string }> = [];
  private counter = 0;

  async sendSms(message: OutboundSms): Promise<SendResult> {
    const id = `mock-sms-${++this.counter}-${Date.now()}`;
    this.sent.push({ kind: "sms", message, id });
    return { provider: this.name, providerMessageId: id, status: "sent" };
  }

  async sendEmail(message: OutboundEmail): Promise<SendResult> {
    const id = `mock-email-${++this.counter}-${Date.now()}`;
    this.sent.push({ kind: "email", message, id });
    return { provider: this.name, providerMessageId: id, status: "sent" };
  }

  verifyWebhook(): boolean {
    return true;
  }

  parseInbound(req: WebhookRequest): InboundMessage | null {
    const body = safeJson(req.rawBody) ?? req.form ?? {};
    if (!body.from || !body.body) return null;
    return { provider: this.name, providerMessageId: String(body.id ?? `mock-in-${Date.now()}`), from: String(body.from), to: String(body.to ?? ""), body: String(body.body), receivedAt: new Date().toISOString(), raw: body };
  }

  parseStatus(req: WebhookRequest): StatusUpdate | null {
    const body = safeJson(req.rawBody) ?? req.form ?? {};
    if (!body.id || !body.status) return null;
    return { provider: this.name, providerMessageId: String(body.id), status: body.status as StatusUpdate["status"], raw: body };
  }
}

function safeJson(text: string): Record<string, any> | null {
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}
