import type { WebhookRequest } from "../messaging/types";

/** Same values as the call_status enum in the database. */
export const CALL_STATUSES = ["queued", "ringing", "in_progress", "completed", "busy", "no_answer", "failed", "canceled"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

/** Statuses after which the provider sends nothing more for the call. */
export const TERMINAL_CALL_STATUSES: readonly CallStatus[] = ["completed", "busy", "no_answer", "failed", "canceled"];

export type StartCallInput = { from: string; to: string; agentNumber?: string; statusCallbackUrl?: string };
export type StartCallResult = { providerCallId: string; status: CallStatus; error?: string };
export type CallStatusUpdate = { provider: string; providerCallId: string; status: CallStatus; durationSeconds: number | null; recordingUrl: string | null; raw: Record<string, unknown> };

export interface VoiceProvider {
  readonly name: string;
  /** Short lived token for the browser softphone. Null when the provider cannot do browser calling. */
  accessToken(identity: string): Promise<{ token: string; expiresAt: string } | null>;
  /** Bridge call: ring the agent's phone, then the lead. Used when browser calling is unavailable. */
  startCall(input: StartCallInput): Promise<StartCallResult>;
  /** TwiML (or equivalent) that the provider fetches to connect an outbound browser call. */
  outboundInstructions(input: { to: string; callerId: string }): string;
  verifyWebhook(req: WebhookRequest): boolean;
  parseStatus(req: WebhookRequest): CallStatusUpdate | null;
}

/** Twilio spells two statuses with hyphens and reports "initiated" before ringing. Unknown values map to failed so a call never looks live forever. */
export function mapTwilioCallStatus(raw: string): CallStatus {
  const value = String(raw ?? "").trim().toLowerCase().replace(/-/g, "_");
  if (value === "initiated") return "queued";
  return (CALL_STATUSES as readonly string[]).includes(value) ? (value as CallStatus) : "failed";
}
