"use server";
import { revalidatePath } from "next/cache";
import { and, count, eq } from "drizzle-orm";
import { savedViews } from "@dealcalc/db";
import { getDb } from "../db";
import { requireSession, type Session } from "../auth";
import { audit } from "../audit";
import { friendlyError, isUuid, textField } from "../safe";
import { VIEW_FILTER_KEYS, LEAD_COLUMN_KEYS, type SavedViewEntity } from "../data/saved-views";
import type { ActionResult } from "./leads";

const MAX_VIEWS_PER_USER = 50;
const LIST_PATH: Record<SavedViewEntity, string> = { leads: "/leads", buyers: "/buyers" };

/** Every role may keep its own views (the row level security policy allows all four). Sharing with the team is for admin and acquisitions. */
function canShare(session: Session): boolean {
  return session.role === "admin" || session.role === "acquisitions";
}

/** Keeps only known filter keys with short string values, so nothing arbitrary is stored or later put in a URL. */
function parseFilters(raw: FormDataEntryValue | null, entity: SavedViewEntity): Record<string, string> | null {
  let parsed: unknown;
  try { parsed = JSON.parse(String(raw ?? "{}")); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out: Record<string, string> = {};
  for (const key of VIEW_FILTER_KEYS[entity]) {
    const v = (parsed as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim().slice(0, 200);
  }
  return out;
}

/**
 * Only leads have a column picker today. The dialog posts one "columns" checkbox per picked column;
 * an unknown value (a column since renamed or removed) is dropped, not stored.
 */
function parseColumns(form: FormData, entity: SavedViewEntity): string[] {
  if (entity !== "leads") return [];
  const allowed: readonly string[] = LEAD_COLUMN_KEYS;
  return [...new Set(form.getAll("columns").filter((v): v is string => typeof v === "string" && allowed.includes(v)))];
}

export async function saveView(form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const entityRaw = String(form.get("entity") ?? "leads");
    if (entityRaw !== "leads" && entityRaw !== "buyers") return { ok: false, error: "Unknown view type." };
    const entity: SavedViewEntity = entityRaw;
    const name = textField(form.get("name"), 60);
    if (!name) return { ok: false, error: "Give the view a name." };
    const filters = parseFilters(form.get("filters"), entity);
    if (!filters) return { ok: false, error: "The current filters could not be read. Reload the page and try again." };
    const sortId = String(form.get("sort") ?? "");
    const sort = /^[A-Za-z]{1,30}$/.test(sortId) ? [{ id: sortId, desc: String(form.get("dir") ?? "") === "desc" }] : [];
    if (Object.keys(filters).length === 0 && sort.length === 0) return { ok: false, error: "Set at least one filter before saving a view." };
    const isShared = form.get("isShared") === "on";
    if (isShared && !canShare(session)) return { ok: false, error: `Your role (${session.role}) cannot share views with the team.` };
    const db = await getDb();
    const mine = and(eq(savedViews.orgId, session.orgId), eq(savedViews.ownerId, session.profileId), eq(savedViews.entity, entity));
    const [existing, total] = await Promise.all([
      db.query.savedViews.findFirst({ where: and(mine, eq(savedViews.name, name)) }),
      db.select({ n: count() }).from(savedViews).where(mine),
    ]);
    if (existing) return { ok: false, error: `You already have a view named "${name}". Delete it first or pick another name.` };
    if ((total[0]?.n ?? 0) >= MAX_VIEWS_PER_USER) return { ok: false, error: `You have ${MAX_VIEWS_PER_USER} saved views. Delete one before adding another.` };
    const columns = parseColumns(form, entity);
    const [created] = await db.insert(savedViews).values({ orgId: session.orgId, ownerId: session.profileId, entity, name, filters, sort, columns, isShared }).returning();
    await audit(session, { entityType: "saved_view", entityId: created!.id, action: "create", after: { entity, name, filters, sort, columns, isShared } });
    revalidatePath(LIST_PATH[entity]);
    return { ok: true, id: created!.id, message: isShared ? "View saved and shared" : "View saved" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not save the view.") };
  }
}

export async function deleteView(viewId: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    if (!isUuid(viewId)) return { ok: false, error: "View not found." };
    const db = await getDb();
    const owned = and(eq(savedViews.id, viewId), eq(savedViews.orgId, session.orgId), eq(savedViews.ownerId, session.profileId));
    const view = await db.query.savedViews.findFirst({ where: owned });
    // A shared view that belongs to someone else reads the same as a missing one: only its owner may delete it.
    if (!view) return { ok: false, error: "View not found, or it belongs to someone else." };
    await db.delete(savedViews).where(owned);
    await audit(session, { entityType: "saved_view", entityId: viewId, action: "delete", before: { entity: view.entity, name: view.name, isShared: view.isShared } });
    revalidatePath(LIST_PATH[view.entity]);
    return { ok: true, message: "View deleted" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not delete the view.") };
  }
}

/**
 * Renames a view, or overwrites it with the filters, sort, and columns applied right now (the `overwrite`
 * checkbox decides which). Replaces the old delete-then-save-again path with one edit in place.
 */
export async function updateView(viewId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    if (!isUuid(viewId)) return { ok: false, error: "View not found." };
    const db = await getDb();
    const owned = and(eq(savedViews.id, viewId), eq(savedViews.orgId, session.orgId), eq(savedViews.ownerId, session.profileId));
    const view = await db.query.savedViews.findFirst({ where: owned });
    if (!view) return { ok: false, error: "View not found, or it belongs to someone else." };
    const name = textField(form.get("name"), 60);
    if (!name) return { ok: false, error: "Give the view a name." };
    const entity = view.entity as SavedViewEntity;
    const overwrite = form.get("overwrite") === "on";
    let filters = view.filters as Record<string, string>;
    let sort = view.sort as { id: string; desc: boolean }[];
    let columns = view.columns as string[];
    if (overwrite) {
      const parsedFilters = parseFilters(form.get("filters"), entity);
      if (!parsedFilters) return { ok: false, error: "The current filters could not be read. Reload the page and try again." };
      const sortId = String(form.get("sort") ?? "");
      const parsedSort = /^[A-Za-z]{1,30}$/.test(sortId) ? [{ id: sortId, desc: String(form.get("dir") ?? "") === "desc" }] : [];
      if (Object.keys(parsedFilters).length === 0 && parsedSort.length === 0) return { ok: false, error: "Set at least one filter before overwriting a view." };
      filters = parsedFilters; sort = parsedSort; columns = parseColumns(form, entity);
    }
    if (name !== view.name) {
      const clash = await db.query.savedViews.findFirst({ where: and(eq(savedViews.orgId, session.orgId), eq(savedViews.ownerId, session.profileId), eq(savedViews.entity, view.entity), eq(savedViews.name, name)) });
      if (clash) return { ok: false, error: `You already have a view named "${name}". Pick another name.` };
    }
    await db.update(savedViews).set({ name, filters, sort, columns }).where(owned);
    await audit(session, { entityType: "saved_view", entityId: viewId, action: "update", before: { name: view.name, filters: view.filters, sort: view.sort, columns: view.columns }, after: { name, filters, sort, columns, overwrite } });
    revalidatePath(LIST_PATH[view.entity]);
    return { ok: true, message: overwrite ? "View updated" : "View renamed" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not update the view.") };
  }
}

export async function toggleShared(viewId: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    if (!isUuid(viewId)) return { ok: false, error: "View not found." };
    const db = await getDb();
    const owned = and(eq(savedViews.id, viewId), eq(savedViews.orgId, session.orgId), eq(savedViews.ownerId, session.profileId));
    const view = await db.query.savedViews.findFirst({ where: owned });
    if (!view) return { ok: false, error: "View not found, or it belongs to someone else." };
    // Taking a view back to private is always allowed; only sharing needs the role.
    if (!view.isShared && !canShare(session)) return { ok: false, error: `Your role (${session.role}) cannot share views with the team.` };
    await db.update(savedViews).set({ isShared: !view.isShared }).where(owned);
    await audit(session, { entityType: "saved_view", entityId: viewId, action: view.isShared ? "unshare" : "share", after: { name: view.name } });
    revalidatePath(LIST_PATH[view.entity]);
    return { ok: true, message: view.isShared ? "View is private again" : "View shared with the team" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not change sharing.") };
  }
}
