"use server";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { leads, contacts, profiles, tags, leadTags, campaigns, campaignEnrollments, auditLog, tasks } from "@dealcalc/db";
import { getDb } from "../db";
import { requireSession, requireCan } from "../auth";
import { audit } from "../audit";
import { contactBlock } from "../services/campaigns";
import { emitEvents } from "../services/integrations";
import { friendlyError, isUuid } from "../safe";
import { listLeads, type LeadFilters } from "../data/leads";
import type { ActionResult } from "./leads";

const MAX_BULK = 200;

type OwnedLead = { id: string; propertyId: string; assignedTo: string | null; primaryContactId: string | null };

/** Checks the id list and keeps only the leads that belong to the caller's org. Ids from another org are dropped, not reported as errors. */
async function ownedLeads(orgId: string, leadIds: unknown): Promise<{ ok: true; rows: OwnedLead[]; missing: number } | { ok: false; error: string }> {
  if (!Array.isArray(leadIds) || leadIds.length === 0) return { ok: false, error: "Select at least one lead." };
  if (leadIds.length > MAX_BULK) return { ok: false, error: `Select ${MAX_BULK} leads or fewer at a time.` };
  if (!leadIds.every(isUuid)) return { ok: false, error: "One of the selected leads could not be read. Reload the page and try again." };
  const ids = [...new Set(leadIds as string[])];
  const db = await getDb();
  const rows = await db.select({ id: leads.id, propertyId: leads.propertyId, assignedTo: leads.assignedTo, primaryContactId: leads.primaryContactId }).from(leads).where(and(eq(leads.orgId, orgId), inArray(leads.id, ids)));
  if (rows.length === 0) return { ok: false, error: "None of the selected leads were found." };
  return { ok: true, rows, missing: ids.length - rows.length };
}

const plural = (n: number) => `${n} lead${n === 1 ? "" : "s"}`;

export async function bulkAssign(leadIds: string[], assignedTo: string | null, moveTasks?: boolean): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "lead:write");
    const db = await getDb();
    let assigneeName: string | null = null;
    if (assignedTo !== null) {
      const assignee = isUuid(assignedTo) ? await db.query.profiles.findFirst({ where: and(eq(profiles.id, assignedTo), eq(profiles.orgId, session.orgId), eq(profiles.active, true)) }) : null;
      if (!assignee) return { ok: false, error: "That team member was not found." };
      assigneeName = assignee.fullName;
    }
    const owned = await ownedLeads(session.orgId, leadIds);
    if (!owned.ok) return owned;
    const changed = owned.rows.filter((r) => r.assignedTo !== assignedTo);
    const unchanged = owned.rows.length - changed.length;
    let movedTasks = 0;
    if (changed.length) {
      await db.update(leads).set({ assignedTo }).where(and(eq(leads.orgId, session.orgId), inArray(leads.id, changed.map((r) => r.id))));
      // One audit row per lead, written in one insert, so each lead keeps its own before and after.
      await db.insert(auditLog).values(changed.map((r) => ({ orgId: session.orgId, actorId: session.profileId, entityType: "lead", entityId: r.id, action: "update", before: { assignedTo: r.assignedTo } as never, after: { assignedTo, bulk: true } as never })));
      await emitEvents(session.orgId, "lead.updated", changed.map((r) => ({ leadId: r.id, propertyId: r.propertyId, changed: ["assignedTo"] })));
      if (moveTasks) {
        // Every open task on a reassigned lead follows it to the new owner, not just the ones already assigned to the old owner.
        const movedRows = await db.update(tasks).set({ assignedTo }).where(and(eq(tasks.orgId, session.orgId), inArray(tasks.leadId, changed.map((r) => r.id)), isNull(tasks.doneAt))).returning();
        movedTasks = movedRows.length;
      }
    }
    revalidatePath("/leads"); revalidatePath("/pipeline"); revalidatePath("/dashboard");
    const notes = [unchanged ? `${unchanged} already ${assignedTo ? "theirs" : "unassigned"}` : "", movedTasks ? `${movedTasks} open ${movedTasks === 1 ? "task" : "tasks"} moved` : "", owned.missing ? `${owned.missing} not found` : ""].filter(Boolean);
    return { ok: true, message: `${assignedTo ? `Assigned ${plural(changed.length)} to ${assigneeName}` : `Unassigned ${plural(changed.length)}`}${notes.length ? ` (${notes.join(", ")})` : ""}` };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not assign the leads.") };
  }
}

const MAX_SELECT_ALL = MAX_BULK;
export type MatchingLeadsResult = { ok: true; ids: string[]; total: number; capped: boolean } | { ok: false; error: string };

/**
 * Ids of every lead that matches the current list filters, for "select all matching filters." Capped at
 * MAX_BULK, the same limit a bulk action enforces, so the result can always be handed straight to one.
 */
export async function matchingLeadIds(filters: LeadFilters): Promise<MatchingLeadsResult> {
  const session = await requireSession();
  try {
    const { rows, total } = await listLeads(session.orgId, { ...filters, page: 1, pageSize: MAX_SELECT_ALL });
    return { ok: true, ids: rows.map((r) => r.id), total, capped: total > MAX_SELECT_ALL };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not load the matching leads.") };
  }
}

export async function bulkTag(leadIds: string[], tagId: string, on: boolean): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "lead:write");
    if (!isUuid(tagId)) return { ok: false, error: "Pick a tag from the list." };
    const db = await getDb();
    const tag = await db.query.tags.findFirst({ where: and(eq(tags.id, tagId), eq(tags.orgId, session.orgId)) });
    if (!tag) return { ok: false, error: "That tag was not found." };
    const owned = await ownedLeads(session.orgId, leadIds);
    if (!owned.ok) return owned;
    const ids = owned.rows.map((r) => r.id);
    const had = await db.select({ leadId: leadTags.leadId }).from(leadTags).where(and(eq(leadTags.orgId, session.orgId), eq(leadTags.tagId, tagId), inArray(leadTags.leadId, ids)));
    const hadSet = new Set(had.map((h) => h.leadId));
    const targets = on ? ids.filter((id) => !hadSet.has(id)) : ids.filter((id) => hadSet.has(id));
    if (targets.length) {
      if (on) await db.insert(leadTags).values(targets.map((leadId) => ({ orgId: session.orgId, leadId, tagId }))).onConflictDoNothing();
      else await db.delete(leadTags).where(and(eq(leadTags.orgId, session.orgId), eq(leadTags.tagId, tagId), inArray(leadTags.leadId, targets)));
      await audit(session, { entityType: "tag", entityId: tagId, action: on ? "bulk_add" : "bulk_remove", after: { name: tag.name, leadIds: targets } });
    }
    revalidatePath("/leads");
    const rest = ids.length - targets.length;
    const notes = [rest ? `${rest} ${on ? "already had it" : "did not have it"}` : "", owned.missing ? `${owned.missing} not found` : ""].filter(Boolean);
    return { ok: true, message: `${on ? `Tagged ${plural(targets.length)} with ${tag.name}` : `Removed ${tag.name} from ${plural(targets.length)}`}${notes.length ? ` (${notes.join(", ")})` : ""}` };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not change the tags.") };
  }
}

export async function bulkEnroll(leadIds: string[], campaignId: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, "campaign:write");
    if (!isUuid(campaignId)) return { ok: false, error: "Pick a campaign from the list." };
    const db = await getDb();
    const campaign = await db.query.campaigns.findFirst({ where: and(eq(campaigns.id, campaignId), eq(campaigns.orgId, session.orgId)) });
    if (!campaign) return { ok: false, error: "That campaign was not found." };
    const owned = await ownedLeads(session.orgId, leadIds);
    if (!owned.ok) return owned;
    const ids = owned.rows.map((r) => r.id);
    const contactIds = [...new Set(owned.rows.map((r) => r.primaryContactId).filter((c): c is string => Boolean(c)))];
    const [contactRows, active] = await Promise.all([
      contactIds.length ? db.select().from(contacts).where(and(eq(contacts.orgId, session.orgId), inArray(contacts.id, contactIds))) : Promise.resolve([]),
      db.select({ leadId: campaignEnrollments.leadId }).from(campaignEnrollments).where(and(eq(campaignEnrollments.orgId, session.orgId), eq(campaignEnrollments.campaignId, campaignId), eq(campaignEnrollments.status, "active"), inArray(campaignEnrollments.leadId, ids))),
    ]);
    const contactById = new Map(contactRows.map((c) => [c.id, c]));
    const enrolledAlready = new Set(active.map((a) => a.leadId));
    const skipped = { noContact: 0, consent: 0, address: 0, already: 0 };
    const toEnroll: { leadId: string; contactId: string }[] = [];
    for (const lead of owned.rows) {
      const contact = lead.primaryContactId ? contactById.get(lead.primaryContactId) : undefined;
      if (!contact) { skipped.noContact += 1; continue; }
      // Same rules the sender applies at send time, so an opted out contact never sits in a sequence as active.
      const block = contactBlock(contact, campaign.channel);
      if (block) { if (block.kind === "consent") skipped.consent += 1; else skipped.address += 1; continue; }
      if (enrolledAlready.has(lead.id)) { skipped.already += 1; continue; }
      toEnroll.push({ leadId: lead.id, contactId: contact.id });
    }
    if (toEnroll.length) {
      const nextSendAt = campaign.startsAt && campaign.startsAt > new Date() ? campaign.startsAt : new Date();
      await db.insert(campaignEnrollments).values(toEnroll.map((e) => ({ orgId: session.orgId, campaignId, leadId: e.leadId, contactId: e.contactId, currentStep: 0, nextSendAt, status: "active" as const })));
      await audit(session, { entityType: "campaign", entityId: campaignId, action: "bulk_enroll", after: { name: campaign.name, leadIds: toEnroll.map((e) => e.leadId), skipped } });
    }
    revalidatePath("/leads"); revalidatePath(`/campaigns/${campaignId}`); revalidatePath("/campaigns");
    const reasons = [
      skipped.consent ? `${skipped.consent} opted out or do not contact` : "", skipped.address ? `${skipped.address} no ${campaign.channel === "sms" ? "phone" : "email"}` : "",
      skipped.already ? `${skipped.already} already enrolled` : "", skipped.noContact ? `${skipped.noContact} no primary contact` : "", owned.missing ? `${owned.missing} not found` : "",
    ].filter(Boolean);
    const skippedTotal = skipped.consent + skipped.address + skipped.already + skipped.noContact + owned.missing;
    const message = `Enrolled ${toEnroll.length} in ${campaign.name}${skippedTotal ? `, skipped ${skippedTotal} (${reasons.join(", ")})` : ""}`;
    // Nothing enrolled is reported as a failure so the bar does not show it in the success color.
    return toEnroll.length ? { ok: true, message } : { ok: false, error: message };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not enroll the leads.") };
  }
}
