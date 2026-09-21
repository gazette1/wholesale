import { NextResponse } from "next/server";
import { voiceProvider } from "@dealcalc/integrations";
import { getSession, can } from "@/lib/auth";
import { voiceIdentity } from "@/lib/services/voice";

export const dynamic = "force-dynamic";

/** Access token for the browser softphone. 501 until the provider can issue one. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!can(session, "message:send")) return NextResponse.json({ error: `Your role (${session.role}) cannot place calls.` }, { status: 403 });
  const identity = voiceIdentity(session.profileId);
  const token = await voiceProvider().accessToken(identity);
  if (!token) return NextResponse.json({ error: "Browser calling is not connected yet. Set VOICE_PROVIDER=twilio with TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, and TWILIO_TWIML_APP_SID." }, { status: 501 });
  return NextResponse.json({ ...token, identity }, { headers: { "cache-control": "no-store" } });
}
