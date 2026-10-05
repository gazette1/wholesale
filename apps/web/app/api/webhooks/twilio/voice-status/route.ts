import { NextResponse, type NextRequest } from "next/server";
import { voiceProvider } from "@dealcalc/integrations";
import { mockWebhookAllowed } from "@/lib/services/messaging";
import { recordCallStatus } from "@/lib/services/voice";
import { ensureDevDatabase } from "@dealcalc/db";

export const dynamic = "force-dynamic";

/** Call progress callbacks. Attached to each bridge call when APP_URL is set; for browser calls, set it as the TwiML app status callback. */
export async function POST(request: NextRequest) {
  await ensureDevDatabase();
  const rawBody = await request.text();
  const form = Object.fromEntries(new URLSearchParams(rawBody));
  const url = process.env.APP_URL ? `${process.env.APP_URL}${request.nextUrl.pathname}` : request.url;
  const provider = voiceProvider();
  if (provider.name === "mock" && !mockWebhookAllowed(request.headers)) return new NextResponse("Unauthorized", { status: 401 });
  const req = { url, method: "POST", headers: Object.fromEntries(request.headers), rawBody, form };
  if (!provider.verifyWebhook(req)) return new NextResponse("Invalid signature", { status: 403 });
  const update = provider.parseStatus(req);
  if (!update) return new NextResponse("Bad request", { status: 400 });
  const matched = await recordCallStatus(update.providerCallId, update.status, update.durationSeconds, update.recordingUrl);
  return new NextResponse(null, { status: 204, headers: { "x-matched": String(matched) } });
}
