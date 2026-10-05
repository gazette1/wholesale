import { createPgliteDb, migrate, dealPackages, dealSubmissions } from "@dealcalc/db";
import { seed } from "../../../packages/db/src/seed";

async function main() {
  if (!process.env.PGLITE_DATA_DIR || process.env.DATABASE_URL) throw new Error("E2E requires its own local database");
  const db = createPgliteDb(process.env.PGLITE_DATA_DIR);
  await migrate(db);
  const data = await seed(db, { seed: 7 });
  for (const expired of [false, true]) {
    const [pkg] = await db.insert(dealPackages).values({
      id: expired ? "00000000-0000-4000-8000-000000000002" : "00000000-0000-4000-8000-000000000001",
      orgId: data.orgId, analysisId: data.analysisIds[0]!,
      shareToken: expired ? "e2e_expired_package_token" : "e2e_public_package_token",
      expiresAt: new Date(Date.now() + (expired ? -1 : 30) * 86_400_000),
      sections: { notes: false },
    }).returning();
    await db.insert(dealSubmissions).values({ orgId: data.orgId, analysisId: data.analysisIds[0]!, buyerId: data.buyerIds[0]!, packageId: pkg!.id,
      token: expired ? "e2e_expired_buyer_token" : "e2e_tracked_buyer_token" });
  }
  await db.$client.close();
}
main().catch((error) => { console.error(error); process.exit(1); });
