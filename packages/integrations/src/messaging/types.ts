export type OutboundSms = { to: string; from?: string; body: string; statusCallbackUrl?: string };
export type OutboundEmail = { to: string; from?: string; subject: string; text: string; html?: string; replyTo?: string };

export type SendResult = { provider: string; providerMessageId: string; status: "queued" | "sent" | "delivered" | "failed"; error?: string; raw?: Record<string, unknown> };

export type InboundMessage = { provider: string; providerMessageId: string; from: string; to: string; body: string; receivedAt: string; raw: Record<string, unknown> };
export type StatusUpdate = { provider: string; providerMessageId: string; status: "queued" | "sent" | "delivered" | "failed" | "undelivered"; error?: string; raw: Record<string, unknown> };

/** A webhook request reduced to what signature checks need. */
export type WebhookRequest = { url: string; method: string; headers: Record<string, string>; rawBody: string; form?: Record<string, string> };

export interface SmsProvider {
  readonly name: string;
  sendSms(message: OutboundSms): Promise<SendResult>;
  verifyWebhook(req: WebhookRequest): boolean;
  parseInbound(req: WebhookRequest): InboundMessage | null;
  parseStatus(req: WebhookRequest): StatusUpdate | null;
}

export interface EmailProvider {
  readonly name: string;
  sendEmail(message: OutboundEmail): Promise<SendResult>;
  verifyWebhook(req: WebhookRequest): boolean;
  parseStatus(req: WebhookRequest): StatusUpdate | null;
}

/** Keywords the carriers and the TCPA rules treat as opt out or help. */
export const STOP_KEYWORDS = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "remove", "optout", "opt out"];
export const START_KEYWORDS = ["start", "yes", "unstop", "subscribe", "resume"];
export const HELP_KEYWORDS = ["help", "info"];

export function keywordIntent(body: string): "stop" | "start" | "help" | null {
  const t = body.trim().toLowerCase().replace(/[.!]+$/, "");
  if (STOP_KEYWORDS.includes(t)) return "stop";
  if (START_KEYWORDS.includes(t)) return "start";
  if (HELP_KEYWORDS.includes(t)) return "help";
  return null;
}

/** Replace {{first_name}} style fields. Unknown fields become an empty string, never the literal token. */
export function renderTemplate(body: string, fields: Record<string, string | null | undefined>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => fields[key] ?? "");
}

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (input.startsWith("+") && digits.length >= 8) return `+${digits}`;
  return null;
}
