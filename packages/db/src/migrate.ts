import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { Db } from "./client";

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = resolve(here, "../migrations");

/** Migration files in order. The RLS file needs Supabase's auth and storage schemas and is skipped on PGlite. */
export function migrationFiles(options: { includeSupabaseOnly?: boolean } = {}): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .filter((f) => options.includeSupabaseOnly || !f.includes("rls"))
    .sort();
}

export function splitStatements(sqlText: string): string[] {
  return sqlText
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Apply the generated schema migrations to a PGlite or Postgres Drizzle client. */
export async function migrate(db: Db, options: { includeSupabaseOnly?: boolean } = {}): Promise<string[]> {
  const applied: string[] = [];
  for (const file of migrationFiles(options)) {
    const text = readFileSync(resolve(MIGRATIONS_DIR, file), "utf-8");
    for (const statement of splitStatements(text)) {
      await db.execute(sql.raw(statement));
    }
    applied.push(file);
  }
  return applied;
}
