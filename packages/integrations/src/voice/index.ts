import { env } from "../env";
import { MockVoiceProvider } from "./mock";
import { TwilioVoiceProvider } from "./twilio";
import type { VoiceProvider } from "./types";

export * from "./types";
export { MockVoiceProvider } from "./mock";
export { TwilioVoiceProvider, escapeXml, sayTwiml, dialTwiml, ACCESS_TOKEN_TTL_SECONDS } from "./twilio";

const mock = new MockVoiceProvider();
let voice: VoiceProvider | undefined;

export function voiceProvider(): VoiceProvider {
  if (voice) return voice;
  const e = env();
  voice = e.VOICE_PROVIDER === "twilio" && e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN
    ? new TwilioVoiceProvider(e.TWILIO_ACCOUNT_SID, e.TWILIO_AUTH_TOKEN, { apiKeySid: e.TWILIO_API_KEY_SID, apiKeySecret: e.TWILIO_API_KEY_SECRET, twimlAppSid: e.TWILIO_TWIML_APP_SID })
    : mock;
  return voice;
}

/** The shared mock instance, so tests and the dev UI can inspect what was placed. */
export function mockVoice(): MockVoiceProvider {
  return mock;
}

/** Drops the cached adapter. Tests only, together with resetEnv. */
export function resetVoiceProvider(): void {
  voice = undefined;
}
