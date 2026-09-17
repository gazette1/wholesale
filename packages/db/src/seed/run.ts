/**
 * Seed the hosted database. Refuses to run twice against the same org name.
 *   DATABASE_URL=... pnpm --filter @dealcalc/db seed
 */
import { createPostgresDb } from "../client";
import { seed } from "./index";
import { orgs } from "../schema";
import { eq } from "drizzle-orm";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = createPostgresDb(url);
  const existing = await db.query.orgs.findFirst({ where: eq(orgs.name, "Acquisitions Team") });
  if (existing) {
    console.log(`Org "Acquisitions Team" already exists (${existing.id}). Delete it first to reseed.`);
    process.exit(0);
  }
  const result = await seed(db, { adminEmail: process.env.SEED_ADMIN_EMAIL });
  console.log(`Seeded org ${result.orgId}: ${result.leadIds.length} leads, ${result.buyerIds.length} buyers, ${result.analysisIds.length} analyses.`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
