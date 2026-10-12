"use server";
import { and, eq } from "drizzle-orm";
import { formSubmissions, formTasks, formVersions } from "@dealcalc/db";
import { findField, parseDefinition, type FieldDef } from "@dealcalc/forms";
import { getDb } from "../db";
import { friendlyError, isUuid } from "../safe";
import { getExternalActor, markUsedIfFinished, requestCode, verifyCode } from "../services/form-access";
import { discardFormFile, storeFormFile } from "../services/form-files";
import { addComment, completeTask, saveAnswers } from "../services/forms";
import type { ExternalActor } from "../forms/actor";

/** Every action here is public. The link token and the signed in cookie are the only credentials, and the org comes from the party row. */
export type FillResult = { ok: true; message?: string; id?: string; redirectTo?: string } | { ok: false; error: string };

const NOT_ALLOWED = "You do not have access to this section. Reload the page and sign in again.";
const MAX_PATCH_CHARS = 200_000;
const MAX_COMMENT_FILES = 5;

type Ctx = { actor: ExternalActor; task: typeof formTasks.$inferSelect; fields: FieldDef[]; def: ReturnType<typeof parseDefinition> };

/** Signed in actor plus a task that belongs to their submission and one of their sections. */
async function taskContext(token: string, taskId: string): Promise<Ctx | null> {
  const actor = await getExternalActor(token);
  if (!actor || !isUuid(taskId)) return null;
  const db = await getDb();
  const task = await db.query.formTasks.findFirst({ where: and(eq(formTasks.id, taskId), eq(formTasks.orgId, actor.orgId), eq(formTasks.submissionId, actor.submissionId)) });
  if (!task || !actor.sectionKeys.includes(task.sectionKey)) return null;
  const sub = await db.query.formSubmissions.findFirst({ where: and(eq(formSubmissions.id, actor.submissionId), eq(formSubmissions.orgId, actor.orgId)) });
  const version = sub ? await db.query.formVersions.findFirst({ where: and(eq(formVersions.id, sub.versionId), eq(formVersions.orgId, actor.orgId)) }) : null;
  if (!version) return null;
  const def = parseDefinition(version.definition);
  const fields = def.sections.find((s) => s.key === task.sectionKey)?.fields ?? [];
  return { actor, task, fields, def };
}

export async function requestFillCode(token: string, channel: "email" | "sms", contact?: string): Promise<FillResult> {
  try {
    const r = await requestCode(String(token), channel === "sms" ? "sms" : "email", typeof contact === "string" ? contact.slice(0, 254) : undefined);
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not send a code. Try again shortly.") };
  }
}

export async function verifyFillCode(token: string, code: string): Promise<FillResult> {
  try {
    const r = await verifyCode(String(token), String(code ?? ""));
    return r.ok ? { ok: true, redirectTo: r.redirectTo } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not check that code. Try again.") };
  }
}

export async function saveFillAnswers(token: string, taskId: string, patch: Record<string, unknown>): Promise<FillResult> {
  try {
    const ctx = await taskContext(token, taskId);
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    if (!patch || typeof patch !== "object" || Array.isArray(patch) || JSON.stringify(patch).length > MAX_PATCH_CHARS) return { ok: false, error: "Those answers could not be saved." };
    // Files arrive through uploadFillFile and people are chosen by the team, so neither is writable here.
    const writable = new Set(ctx.fields.filter((f) => f.visibleToExternal && !f.readOnly && !["content", "file_upload", "person"].includes(f.type)).map((f) => f.key));
    if (Object.keys(patch).some((k) => !writable.has(k))) return { ok: false, error: "Some of those answers cannot be changed here." };
    const r = await saveAnswers(ctx.actor, taskId, patch);
    if (r.errors.length) return { ok: false, error: r.errors[0]!.message };
    return { ok: true, message: "Saved" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not save your answers.") };
  }
}

export async function completeFillTask(token: string, taskId: string): Promise<FillResult> {
  try {
    const ctx = await taskContext(token, taskId);
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    const r = await completeTask(ctx.actor, taskId);
    if (!r.ok) return { ok: false, error: r.errors[0]?.message ?? "Some answers still need attention." };
    await markUsedIfFinished(ctx.actor);
    return { ok: true, message: "Thank you. Your section is complete." };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not complete this section.") };
  }
}

export async function addFillComment(token: string, taskId: string, form: FormData): Promise<FillResult> {
  try {
    const ctx = await taskContext(token, taskId);
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    const body = String(form.get("body") ?? "");
    const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0).slice(0, MAX_COMMENT_FILES);
    const r = await addComment(ctx.actor, { taskId, body, files });
    return { ok: true, id: r.commentId, message: "Comment added" };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not add the comment.") };
  }
}

/** 25 MB, same type and byte checks as the lead documents tab. The file must belong to a file upload field in the person's own section. */
export async function uploadFillFile(token: string, taskId: string, form: FormData): Promise<FillResult> {
  try {
    const ctx = await taskContext(token, taskId);
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    const fieldKey = String(form.get("fieldKey") ?? "");
    const field = ctx.fields.find((f) => f.key === fieldKey);
    if (!field || field.type !== "file_upload" || !field.visibleToExternal || field.readOnly || !findField(ctx.def, fieldKey)) return { ok: false, error: "That field does not accept files." };
    const file = form.get("file");
    if (!(file instanceof File)) return { ok: false, error: "Choose a file to upload." };

    const db = await getDb();
    const sub = await db.query.formSubmissions.findFirst({ where: and(eq(formSubmissions.id, ctx.actor.submissionId), eq(formSubmissions.orgId, ctx.actor.orgId)) });
    if (!sub) return { ok: false, error: NOT_ALLOWED };
    const held = Array.isArray(sub.answers[fieldKey]) ? (sub.answers[fieldKey] as unknown[]).filter((x): x is string => typeof x === "string") : [];

    const stored = await storeFormFile({ orgId: ctx.actor.orgId, submissionId: ctx.actor.submissionId, file, uploadedBy: null, externalPartyId: ctx.actor.partyId, field });
    try {
      const r = await saveAnswers(ctx.actor, taskId, { [fieldKey]: [...held, stored.documentId] });
      if (r.errors.length) throw new Error(r.errors[0]!.message);
    } catch (err) {
      await discardFormFile(ctx.actor.orgId, stored.documentId).catch(() => {});
      throw err;
    }
    return { ok: true, id: stored.documentId, message: `Uploaded ${stored.filename}` };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not upload the file.") };
  }
}
