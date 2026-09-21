import { z } from "zod";

/**
 * Every provider key is read here and nowhere else. Missing keys select the
 * mock adapter, so the app runs end to end with an empty .env.local.
 */
const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),

  PROPERTY_DATA_PROVIDER: z.enum(["mock", "realestateapi"]).default("mock"),
  REALESTATEAPI_KEY: z.string().optional(),
  REALESTATEAPI_BASE_URL: z.string().url().default("https://api.realestateapi.com/v2"),

  MESSAGING_PROVIDER: z.enum(["mock", "twilio"]).default("mock"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  VOICE_PROVIDER: z.enum(["mock", "twilio"]).default("mock"),
  TWILIO_API_KEY_SID: z.string().optional(),
  TWILIO_API_KEY_SECRET: z.string().optional(),
  TWILIO_TWIML_APP_SID: z.string().optional(),

  EMAIL_PROVIDER: z.enum(["mock", "resend"]).default("mock"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Acquisitions Team <deals@example.com>"),

  JUDGMENT_PROVIDER: z.enum(["mock", "typesafe"]).default("mock"),
  TYPESAFE_API_KEY: z.string().optional(),
  TYPESAFE_BASE_URL: z.string().url().default("https://api.typesafe.ai/v1"),
  TYPESAFE_MODEL: z.string().default("jev-latest"),

  APP_URL: z.string().default("http://localhost:3000"),
  CRON_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  cached = EnvSchema.parse(process.env);
  return cached;
}

/** Resets the cache. Tests only. */
export function resetEnv(): void {
  cached = undefined;
}

/** Which adapter each boundary will use, for the settings page. */
export function providerStatus() {
  const e = env();
  return {
    propertyData: e.PROPERTY_DATA_PROVIDER === "realestateapi" && e.REALESTATEAPI_KEY ? "realestateapi" : "mock",
    sms: e.MESSAGING_PROVIDER === "twilio" && e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN ? "twilio" : "mock",
    voice: e.VOICE_PROVIDER === "twilio" && e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN ? "twilio" : "mock",
    /** Browser calling also needs an API key and a TwiML app. Without them Twilio voice places bridge calls only. */
    voiceBrowser: Boolean(e.VOICE_PROVIDER === "twilio" && e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN && e.TWILIO_API_KEY_SID && e.TWILIO_API_KEY_SECRET && e.TWILIO_TWIML_APP_SID),
    email: e.EMAIL_PROVIDER === "resend" && e.RESEND_API_KEY ? "resend" : "mock",
    judgment: e.JUDGMENT_PROVIDER === "typesafe" && e.TYPESAFE_API_KEY ? "typesafe" : "mock",
    database: e.DATABASE_URL ? "postgres" : "pglite",
    auth: e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "supabase" : "dev",
  } as const;
}
