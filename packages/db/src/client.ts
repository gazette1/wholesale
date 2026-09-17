import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import postgres from "postgres";
import { PGlite } from "@electric-sql/pglite";
import { resolve } from "node:path";
import * as schema from "./schema";

export type PostgresDb = ReturnType<typeof createPostgresDb>;
export type PgliteDb = ReturnType<typeof createPgliteDb>;
export type Db = PostgresDb | PgliteDb;

/** Hosted Postgres (Supabase pooler). Used by the web app in production. */
export function createPostgresDb(url: string) {
  const client = postgres(url, { prepare: false, max: 10 });
  return drizzlePostgres(client, { schema, casing: "snake_case" });
}

/** In process Postgres. Memory only when dataDir is omitted, file backed otherwise. */
export function createPgliteDb(dataDir?: string) {
  const client = new PGlite(dataDir);
  return drizzlePglite(client, { schema, casing: "snake_case" });
}

const globalStore = globalThis as unknown as { __dealcalcDb?: Db; __dealcalcDbKind?: "postgres" | "pglite" };

/**
 * Singleton for server code. Uses DATABASE_URL when set. Without it, falls
 * back to a file backed PGlite database under .pglite/ so the app runs with no
 * credentials, migrated and seeded on first use by ensureDevDatabase().
 */
export function db(): Db {
  if (globalStore.__dealcalcDb) return globalStore.__dealcalcDb;
  const url = process.env.DATABASE_URL;
  if (url) {
    globalStore.__dealcalcDb = createPostgresDb(url);
    globalStore.__dealcalcDbKind = "postgres";
  } else {
    // On Vercel the filesystem is read only apart from /tmp, and instances are ephemeral.
    // An in memory database that reseeds on cold start is enough for a demo link.
    const dir = process.env.PGLITE_DATA_DIR ?? (process.env.VERCEL ? undefined : resolve(process.cwd(), "../../.pglite"));
    globalStore.__dealcalcDb = createPgliteDb(dir);
    globalStore.__dealcalcDbKind = "pglite";
  }
  return globalStore.__dealcalcDb;
}

export function dbKind(): "postgres" | "pglite" {
  db();
  return globalStore.__dealcalcDbKind ?? "pglite";
}
