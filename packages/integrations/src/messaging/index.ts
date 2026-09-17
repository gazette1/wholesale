import { env } from "../env";
import { MockMessagingProvider } from "./mock";
import { TwilioSmsProvider } from "./twilio";
import { ResendEmailProvider } from "./resend";
import type { SmsProvider, EmailProvider } from "./types";

export * from "./types";
export { MockMessagingProvider } from "./mock";
export { TwilioSmsProvider } from "./twilio";
export { ResendEmailProvider } from "./resend";

const mock = new MockMessagingProvider();
let sms: SmsProvider | undefined;
let email: EmailProvider | undefined;

export function smsProvider(): SmsProvider {
  if (sms) return sms;
  const e = env();
  sms = e.MESSAGING_PROVIDER === "twilio" && e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN
    ? new TwilioSmsProvider(e.TWILIO_ACCOUNT_SID, e.TWILIO_AUTH_TOKEN, { messagingServiceSid: e.TWILIO_MESSAGING_SERVICE_SID, fromNumber: e.TWILIO_FROM_NUMBER })
    : mock;
  return sms;
}

export function emailProvider(): EmailProvider {
  if (email) return email;
  const e = env();
  email = e.EMAIL_PROVIDER === "resend" && e.RESEND_API_KEY ? new ResendEmailProvider(e.RESEND_API_KEY, e.EMAIL_FROM) : mock;
  return email;
}

/** The shared mock instance, so tests and the dev UI can inspect what was sent. */
export function mockMessaging(): MockMessagingProvider {
  return mock;
}
