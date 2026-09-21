import { sql } from "drizzle-orm";
import { db, dbKind, type Db } from "./client";
import { migrate } from "./migrate";
import { seed } from "./seed";

const store = globalThis as unknown as { __dealcalcDevReady?: Promise<void> };

/**
 * Seeds with ids taken from a counter instead of gen_random_uuid(), then puts the random default back.
 * On Vercel every serverless function holds its own in memory copy of the demo data, so random ids made a
 * link rendered by one function (a pipeline card) point at a record another function (the analyzer) did not have.
 * The seed's content is already fixed by its random seed, so fixed ids make every copy identical.
 * Ids keep the version 4 and variant bits that isUuid() in the web app checks for.
 */
export async function seedWithStableIds(conn: Db): Promise<void> {
  await conn.execute(sql.raw(`create sequence if not exists _dealcalc_seed_id`));
  await conn.execute(sql.raw(`create or replace function _dealcalc_seed_uuid() returns uuid language sql as $$ select ('00000000-0000-4000-8000-' || lpad(to_hex(nextval('_dealcalc_seed_id')), 12, '0'))::uuid $$`));
  const tables = await conn.execute(sql.raw(`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'id' and column_default = 'gen_random_uuid()'`));
  const names = (((tables as any).rows ?? tables) as { table_name: string }[]).map((r) => r.table_name);
  const setDefault = async (expr: string) => { for (const t of names) await conn.execute(sql.raw(`alter table public."${t}" alter column id set default ${expr}`)); };
  await setDefault("_dealcalc_seed_uuid()");
  try {
    await seed(conn);
  } finally {
    await setDefault("gen_random_uuid()");
  }
}

/**
 * When running on PGlite (no DATABASE_URL), make sure the schema exists and the
 * demo data is loaded. Safe to call on every request; it runs once per process.
 */
export function ensureDevDatabase(): Promise<void> {
  if (store.__dealcalcDevReady) return store.__dealcalcDevReady;
  store.__dealcalcDevReady = (async () => {
    if (dbKind() !== "pglite") return;
    const conn = db();
    // Applies only the files that have not run yet, so an older local database upgrades in place.
    await migrate(conn);
    const orgCount = await conn.execute(sql`select count(*)::int as n from orgs`);
    const n = ((orgCount as any).rows?.[0] ?? (orgCount as any)[0])?.n ?? 0;
    if (Number(n) === 0) {
      await seedWithStableIds(conn);
    }
  })();
  return store.__dealcalcDevReady;
}
