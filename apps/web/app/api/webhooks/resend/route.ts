import { NextResponse, type NextRequest } from "next/server";
import { emailProvider } from "@dealcalc/integrations";
import { applyStatus } from "@/lib/services/messaging";
import { ensureDevDatabase } from "@dealcalc/db";

export const dynamic = "force-dynamic";

/** Resend delivery events. Set RESEND_WEBHOOK_SECRET so signatures verify. */
export async function POST(request: NextRequest) {
  await ensureDevDatabase();
  const rawBody = await request.text();
  const provider = emailProvider();
  const req = { url: request.url, method: "POST", headers: Object.fromEntries(request.headers), rawBody };
  if (provider.name === "resend" && !provider.verifyWebhook(req)) return new NextResponse("Invalid signature", { status: 403 });
  const update = provider.parseStatus(req);
  if (!update) return new NextResponse("Ignored", { status: 200 });
  await applyStatus(update);
  return NextResponse.json({ ok: true });
}
