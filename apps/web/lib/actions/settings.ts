"use server";
import { revalidatePath } from "next/cache";
import { and, eq, max, ne, or, sql } from "drizzle-orm";
import { profiles, pipelineStages, leadSources, orgs, tags } from "@dealcalc/db";
import { normalizePhone } from "@dealcalc/integrations";
import { getDb } from "../db";
import { requireSession, type Session } from "../auth";
import { audit } from "../audit";
import { friendlyError, isEmail, isUuid, moneyField, textField } from "../safe";
import type { ActionResult } from "./leads";

type Db = Awaited<ReturnType<typeof getDb>>;
type Role = "admin" | "acquisitions" | "dispositions" | "viewer";
const ROLES: Role[] = ["admin", "acquisitions", "dispositions", "viewer"];
const DUPLICATE_EMAIL = "Another team member already uses that email.";
const MAX_SOURCE_COST = 100_000;

/** Admin check, database handle, try and catch. Nothing thrown in here reaches the page, and no SQL text reaches the user. */
async function adminAction(session: Session, fallback: string, fn: (db: Db) => Promise<ActionResult>, onUnique?: string): Promise<ActionResult> {
  try {
    if (session.role !== "admin") return { ok: false, error: "Admins only." };
    return await fn(await getDb());
  } catch (err) {
    if (onUnique && isUniqueViolation(err)) return { ok: false, error: onUnique };
    return { ok: false, error: friendlyError(err, fallback) };
  }
}

/** Postgres reports a unique index hit as code 23505. Drizzle wraps the driver error, so look at the cause too. */
function isUniqueViolation(err: unknown): boolean {
  for (const e of [err, (err as { cause?: unknown } | null)?.cause]) {
    if (!e || typeof e !== "object") continue;
    if ((e as { code?: unknown }).code === "23505") return true;
    if (/duplicate key|unique constraint/i.test(String((e as { message?: unknown }).message ?? ""))) return true;
  }
  return false;
}

function roleOf(raw: FormDataEntryValue | null, fallback: Role): Role | null {
  if (raw === null || raw === "") return fallback;
  return ROLES.includes(raw as Role) ? (raw as Role) : null;
}

function colorOf(raw: FormDataEntryValue | null, fallback: string): string {
  const text = String(raw ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
}

/** Blank is null. Anything else must be a phone number we can dial. */
function phoneOf(raw: FormDataEntryValue | null, label: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, value: null };
  const normal = normalizePhone(text);
  return normal ? { ok: true, value: normal } : { ok: false, error: `${label} must be a phone number such as +14105550000.` };
}

async function emailTaken(db: Db, orgId: string, email: string, exceptProfileId?: string): Promise<boolean> {
  const where = [eq(profiles.orgId, orgId), sql`lower(${profiles.email}) = ${email}`];
  if (exceptProfileId) where.push(ne(profiles.id, exceptProfileId));
  const [hit] = await db.select({ id: profiles.id }).from(profiles).where(and(...where)).limit(1);
  return Boolean(hit);
}

export async function inviteProfile(form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  return adminAction(session, "Could not add the team member.", async (db) => {
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const fullName = textField(form.get("fullName"), 120);
    if (!email || !fullName) return { ok: false, error: "Name and email are required." };
    if (!isEmail(email)) return { ok: false, error: "Enter a valid email address." };
    const role = roleOf(form.get("role"), "viewer");
    if (!role) return { ok: false, error: "Pick a role from the list." };
    const phone = phoneOf(form.get("phone"), "Phone");
    if (!phone.ok) return phone;
    const twilio = phoneOf(form.get("twilioNumber"), "Twilio number");
    if (!twilio.ok) return twilio;
    if (await emailTaken(db, session.orgId, email)) return { ok: false, error: DUPLICATE_EMAIL };
    const [p] = await db.insert(profiles).values({ orgId: session.orgId, email, fullName, role, phone: phone.value, twilioNumber: twilio.value }).returning();
    await audit(session, { entityType: "profile", entityId: p!.id, action: "invite", after: { name: fullName, email, role } });
    revalidatePath("/settings");
    return { ok: true, message: `${fullName} can now sign in with ${email}` };
  }, DUPLICATE_EMAIL);
}

export async function updateProfile(profileId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  return adminAction(session, "Could not save the team member.", async (db) => {
    if (!isUuid(profileId)) return { ok: false, error: "Profile not found." };
    const p = await db.query.profiles.findFirst({ where: and(eq(profiles.id, profileId), eq(profiles.orgId, session.orgId)) });
    if (!p) return { ok: false, error: "Profile not found." };
    const role = roleOf(form.get("role"), p.role);
    if (!role) return { ok: false, error: "Pick a role from the list." };
    const active = form.get("active") !== "off";
    if (p.id === session.profileId && (role !== "admin" || !active)) return { ok: false, error: "You cannot remove your own admin access." };
    const fullName = textField(form.get("fullName"), 120);
    if (!fullName) return { ok: false, error: "Name cannot be blank." };
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    if (!isEmail(email)) return { ok: false, error: "Enter a valid email address." };
    if (p.id === session.profileId && email !== p.email.toLowerCase()) return { ok: false, error: "Your email is your login identity and cannot be changed here. Ask another admin, or change it with the sign in provider first." };
    if (email !== p.email.toLowerCase() && await emailTaken(db, session.orgId, email, p.id)) return { ok: false, error: DUPLICATE_EMAIL };
    const twilio = phoneOf(form.get("twilioNumber"), "Twilio number");
    if (!twilio.ok) return twilio;
    // The team card has no phone input. Only touch the phone when the form actually sent one.
    const phone = form.has("phone") ? phoneOf(form.get("phone"), "Phone") : { ok: true as const, value: p.phone };
    if (!phone.ok) return phone;
    await db.update(profiles).set({ role, active, fullName, email, twilioNumber: twilio.value, phone: phone.value }).where(and(eq(profiles.id, profileId), eq(profiles.orgId, session.orgId)));
    await audit(session, { entityType: "profile", entityId: profileId, action: "update", before: { name: p.fullName, email: p.email, role: p.role, active: p.active, twilioNumber: p.twilioNumber }, after: { name: fullName, email, role, active, twilioNumber: twilio.value } });
    revalidatePath("/settings");
    return { ok: true, message: "Saved" };
  }, DUPLICATE_EMAIL);
}

export async function saveStage(stageId: string | null, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const DUPLICATE = "A stage with that name already exists.";
  return adminAction(session, "Could not save the stage.", async (db) => {
    if (stageId !== null && !isUuid(stageId)) return { ok: false, error: "Stage not found." };
    const name = textField(form.get("name"), 60);
    if (!name) return { ok: false, error: "Stage needs a name." };
    const isTerminal = form.get("isTerminal") === "on";
    const sameName = sql`lower(${pipelineStages.name}) = ${name.toLowerCase()}`;
    if (stageId) {
      const before = await db.query.pipelineStages.findFirst({ where: and(eq(pipelineStages.id, stageId), eq(pipelineStages.orgId, session.orgId)) });
      if (!before) return { ok: false, error: "Stage not found." };
      const [clash] = await db.select({ id: pipelineStages.id }).from(pipelineStages).where(and(eq(pipelineStages.orgId, session.orgId), ne(pipelineStages.id, stageId), sameName)).limit(1);
      if (clash) return { ok: false, error: DUPLICATE };
      const color = colorOf(form.get("color"), before.color ?? "#6b7280");
      await db.update(pipelineStages).set({ name, color, isTerminal }).where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.orgId, session.orgId)));
      await audit(session, { entityType: "stage", entityId: stageId, action: "update", before: { name: before.name, color: before.color, isTerminal: before.isTerminal }, after: { name, color, isTerminal } });
    } else {
      const key = (String(form.get("key") ?? "").trim() || name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
      if (!key) return { ok: false, error: "Stage name needs at least one letter or number." };
      const [clash] = await db.select({ id: pipelineStages.id }).from(pipelineStages).where(and(eq(pipelineStages.orgId, session.orgId), or(eq(pipelineStages.key, key), sameName))).limit(1);
      if (clash) return { ok: false, error: DUPLICATE };
      const color = colorOf(form.get("color"), "#6b7280");
      const [pos] = await db.select({ p: max(pipelineStages.position) }).from(pipelineStages).where(eq(pipelineStages.orgId, session.orgId));
      const [s] = await db.insert(pipelineStages).values({ orgId: session.orgId, key, name, color, isTerminal, position: (pos?.p ?? 0) + 1 }).returning();
      await audit(session, { entityType: "stage", entityId: s!.id, action: "create", after: { name, key, color, isTerminal, position: s!.position } });
    }
    revalidatePath("/settings"); revalidatePath("/pipeline");
    return { ok: true, message: stageId ? "Stage saved" : "Stage added" };
  }, DUPLICATE);
}

export async function moveStage(stageId: string, direction: -1 | 1): Promise<ActionResult> {
  const session = await requireSession();
  return adminAction(session, "Could not move the stage.", async (db) => {
    if (!isUuid(stageId) || (direction !== -1 && direction !== 1)) return { ok: false, error: "Stage not found." };
    const all = await db.select().from(pipelineStages).where(eq(pipelineStages.orgId, session.orgId)).orderBy(pipelineStages.position);
    const i = all.findIndex((s) => s.id === stageId);
    if (i < 0) return { ok: false, error: "Stage not found." };
    const j = i + direction;
    if (j < 0 || j >= all.length) return { ok: true, message: direction === -1 ? "Already first" : "Already last" };
    const a = all[i]!, b = all[j]!;
    await db.update(pipelineStages).set({ position: b.position }).where(and(eq(pipelineStages.id, a.id), eq(pipelineStages.orgId, session.orgId)));
    await db.update(pipelineStages).set({ position: a.position }).where(and(eq(pipelineStages.id, b.id), eq(pipelineStages.orgId, session.orgId)));
    await audit(session, { entityType: "stage", entityId: a.id, action: "move", before: { name: a.name, position: a.position }, after: { name: a.name, position: b.position, swappedWith: b.name } });
    revalidatePath("/settings"); revalidatePath("/pipeline");
    return { ok: true, message: "Moved" };
  });
}

export async function saveSource(form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  return adminAction(session, "Could not save the source.", async (db) => {
    const name = textField(form.get("name"), 80);
    if (!name) return { ok: false, error: "Source needs a name." };
    const cost = moneyField(form.get("costPerLead"), "Cost per lead", { max: MAX_SOURCE_COST });
    if (!cost.ok) return cost;
    const costPerLead = cost.value === null ? null : cost.value.toFixed(2);
    const [existing] = await db.select().from(leadSources).where(and(eq(leadSources.orgId, session.orgId), sql`lower(${leadSources.name}) = ${name.toLowerCase()}`)).limit(1);
    if (existing) {
      // Adding a name that already exists is how a wrong cost gets corrected.
      if (costPerLead === null) return { ok: false, error: "A source with that name already exists. Enter a cost to update it." };
      await db.update(leadSources).set({ costPerLead }).where(and(eq(leadSources.id, existing.id), eq(leadSources.orgId, session.orgId)));
      await audit(session, { entityType: "lead_source", entityId: existing.id, action: "update", before: { name: existing.name, costPerLead: existing.costPerLead }, after: { name: existing.name, costPerLead } });
      revalidatePath("/settings");
      return { ok: true, message: `Updated ${existing.name}` };
    }
    const [s] = await db.insert(leadSources).values({ orgId: session.orgId, name, costPerLead }).returning();
    await audit(session, { entityType: "lead_source", entityId: s!.id, action: "create", after: { name, costPerLead } });
    revalidatePath("/settings");
    return { ok: true, message: "Source added" };
  }, "A source with that name already exists.");
}

/** Rename a source, correct its cost, or switch it off. */
export async function updateSource(sourceId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const DUPLICATE = "A source with that name already exists.";
  return adminAction(session, "Could not save the source.", async (db) => {
    if (!isUuid(sourceId)) return { ok: false, error: "Source not found." };
    const before = await db.query.leadSources.findFirst({ where: and(eq(leadSources.id, sourceId), eq(leadSources.orgId, session.orgId)) });
    if (!before) return { ok: false, error: "Source not found." };
    const name = textField(form.get("name"), 80);
    if (!name) return { ok: false, error: "Source needs a name." };
    const cost = moneyField(form.get("costPerLead"), "Cost per lead", { max: MAX_SOURCE_COST });
    if (!cost.ok) return cost;
    const costPerLead = cost.value === null ? null : cost.value.toFixed(2);
    const active = form.get("active") !== "off";
    const [clash] = await db.select({ id: leadSources.id }).from(leadSources).where(and(eq(leadSources.orgId, session.orgId), ne(leadSources.id, sourceId), sql`lower(${leadSources.name}) = ${name.toLowerCase()}`)).limit(1);
    if (clash) return { ok: false, error: DUPLICATE };
    await db.update(leadSources).set({ name, costPerLead, active }).where(and(eq(leadSources.id, sourceId), eq(leadSources.orgId, session.orgId)));
    await audit(session, { entityType: "lead_source", entityId: sourceId, action: "update", before: { name: before.name, costPerLead: before.costPerLead, active: before.active }, after: { name, costPerLead, active } });
    revalidatePath("/settings");
    return { ok: true, message: "Saved" };
  }, DUPLICATE);
}

export async function saveBranding(form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  return adminAction(session, "Could not save branding.", async (db) => {
    const org = await db.query.orgs.findFirst({ where: eq(orgs.id, session.orgId) });
    if (!org) return { ok: false, error: "Workspace not found." };
    const email = String(form.get("email") ?? "").trim();
    if (email && !isEmail(email)) return { ok: false, error: "Enter a valid email address, or leave it blank." };
    const logoRaw = String(form.get("logoUrl") ?? "").trim();
    let logoUrl: string | undefined;
    if (logoRaw) {
      if (logoRaw.length > 500) return { ok: false, error: "Logo URL must be 500 characters or fewer." };
      let parsed: URL | null = null;
      try { parsed = new URL(logoRaw); } catch { parsed = null; }
      if (!parsed || parsed.protocol !== "https:" || !parsed.hostname.includes(".")) return { ok: false, error: "Logo URL must be a full https address, for example https://example.com/logo.png." };
      logoUrl = parsed.toString();
    }
    const primaryRaw = String(form.get("primaryColor") ?? "").trim();
    if (primaryRaw && !/^#[0-9a-f]{6}$/i.test(primaryRaw)) return { ok: false, error: "Accent color must be a hex color such as #0f172a." };
    const before = (org.branding ?? {}) as Record<string, unknown>;
    const branding = {
      ...before,
      companyName: textField(form.get("companyName"), 120) ?? undefined,
      phone: textField(form.get("phone"), 40) ?? undefined,
      email: email || undefined,
      primaryColor: primaryRaw || undefined,
      disclosure: textField(form.get("disclosure"), 2000) ?? undefined,
      logoUrl,
    };
    const name = textField(form.get("orgName"), 80) ?? org.name ?? "Workspace";
    await db.update(orgs).set({ name, branding }).where(eq(orgs.id, session.orgId));
    await audit(session, { entityType: "org", entityId: session.orgId, action: "branding", before: { name: org.name, branding: before }, after: { name, branding } });
    revalidatePath("/settings"); revalidatePath("/", "layout");
    return { ok: true, message: "Branding saved" };
  });
}

export async function deleteTag(tagId: string): Promise<ActionResult> {
  const session = await requireSession();
  return adminAction(session, "Could not delete the tag.", async (db) => {
    if (!isUuid(tagId)) return { ok: false, error: "Tag not found." };
    const tag = await db.query.tags.findFirst({ where: and(eq(tags.id, tagId), eq(tags.orgId, session.orgId)) });
    if (!tag) return { ok: false, error: "Tag not found." };
    await db.delete(tags).where(and(eq(tags.id, tagId), eq(tags.orgId, session.orgId)));
    await audit(session, { entityType: "tag", entityId: tagId, action: "delete", before: { name: tag.name, kind: tag.kind, color: tag.color } });
    revalidatePath("/settings"); revalidatePath("/leads");
    return { ok: true, message: "Tag deleted" };
  });
}
