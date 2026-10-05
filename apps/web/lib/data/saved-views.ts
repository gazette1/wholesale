import { and, asc, eq, or } from "drizzle-orm";
import { savedViews, profiles } from "@dealcalc/db";
import { getDb } from "../db";

import { VIEW_FILTER_KEYS, LEAD_COLUMN_KEYS, type SavedViewEntity } from "../saved-view-config";
export { VIEW_FILTER_KEYS, LEAD_COLUMN_KEYS, type SavedViewEntity } from "../saved-view-config";

/** Own views plus views shared in the org, own first. Matches the saved_views row level security policy. */
export async function listSavedViews(orgId: string, profileId: string, entity: SavedViewEntity) {
  const db = await getDb();
  const rows = await db.select({ id: savedViews.id, name: savedViews.name, filters: savedViews.filters, sort: savedViews.sort, columns: savedViews.columns, isShared: savedViews.isShared, ownerId: savedViews.ownerId, ownerName: profiles.fullName })
    .from(savedViews).leftJoin(profiles, eq(savedViews.ownerId, profiles.id))
    .where(and(eq(savedViews.orgId, orgId), eq(savedViews.entity, entity), or(eq(savedViews.ownerId, profileId), eq(savedViews.isShared, true))))
    .orderBy(asc(savedViews.name));
  const allowed = VIEW_FILTER_KEYS[entity];
  const clean = (f: Record<string, unknown>) => Object.fromEntries(Object.entries(f ?? {}).filter((e): e is [string, string] => allowed.includes(e[0]) && typeof e[1] === "string" && e[1] !== ""));
  // Empty means "every column", so a view saved before the picker existed still renders exactly as it did before.
  const cleanColumns = (c: string[]) => (entity === "leads" ? c.filter((k) => (LEAD_COLUMN_KEYS as readonly string[]).includes(k)) : []);
  const views = rows.map((r) => ({ id: r.id, name: r.name, filters: clean(r.filters), sort: r.sort?.[0] ?? null, columns: cleanColumns(r.columns ?? []), isShared: r.isShared, mine: r.ownerId === profileId, ownerName: r.ownerName }));
  return [...views.filter((v) => v.mine), ...views.filter((v) => !v.mine)];
}

export type SavedView = Awaited<ReturnType<typeof listSavedViews>>[number];
