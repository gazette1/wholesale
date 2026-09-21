import { NextResponse, type NextRequest } from "next/server";
import { voiceProvider, sayTwiml } from "@dealcalc/integrations";
import { mockWebhookAllowed } from "@/lib/services/messaging";
import { connectBrowserCall } from "@/lib/services/voice";
import { ensureDevDatabase } from "@dealcalc/db";

export const dynamic = "force-dynamic";

const xml = (body: string) => new NextResponse(body, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });

/**
 * Voice URL of the Twilio TwiML app. Twilio posts here when the browser softphone starts a call, and dials what this returns.
 * From is "client:<identity>" from the access token; To is the number the softphone passed to device.connect.
 */
export async function POST(request: NextRequest) {
  await ensureDevDatabase();
  const rawBody = await request.text();
  const form = Object.fromEntries(new URLSearchParams(rawBody));
  const url = process.env.APP_URL ? `${process.env.APP_URL}${request.nextUrl.pathname}` : request.url;
  const provider = voiceProvider();
  if (provider.name === "mock" && !mockWebhookAllowed(request.headers)) return new NextResponse("Unauthorized", { status: 401 });
  const req = { url, method: "POST", headers: Object.fromEntries(request.headers), rawBody, form };
  if (!provider.verifyWebhook(req)) return new NextResponse("Invalid signature", { status: 403 });
  if (provider.name === "mock") return xml(provider.outboundInstructions({ to: "", callerId: "" }));
  const checked = await connectBrowserCall({ identity: form.From ?? "", to: form.To ?? "", providerCallId: form.CallSid ?? null, provider: provider.name });
  // A refusal is still a 200: Twilio reads the sentence to the agent and hangs up.
  if (!checked.ok) return xml(sayTwiml(checked.reason));
  return xml(provider.outboundInstructions({ to: checked.to, callerId: checked.callerId }));
}
