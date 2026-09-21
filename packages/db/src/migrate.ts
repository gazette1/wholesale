import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { EMBEDDED_MIGRATIONS } from "./migrations.generated";

/**
 * Migrations are embedded at generate time (scripts/embed-migrations.ts) so the
 * migrator works inside serverless bundles that carry no migrations folder.
 * Files with "rls" in the name need Supabase's auth and storage schemas and are skipped on PGlite.
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

function rowsOf(result: unknown): Record<string, unknown>[] {
  const r = result as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
  return Array.isArray(r) ? r : r.rows ?? [];
}

/**
 * Apply every migration that has not run yet, in order. Applied files are
 * recorded in _dealcalc_migrations, so a database created under an older schema
 * picks up only the new files. A database that predates the ledger (orgs exists,
 * ledger empty) is assumed to hold 0000 already.
 */
export async function migrate(db: Db, options: { includeSupabaseOnly?: boolean } = {}): Promise<string[]> {
  await db.execute(sql.raw(`create table if not exists _dealcalc_migrations (file text primary key, applied_at timestamptz not null default now())`));
  const done = new Set(rowsOf(await db.execute(sql.raw(`select file from _dealcalc_migrations`))).map((r) => String(r.file)));
  if (done.size === 0) {
    const legacy = rowsOf(await db.execute(sql.raw(`select to_regclass('public.orgs') as t`)))[0]?.t;
    if (legacy) {
      const first = migrationFiles(options)[0];
      if (first) { await db.execute(sql`insert into _dealcalc_migrations (file) values (${first})`); done.add(first); }
    }
  }
  const applied: string[] = [];
  for (const file of migrationFiles(options)) {
    if (done.has(file)) continue;
    for (const statement of splitStatements(migrationSql(file))) {
      await db.execute(sql.raw(statement));
    }
    await db.execute(sql`insert into _dealcalc_migrations (file) values (${file})`);
    applied.push(file);
  }
  return applied;
}
