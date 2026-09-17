import { db as rawDb, ensureDevDatabase, dbKind, type Db } from "@dealcalc/db";

/** Database handle for server code. On PGlite it migrates and seeds itself on first use. */
export async function getDb(): Promise<Db> {
  await ensureDevDatabase();
  return rawDb();
}

export { dbKind };
export type { Db };
