import { sql } from "drizzle-orm";
import { db, dbKind } from "./client";
import { migrate } from "./migrate";
import { seed } from "./seed";

const store = globalThis as unknown as { __dealcalcDevReady?: Promise<void> };

/**
 * When running on PGlite (no DATABASE_URL), make sure the schema exists and the
 * demo data is loaded. Safe to call on every request; it runs once per process.
 */
export function ensureDevDatabase(): Promise<void> {
  if (store.__dealcalcDevReady) return store.__dealcalcDevReady;
  store.__dealcalcDevReady = (async () => {
    if (dbKind() !== "pglite") return;
    const conn = db();
    const exists = await conn.execute(sql`select to_regclass('public.orgs') as t`);
    const row = (exists as any).rows?.[0] ?? (exists as any)[0];
    if (!row?.t) {
      await migrate(conn);
    }
    const orgCount = await conn.execute(sql`select count(*)::int as n from orgs`);
    const n = ((orgCount as any).rows?.[0] ?? (orgCount as any)[0])?.n ?? 0;
    if (Number(n) === 0) {
      await seed(conn);
    }
  })();
  return store.__dealcalcDevReady;
}
