/**
 * First run of a real workspace. Creates the org, the team, pipeline stages, lead sources, tags,
 * message templates, and the workbook rehab prices. No demo leads, buyers, or analyses.
 * Separate from seed(), which exists to fill a demo with sample deals.
 */
import type { Db } from "../client";
import { orgs, profiles, pipelineStages, leadSources, tags, messageTemplates, costDefaults } from "../schema";
import { REHAB_CHECKLIST } from "./rehabChecklist";
import { STAGES, ISSUE_TAGS, TEMPLATES } from "./index";

export type TeamMember = { fullName: string; email: string; role: "admin" | "acquisitions" | "dispositions" | "viewer" };

export type BootstrapOptions = {
  orgName: string;
  team: TeamMember[];
  /** Lead sources to start with. Cost per lead is set later under Settings. */
  sources?: string[];
  companyName?: string;
  companyPhone?: string;
  companyEmail?: string;
};

export const DEFAULT_SOURCES = ["Website", "Referral", "Direct Mail", "Cold call", "Driving for Dollars", "PPC"];

export type BootstrapResult = { orgId: string; profileIds: string[]; stageCount: number; templateCount: number; costDefaultCount: number };

export async function bootstrap(db: Db, options: BootstrapOptions): Promise<BootstrapResult> {
  if (!options.orgName.trim()) throw new Error("orgName is required");
  if (options.team.length === 0) throw new Error("At least one team member is required");
  if (!options.team.some((m) => m.role === "admin")) throw new Error("At least one team member must be an admin");
  const seen = new Set<string>();
  for (const m of options.team) {
    const email = m.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error(`Not a valid email: ${m.email}`);
    if (seen.has(email)) throw new Error(`Duplicate email: ${email}`);
    seen.add(email);
  }

  const [org] = await db.insert(orgs).values({
    name: options.orgName.trim(),
    branding: { companyName: options.companyName ?? options.orgName.trim(), phone: options.companyPhone, email: options.companyEmail },
  }).returning();
  const orgId = org!.id;

  // Profiles are claimed by email the first time that person signs in, so user_id stays null here.
  const profileRows = await db.insert(profiles).values(
    options.team.map((m) => ({ orgId, fullName: m.fullName.trim(), email: m.email.trim().toLowerCase(), role: m.role, active: true })),
  ).returning();

  const stageRows = await db.insert(pipelineStages).values(
    STAGES.map((s, i) => ({ orgId, key: s.key, name: s.name, position: i + 1, color: s.color, isTerminal: "isTerminal" in s ? Boolean(s.isTerminal) : false })),
  ).returning();

  await db.insert(leadSources).values((options.sources ?? DEFAULT_SOURCES).map((name) => ({ orgId, name, active: true })));

  await db.insert(tags).values([
    ...ISSUE_TAGS.map((name) => ({ orgId, name, kind: "issue" as const, color: "#ef4444" })),
    { orgId, name: "Hot", kind: "lead" as const, color: "#f97316" },
    { orgId, name: "Cash buyer ready", kind: "lead" as const, color: "#22c55e" },
    { orgId, name: "Needs comps", kind: "lead" as const, color: "#0ea5e9" },
  ]);

  const templateRows = await db.insert(messageTemplates).values(
    TEMPLATES.map((t) => ({ orgId, channel: t.channel, name: t.name, subject: "subject" in t ? t.subject : null, body: t.body, mergeFields: ["first_name", "property_address", "sender_name"] })),
  ).returning();

  // The rehab checklist prices every analysis reads. Without them the checklist has no prices to offer.
  const costRows = await db.insert(costDefaults).values(
    REHAB_CHECKLIST.map((l) => ({ orgId, rowNumber: l.row, itemNumber: l.itemNumber, question: l.question, option: l.option, unitCost: l.unitCost === null ? null : l.unitCost.toFixed(2), unit: l.unit, market: "Baltimore metro (workbook defaults)", asOf: "2026-09-14" })),
  ).returning();

  return { orgId, profileIds: profileRows.map((p) => p.id), stageCount: stageRows.length, templateCount: templateRows.length, costDefaultCount: costRows.length };
}

/** Parses "Russ Harris <russ@example.com>:admin, Ous <ous@example.com>:acquisitions". */
export function parseTeam(input: string): TeamMember[] {
  return input.split(",").map((raw) => {
    const part = raw.trim();
    if (!part) throw new Error("Empty team entry");
    const m = /^(.+?)\s*<([^>]+)>\s*(?::\s*(admin|acquisitions|dispositions|viewer))?$/.exec(part);
    if (!m) throw new Error(`Could not read team entry: ${part}. Use: Name <email>:role`);
    return { fullName: m[1]!.trim(), email: m[2]!.trim(), role: (m[3] ?? "admin") as TeamMember["role"] };
  });
}
