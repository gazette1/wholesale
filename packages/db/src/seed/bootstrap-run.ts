/**
 * Set up a real workspace on the hosted database. Refuses to touch a database that already has an org.
 *   DATABASE_URL=... BOOTSTRAP_ORG="Contact My REI" BOOTSTRAP_TEAM="Russ Harris <russ@example.com>:admin" pnpm --filter @dealcalc/db bootstrap
 */
import { createPostgresDb } from "../client";
import { bootstrap, parseTeam } from "./bootstrap";
import { orgs } from "../schema";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const orgName = process.env.BOOTSTRAP_ORG;
  if (!orgName) throw new Error('BOOTSTRAP_ORG is not set, for example BOOTSTRAP_ORG="Contact My REI"');
  const team = parseTeam(process.env.BOOTSTRAP_TEAM ?? "");
  const db = createPostgresDb(url);
  const existing = await db.select({ id: orgs.id, name: orgs.name }).from(orgs).limit(1);
  if (existing.length > 0) {
    console.log(`This database already has a workspace: ${existing[0]!.name} (${existing[0]!.id}). Nothing was changed.`);
    process.exit(0);
  }
  const out = await bootstrap(db, { orgName, team, sources: process.env.BOOTSTRAP_SOURCES?.split(",").map((s) => s.trim()).filter(Boolean) });
  console.log(`Workspace ${orgName} created: org ${out.orgId}, ${out.profileIds.length} team members, ${out.stageCount} stages, ${out.templateCount} templates, ${out.costDefaultCount} rehab prices.`);
  console.log("Each person signs in at /login?mode=signup with the email above to claim their account.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
