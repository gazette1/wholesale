import { and, desc, eq, sql } from "drizzle-orm";
import { contacts, leads, messages, activities, campaignEnrollments, messageTemplates, properties, profiles } from "@dealcalc/db";
import { smsProvider, emailProvider, keywordIntent, renderTemplate, normalizePhone, judgmentProvider, classifyReply, type InboundMessage, type StatusUpdate } from "@dealcalc/integrations";
import { getDb } from "../db";

export type SendInput = {
  orgId: string; senderProfileId: string; senderName: string; leadId: string; contactId: string; channel: "sms" | "email";
  body: string; subject?: string; templateId?: string | null; campaignStepId?: string | null; appUrl?: string;
};

export class ConsentError extends Error {}

/**
 * Send one message to a lead's contact. Checks consent, renders merge fields,
 * calls the provider, stores the message, logs the activity, and updates the lead.
 */
export async function sendToLead(input: SendInput) {
  const db = await getDb();
  const [contact, lead] = await Promise.all([
    db.query.contacts.findFirst({ where: and(eq(contacts.id, input.contactId), eq(contacts.orgId, input.orgId)) }),
    db.query.leads.findFirst({ where: and(eq(leads.id, input.leadId), eq(leads.orgId, input.orgId)) }),
  ]);
  if (!contact || !lead) throw new Error("Lead or contact not found.");
  const property = await db.query.properties.findFirst({ where: eq(properties.id, lead.propertyId) });
  const sender = await db.query.profiles.findFirst({ where: eq(profiles.id, input.senderProfileId) });

  if (contact.doNotContact) throw new ConsentError("This contact is marked do not contact.");
  if (input.channel === "sms" && contact.smsConsent === "opted_out") throw new ConsentError("This contact opted out of SMS. Sending is blocked.");
  if (input.channel === "email" && contact.emailConsent === "opted_out") throw new ConsentError("This contact opted out of email.");

  const primaryPhone = contact.phones.find((p) => p.isPrimary)?.number ?? contact.phones[0]?.number;
  const primaryEmail = contact.emails.find((e) => e.isPrimary)?.address ?? contact.emails[0]?.address;
  const to = input.channel === "sms" ? (primaryPhone ? normalizePhone(primaryPhone) : null) : primaryEmail ?? null;
  if (!to) throw new Error(input.channel === "sms" ? "The contact has no phone number." : "The contact has no email address.");

  const fields = {
    first_name: contact.firstName, last_name: contact.lastName ?? "", sender_name: input.senderName,
    property_address: property ? `${property.addressLine1}, ${property.city}` : "", city: property?.city ?? "",
  };
  const body = renderTemplate(input.body, fields);
  const subject = input.subject ? renderTemplate(input.subject, fields) : undefined;

  const from = input.channel === "sms" ? (sender?.twilioNumber ?? process.env.TWILIO_FROM_NUMBER ?? "+10000000000") : (process.env.EMAIL_FROM ?? "deals@example.com");
  const statusCallbackUrl = input.appUrl ? `${input.appUrl}/api/webhooks/twilio/status` : undefined;
  const result = input.channel === "sms"
    ? await smsProvider().sendSms({ to, from: sender?.twilioNumber ?? undefined, body, statusCallbackUrl })
    : await emailProvider().sendEmail({ to, subject: subject ?? "About your property", text: body });

  const [row] = await db.insert(messages).values({
    orgId: input.orgId, leadId: lead.id, contactId: contact.id, channel: input.channel, direction: "out", fromAddr: from, toAddr: to, subject, body,
    templateId: input.templateId ?? null, campaignStepId: input.campaignStepId ?? null, provider: result.provider, providerMessageId: result.providerMessageId || null,
    status: result.status === "failed" ? "failed" : result.status, statusAt: new Date(), error: result.error ?? null, sentBy: input.senderProfileId,
    payload: { smsConsentAtSend: contact.smsConsent, emailConsentAtSend: contact.emailConsent, fields },
  }).returning();

  await db.insert(activities).values({ orgId: input.orgId, leadId: lead.id, actorId: input.senderProfileId, type: input.channel, payload: { direction: "out", body: body.slice(0, 500), messageId: row!.id, status: result.status } });
  await db.update(leads).set({ lastContactAt: new Date(), contactAttempts: sql`${leads.contactAttempts} + 1` }).where(eq(leads.id, lead.id));
  return row!;
}

/** Match an inbound message to a contact and lead, honor STOP and HELP, classify with Jev, log everything. */
export async function handleInbound(msg: InboundMessage, channel: "sms" | "email") {
  const db = await getDb();
  const from = channel === "sms" ? normalizePhone(msg.from) ?? msg.from : msg.from.toLowerCase();
  const matchExpr = channel === "sms"
    ? sql`exists (select 1 from jsonb_array_elements(${contacts.phones}) p where regexp_replace(p->>'number', '\\D', '', 'g') like '%' || ${from.replace(/\D/g, "").slice(-10)})`
    : sql`exists (select 1 from jsonb_array_elements(${contacts.emails}) e where lower(e->>'address') = ${from})`;
  const contact = await db.query.contacts.findFirst({ where: matchExpr });
  const lead = contact
    ? await db.query.leads.findFirst({ where: and(eq(leads.primaryContactId, contact.id), eq(leads.orgId, contact.orgId)), orderBy: desc(leads.createdAt) })
    : null;
  const orgId = contact?.orgId;
  if (!orgId) return { matched: false as const };

  const intent = keywordIntent(msg.body);
  const [row] = await db.insert(messages).values({
    orgId, leadId: lead?.id ?? null, contactId: contact!.id, channel, direction: "in", fromAddr: msg.from, toAddr: msg.to, body: msg.body,
    provider: msg.provider, providerMessageId: msg.providerMessageId, status: "received", statusAt: new Date(), payload: { keyword: intent, raw: msg.raw },
  }).returning();

  if (intent === "stop") {
    await db.update(contacts).set({ smsConsent: "opted_out", smsConsentAt: new Date() }).where(eq(contacts.id, contact!.id));
    await db.update(campaignEnrollments).set({ status: "opted_out" }).where(eq(campaignEnrollments.contactId, contact!.id));
  } else if (intent === "start") {
    await db.update(contacts).set({ smsConsent: "opted_in", smsConsentAt: new Date() }).where(eq(contacts.id, contact!.id));
  }

  let classification: Awaited<ReturnType<typeof classifyReply>> | null = null;
  if (!intent && lead) {
    const lastOut = await db.query.messages.findFirst({ where: and(eq(messages.leadId, lead.id), eq(messages.direction, "out")), orderBy: desc(messages.createdAt) });
    const property = await db.query.properties.findFirst({ where: eq(properties.id, lead.propertyId) });
    try {
      classification = await classifyReply(judgmentProvider(), { body: msg.body, lastOutbound: lastOut?.body, propertyAddress: property ? `${property.addressLine1}, ${property.city}` : undefined });
      await db.update(messages).set({ payload: { keyword: intent, classification } }).where(eq(messages.id, row!.id));
    } catch (err) {
      classification = null;
    }
  }

  if (lead) {
    // Any reply stops sequences that are set to stop on reply, and marks the lead as contacted.
    await db.update(campaignEnrollments).set({ status: "replied" }).where(and(eq(campaignEnrollments.leadId, lead.id), eq(campaignEnrollments.status, "active")));
    const firstResponse = lead.firstResponseMinutes ?? (lead.createdAt ? Math.max(1, Math.round((Date.now() - new Date(lead.createdAt).getTime()) / 60_000)) : null);
    await db.update(leads).set({ lastContactAt: new Date(), firstResponseMinutes: firstResponse, ...(classification && classification.action === "auto" && classification.intent === "not_interested" ? {} : {}) }).where(eq(leads.id, lead.id));
    await db.insert(activities).values({
      orgId, leadId: lead.id, actorId: null, type: channel,
      payload: { direction: "in", body: msg.body.slice(0, 500), messageId: row!.id, keyword: intent, intent: classification?.intent, confidence: classification?.confidence, urgency: classification?.urgency, action: classification?.action, amountMentioned: classification?.amountMentioned },
    });
  }
  return { matched: true as const, contactId: contact!.id, leadId: lead?.id ?? null, keyword: intent, classification };
}

export async function applyStatus(update: StatusUpdate) {
  const db = await getDb();
  const row = await db.query.messages.findFirst({ where: eq(messages.providerMessageId, update.providerMessageId) });
  if (!row) return false;
  await db.update(messages).set({ status: update.status, statusAt: new Date(), error: update.error ?? row.error }).where(eq(messages.id, row.id));
  return true;
}

export async function templatesFor(orgId: string, channel?: "sms" | "email") {
  const db = await getDb();
  return db.select().from(messageTemplates).where(channel ? and(eq(messageTemplates.orgId, orgId), eq(messageTemplates.channel, channel), eq(messageTemplates.active, true)) : eq(messageTemplates.orgId, orgId)).orderBy(messageTemplates.name);
}
