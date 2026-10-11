export interface TwilioCredentials { accountSid: string; username: string; password: string }

type TwilioEnv = { TWILIO_ACCOUNT_SID?: string; TWILIO_AUTH_TOKEN?: string; TWILIO_API_KEY_SID?: string; TWILIO_API_KEY_SECRET?: string };

/** REST credentials: the API key pair when both parts are set, else the auth token, else null. The account SID is always required. */
export function twilioCredentials(e: TwilioEnv): TwilioCredentials | null {
  const accountSid = e.TWILIO_ACCOUNT_SID;
  if (!accountSid) return null;
  if (e.TWILIO_API_KEY_SID && e.TWILIO_API_KEY_SECRET) return { accountSid, username: e.TWILIO_API_KEY_SID, password: e.TWILIO_API_KEY_SECRET };
  if (e.TWILIO_AUTH_TOKEN) return { accountSid, username: accountSid, password: e.TWILIO_AUTH_TOKEN };
  return null;
}

/** Base64 value for the HTTP Basic Authorization header, without the "Basic " prefix. */
export function twilioBasicAuth(username: string, password: string): string {
  return Buffer.from(`${username}:${password}`).toString("base64");
}
