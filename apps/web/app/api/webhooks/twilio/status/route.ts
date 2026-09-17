import { NextResponse, type NextRequest } from "next/server";
import { smsProvider } from "@dealcalc/integrations";
import { applyStatus } from "@/lib/services/messaging";
import { ensureDevDatabase } from "@dealcalc/db";

export const dynamic = "force-dynamic";

/** Twilio delivery status callbacks. Set as StatusCallback on sends (done automatically when APP_URL is set). */
export async function POST(request: NextRequest) {
  await ensureDevDatabase();
  const rawBody = await request.text();
  const form = Object.fromEntries(new URLSearchParams(rawBody));
  const url = process.env.APP_URL ? `${process.env.APP_URL}${request.nextUrl.pathname}` : request.url;
  const provider = smsProvider();
  const req = { url, method: "POST", headers: Object.fromEntries(request.headers), rawBody, form };
  if (!provider.verifyWebhook(req)) return new NextResponse("Invalid signature", { status: 403 });
  const update = provider.parseStatus(req);
  if (!update) return new NextResponse("Bad request", { status: 400 });
  await applyStatus(update);
  return new NextResponse("", { status: 204 });
}
