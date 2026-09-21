import { NextResponse, type NextRequest } from "next/server";
import { smsProvider } from "@dealcalc/integrations";
import { handleInbound, mockWebhookAllowed } from "@/lib/services/messaging";
import { ensureDevDatabase } from "@dealcalc/db";
import { emitEventForContact } from "@/lib/services/integrations";

export const dynamic = "force-dynamic";

/** Twilio inbound SMS. Configure as the number's "A message comes in" webhook (HTTP POST). */
export async function POST(request: NextRequest) {
  await ensureDevDatabase();
  const rawBody = await request.text();
  const form = Object.fromEntries(new URLSearchParams(rawBody));
  const url = process.env.APP_URL ? `${process.env.APP_URL}${request.nextUrl.pathname}` : request.url;
  const provider = smsProvider();
  if (provider.name === "mock" && !mockWebhookAllowed(request.headers)) return new NextResponse("Unauthorized", { status: 401 });
  const req = { url, method: "POST", headers: Object.fromEntries(request.headers), rawBody, form };
  if (!provider.verifyWebhook(req)) return new NextResponse("Invalid signature", { status: 403 });
  const inbound = provider.parseInbound(req);
  if (!inbound) return new NextResponse("Bad request", { status: 400 });
  const result = await handleInbound(inbound, "sms");
  if (result.matched) await emitEventForContact(result.contactId, "message.received", { channel: "sms", leadId: result.leadId, contactId: result.contactId, from: inbound.from, to: inbound.to, body: inbound.body, keyword: result.keyword ?? null, intent: result.classification?.intent ?? null, confidence: result.classification?.confidence ?? null, urgency: result.classification?.urgency ?? null });
  // Twilio expects TwiML. An empty response sends no auto reply; HELP gets the compliance text.
  const help = /^\s*(help|info)\s*$/i.test(inbound.body);
  const twiml = help ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Reply STOP to opt out. Questions? Call the number that texted you.</Message></Response>` : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new NextResponse(twiml, { status: 200, headers: { "content-type": "text/xml", "x-matched": String(result.matched) } });
}
