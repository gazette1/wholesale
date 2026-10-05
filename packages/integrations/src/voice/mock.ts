import type { WebhookRequest } from "../messaging/types";
import { CALL_STATUSES, type VoiceProvider, type StartCallInput, type StartCallResult, type CallStatus, type CallStatusUpdate } from "./types";

/** Places no call. Records the request in memory and returns a fake id so the call log can be exercised without an account. */
export class MockVoiceProvider implements VoiceProvider {
  readonly name = "mock";
  readonly placed: Array<{ input: StartCallInput; id: string }> = [];
  private counter = 0;

  async accessToken(_identity: string): Promise<null> {
    return null;
  }

  async startCall(input: StartCallInput): Promise<StartCallResult> {
    const id = `mock-call-${++this.counter}-${Date.now()}`;
    this.placed.push({ input, id });
    return { providerCallId: id, status: "completed" };
  }

  outboundInstructions(): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Voice calling is not connected yet.</Say></Response>`;
  }

  verifyWebhook(): boolean {
    return true;
  }

  parseStatus(req: WebhookRequest): CallStatusUpdate | null {
    const body = safeJson(req.rawBody) ?? req.form ?? {};
    if (!body.id || !(CALL_STATUSES as readonly string[]).includes(String(body.status))) return null;
    const duration = Number(body.duration);
    return { provider: this.name, providerCallId: String(body.id), status: body.status as CallStatus, durationSeconds: body.duration != null && body.duration !== "" && Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : null, recordingUrl: body.recordingUrl ? String(body.recordingUrl) : null, raw: body };
  }
}

function safeJson(text: string): Record<string, any> | null {
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}
