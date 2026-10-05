/** Events the CRM can deliver to outbound webhook endpoints. "ping" is sent by the Send test button only. */
export const EVENTS = [
  "lead.created", "lead.stage_changed", "lead.updated",
  "offer.created", "offer.status_changed",
  "analysis.saved", "analysis.status_changed",
  "message.received", "buyer.created", "package.created",
  "alert.created",
  "ping",
] as const;

export type WebhookEvent = (typeof EVENTS)[number];

/** Events an admin can subscribe an endpoint to. */
export const SUBSCRIBABLE_EVENTS: WebhookEvent[] = EVENTS.filter((e) => e !== "ping");

export function isWebhookEvent(v: unknown): v is WebhookEvent {
  return typeof v === "string" && (EVENTS as readonly string[]).includes(v);
}

/** The JSON body of every outbound delivery. */
export type WebhookEnvelope = { id: string; event: WebhookEvent; createdAt: string; orgId: string; data: Record<string, unknown> };

/**
 * Outbound URL policy. https is always allowed. http is allowed only for localhost and 127.0.0.1 outside production.
 * In production, hostnames that are obviously private are rejected to limit server side request forgery.
 * This is a hostname check only; it does not resolve DNS.
 */
export function checkWebhookUrl(raw: string, opts: { production: boolean }): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, error: "Enter a full URL, for example https://hooks.zapier.com/hooks/catch/123/abc" }; }
  if (url.username || url.password) return { ok: false, error: "URLs with embedded credentials are not allowed." };
  const host = stripBrackets(url.hostname.toLowerCase());
  const isLoopback = host === "localhost" || host === "127.0.0.1";
  if (url.protocol === "http:") {
    if (opts.production || !isLoopback) return { ok: false, error: "Webhook URLs must use https." };
  } else if (url.protocol !== "https:") {
    return { ok: false, error: "Webhook URLs must use https." };
  }
  if (opts.production && isPrivateHost(host)) return { ok: false, error: "That host is private or internal and cannot receive webhooks." };
  return { ok: true, url };
}

function stripBrackets(host: string): string {
  return host.replace(/^\[/, "").replace(/\]$/, "");
}

/** Hostname check for loopback, RFC 1918, link local, and internal names. */
export function isPrivateHost(hostname: string): boolean {
  const host = stripBrackets(hostname.toLowerCase());
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return true;
  if (host.includes(":")) {
    // IPv6 literal: loopback, unspecified, link local, unique local, and IPv4 mapped forms.
    if (host === "::1" || host === "::") return true;
    if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
    if (host.startsWith("::ffff:")) return true;
    return false;
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}
