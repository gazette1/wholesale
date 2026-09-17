import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { EMBEDDED_MIGRATIONS } from "./migrations.generated";

/**
 * Migrations are embedded at generate time (scripts/embed-migrations.ts) so the
 * migrator works inside serverless bundles that carry no migrations folder.
 * The RLS file needs Supabase's auth and storage schemas and is skipped on PGlite.
 */
export function migrationFiles(options: { includeSupabaseOnly?: boolean } = {}): string[] {
  return Object.keys(EMBEDDED_MIGRATIONS)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .filter((f) => options.includeSupabaseOnly || !f.includes("rls"))
    .sort();
}

export function migrationSql(file: string): string {
  const text = EMBEDDED_MIGRATIONS[file];
  if (text === undefined) throw new Error(`Unknown migration ${file}`);
  return text;
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
    for (const statement of splitStatements(migrationSql(file))) {
      await db.execute(sql.raw(statement));
    }
    applied.push(file);
  }
  return applied;
}
