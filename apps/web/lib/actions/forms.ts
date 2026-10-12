"use server";
import { revalidatePath } from "next/cache";
import type { DefinitionError, FieldError, FormSettings } from "@dealcalc/forms";
import { requireSession, requireCan, type Session } from "../auth";
import { audit } from "../audit";
import { friendlyError, isUuid } from "../safe";
import { actorFromSession } from "../forms/actor";
import {
  createForm, duplicateForm, saveDraftDefinition, updateFormDetails, archiveForm, restoreForm, publishForm, startSubmission,
  saveAnswers, completeTask, approveTask, rejectTask, sendBackTask, reassignTask, snoozeTask, archiveSubmission, restoreSubmission, addComment,
  type CreateFormInput, type StartSubmissionInput,
} from "../services/forms";
import { createInvite, createPublicLink, revokeParty, requestPurge, approvePurge, cancelPurge } from "../services/form-access";
import { markTaskSeen } from "../data/forms";
import type { SubmissionStatus } from "../forms/types";
import type { ActionResult } from "./leads";

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

/** Pages that show form state. Dynamic segments are revalidated as a group because the lead or buyer is not known here. */
function touch(opts: { formId?: string; taskId?: string } = {}): void {
  revalidatePath("/forms");
  if (opts.formId) revalidatePath(`/forms/${opts.formId}`);
  if (opts.taskId) revalidatePath(`/forms/tasks/${opts.taskId}`);
  revalidatePath("/forms/tasks/[id]", "page");
  revalidatePath("/leads/[id]", "page");
  revalidatePath("/buyers/[id]", "page");
  revalidatePath("/tasks");
}

async function guard<T>(session: Session, action: "form:build" | "form:fill" | "admin", fallback: string, fn: () => Promise<T>): Promise<T | Fail> {
  try {
    if (action === "admin") { if (session.role !== "admin") return fail("Only admins can do this."); }
    else requireCan(session, action);
    return await fn();
  } catch (err) {
    return fail(friendlyError(err, fallback));
  }
}

/* ------------------------------- building ------------------------------- */

export async function createFormAction(input: CreateFormInput): Promise<ActionResult> {
  const session = await requireSession();
  const res = await guard(session, "form:build", "Could not create the form.", async () => {
    const { id } = await createForm(actorFromSession(session), input);
    await audit(session, { entityType: "form", entityId: id, action: "create", after: { name: input.name, from: input.from?.kind ?? "blank" } });
    touch({ formId: id });
    return { ok: true as const, id };
  });
  return res;
}

export async function duplicateFormAction(formId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!isUuid(formId)) return fail("Form not found.");
  return guard(session, "form:build", "Could not duplicate the form.", async () => {
    const { id } = await duplicateForm(actorFromSession(session), formId);
    await audit(session, { entityType: "form", entityId: id, action: "duplicate", after: { sourceId: formId } });
    touch({ formId: id });
    return { ok: true as const, id };
  });
}

export async function saveFormDraftDefinition(formId: string, definition: unknown): Promise<ActionResult & { errors?: DefinitionError[] }> {
  const session = await requireSession();
  if (!isUuid(formId)) return fail("Form not found.");
  return guard(session, "form:build", "Could not save the draft.", async () => {
    const { errors } = await saveDraftDefinition(actorFromSession(session), formId, definition);
    revalidatePath(`/forms/${formId}`);
    return { ok: true as const, errors };
  });
}

export async function updateFormDetailsAction(formId: string, patch: {
  name?: string; category?: string | null; description?: string | null; ownerId?: string | null; settings?: Partial<FormSettings>;
}): Promise<ActionResult> {
  const session = await requireSession();
  if (!isUuid(formId)) return fail("Form not found.");
  return guard(session, "form:build", "Could not save the form details.", async () => {
    await updateFormDetails(actorFromSession(session), formId, patch);
    await audit(session, { entityType: "form", entityId: formId, action: "update_details", after: patch });
    touch({ formId });
    return { ok: true as const };
  });
}

export async function archiveFormAction(formId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!isUuid(formId)) return fail("Form not found.");
  return guard(session, "form:build", "Could not archive the form.", async () => {
    await archiveForm(actorFromSession(session), formId);
    await audit(session, { entityType: "form", entityId: formId, action: "archive" });
    touch({ formId });
    return { ok: true as const };
  });
}

export async function restoreFormAction(formId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!isUuid(formId)) return fail("Form not found.");
  return guard(session, "form:build", "Could not restore the form.", async () => {
    await restoreForm(actorFromSession(session), formId);
    await audit(session, { entityType: "form", entityId: formId, action: "restore" });
    touch({ formId });
    return { ok: true as const };
  });
}

export async function publishFormAction(formId: string): Promise<ActionResult & { errors?: DefinitionError[]; versionNumber?: number; migrated?: number }> {
  const session = await requireSession();
  if (!isUuid(formId)) return fail("Form not found.");
  return guard(session, "form:build", "Could not publish the form.", async () => {
    const res = await publishForm(actorFromSession(session), formId);
    if (!res.ok) return { ok: false as const, error: "Fix the problems in the form before publishing.", errors: res.errors };
    await audit(session, { entityType: "form", entityId: formId, action: "publish", after: { version: res.versionNumber, migrated: res.migrated } });
    touch({ formId });
    return { ok: true as const, message: `Published version ${res.versionNumber}.`, versionNumber: res.versionNumber, migrated: res.migrated };
  });
}

/* ------------------------------- submissions ------------------------------- */

export async function startFormSubmission(input: StartSubmissionInput): Promise<ActionResult & { taskId?: string }> {
  const session = await requireSession();
  if (!isUuid(input?.formId)) return fail("Form not found.");
  return guard(session, "form:fill", "Could not start the form.", async () => {
    const res = await startSubmission(actorFromSession(session), input);
    touch({ formId: input.formId });
    return { ok: true as const, id: res.id, taskId: res.firstTaskIds[0] };
  });
}

/** Autosave. Partial drafts are saved even when some fields have errors; the errors are returned for display. */
export async function saveFormAnswers(taskId: string, patch: Record<string, unknown>): Promise<ActionResult & { errors?: FieldError[]; evaluation?: Awaited<ReturnType<typeof saveAnswers>>["evaluation"] }> {
  const session = await requireSession();
  if (!isUuid(taskId)) return fail("Task not found.");
  return guard(session, "form:fill", "Could not save your answers.", async () => {
    const res = await saveAnswers(actorFromSession(session), taskId, patch);
    revalidatePath(`/forms/tasks/${taskId}`);
    return { ok: true as const, errors: res.errors, evaluation: res.evaluation };
  });
}

export async function completeFormTask(taskId: string): Promise<ActionResult & { errors?: FieldError[]; submissionStatus?: SubmissionStatus }> {
  const session = await requireSession();
  if (!isUuid(taskId)) return fail("Task not found.");
  return guard(session, "form:fill", "Could not complete the section.", async () => {
    const res = await completeTask(actorFromSession(session), taskId);
    touch({ taskId });
    if (!res.ok) return { ok: false as const, error: "Fix the marked fields before completing this section.", errors: res.errors };
    return { ok: true as const, message: res.taskCompleted ? "Section completed." : "Your part is done. Waiting for the other assignees.", submissionStatus: res.submissionStatus };
  });
}

export async function approveFormTask(taskId: string, comment?: string): Promise<ActionResult & { errors?: FieldError[] }> {
  const session = await requireSession();
  if (!isUuid(taskId)) return fail("Task not found.");
  return guard(session, "form:fill", "Could not approve.", async () => {
    const res = await approveTask(actorFromSession(session), taskId, comment);
    touch({ taskId });
    if (!res.ok) return { ok: false as const, error: "Fix the marked fields before approving.", errors: res.errors };
    return { ok: true as const, message: res.taskCompleted ? "Approved." : "Your approval is recorded. Waiting for the other approvers." };
  });
}

export async function rejectFormTask(taskId: string, comment?: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!isUuid(taskId)) return fail("Task not found.");
  return guard(session, "form:fill", "Could not reject.", async () => {
    await rejectTask(actorFromSession(session), taskId, comment);
    touch({ taskId });
    return { ok: true as const, message: "Rejected." };
  });
}

export async function sendBackFormTask(taskId: string, toSectionKey: string, comment: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!isUuid(taskId)) return fail("Task not found.");
  if (typeof toSectionKey !== "string" || !toSectionKey) return fail("Choose a section to send this back to.");
  return guard(session, "form:fill", "Could not send this back.", async () => {
    await sendBackTask(actorFromSession(session), taskId, toSectionKey, comment ?? "");
    touch({ taskId });
    return { ok: true as const, message: "Sent back." };
  });
}

export async function reassignFormTask(taskId: string, profileIds: string[], mode: "replace" | "add" = "replace"): Promise<ActionResult> {
  const session = await requireSession();
  if (!isUuid(taskId)) return fail("Task not found.");
  if (!Array.isArray(profileIds) || profileIds.length > 50 || !profileIds.every(isUuid)) return fail("Choose team members from the list.");
  return guard(session, "form:fill", "Could not reassign the section.", async () => {
    await reassignTask(actorFromSession(session), taskId, profileIds, mode === "add" ? "add" : "replace");
    touch({ taskId });
    return { ok: true as const, message: "Reassigned." };
  });
}

/** until is an ISO date time, or null to end a snooze. */
export async function snoozeFormTask(taskId: string, until: string | null): Promise<ActionResult> {
  const session = await requireSession();
  if (!isUuid(taskId)) return fail("Task not found.");
  const when = until ? new Date(until) : null;
  if (when && Number.isNaN(when.getTime())) return fail("Choose a valid snooze date.");
  return guard(session, "form:fill", "Could not snooze the section.", async () => {
    await snoozeTask(actorFromSession(session), taskId, when);
    touch({ taskId });
    return { ok: true as const, message: when ? "Snoozed." : "Snooze ended." };
  });
}

export async function archiveFormSubmission(submissionId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!isUuid(submissionId)) return fail("Submission not found.");
  return guard(session, "form:fill", "Could not archive the submission.", async () => {
    await archiveSubmission(actorFromSession(session), submissionId);
    touch();
    return { ok: true as const };
  });
}

export async function restoreFormSubmission(submissionId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!isUuid(submissionId)) return fail("Submission not found.");
  return guard(session, "form:fill", "Could not restore the submission.", async () => {
    await restoreSubmission(actorFromSession(session), submissionId);
    touch();
    return { ok: true as const };
  });
}

/** Form fields: taskId, body, mentionIds (repeatable), files (repeatable). */
export async function addFormComment(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const taskId = String(form.get("taskId") ?? "");
  if (!isUuid(taskId)) return fail("Task not found.");
  const mentionIds = form.getAll("mentionIds").map(String).filter(isUuid);
  const files = form.getAll("files").filter((f): f is File => typeof f !== "string" && f.size > 0);
  return guard(session, "form:fill", "Could not post the comment.", async () => {
    await addComment(actorFromSession(session), { taskId, body: String(form.get("body") ?? ""), files, mentionIds });
    revalidatePath(`/forms/tasks/${taskId}`);
    return { ok: true as const, message: "Comment posted." };
  });
}

export async function markFormTaskSeen(taskId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!isUuid(taskId)) return fail("Task not found.");
  try {
    await markTaskSeen(actorFromSession(session), taskId);
    revalidatePath("/tasks");
    return { ok: true };
  } catch (err) {
    return fail(friendlyError(err, "Could not update the task."));
  }
}

/* --------------------------- external access and purge --------------------------- */

export async function inviteFormParty(input: {
  submissionId: string; sectionKeys: string[]; name?: string; email?: string; phone?: string; contactId?: string; buyerId?: string; expiresInDays?: number; singleUse?: boolean;
}): Promise<ActionResult & { url?: string; partyId?: string }> {
  const session = await requireSession();
  if (!isUuid(input?.submissionId)) return fail("Submission not found.");
  if (!Array.isArray(input.sectionKeys) || !input.sectionKeys.length || input.sectionKeys.length > 50 || !input.sectionKeys.every((k) => typeof k === "string" && k.length <= 64)) return fail("Choose the sections to share.");
  if (input.contactId && !isUuid(input.contactId)) return fail("Contact not found.");
  if (input.buyerId && !isUuid(input.buyerId)) return fail("Buyer not found.");
  if (!input.email?.trim() && !input.phone?.trim()) return fail("Enter an email address or a mobile number so the person can verify.");
  return guard(session, "form:fill", "Could not create the invite.", async () => {
    const res = await createInvite(actorFromSession(session), input);
    touch();
    return { ok: true as const, url: res.url, partyId: res.partyId };
  });
}

export async function createFormPublicLink(formId: string, expiresInDays?: number): Promise<ActionResult & { url?: string; partyId?: string }> {
  const session = await requireSession();
  if (!isUuid(formId)) return fail("Form not found.");
  return guard(session, "form:build", "Could not create the public link.", async () => {
    const res = await createPublicLink(actorFromSession(session), { formId, expiresInDays });
    await audit(session, { entityType: "form", entityId: formId, action: "create_public_link", after: { partyId: res.partyId } });
    touch({ formId });
    return { ok: true as const, url: res.url, partyId: res.partyId };
  });
}

export async function revokeFormParty(partyId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!isUuid(partyId)) return fail("Link not found.");
  return guard(session, "form:fill", "Could not revoke the link.", async () => {
    await revokeParty(actorFromSession(session), partyId);
    touch();
    return { ok: true as const, message: "Link revoked." };
  });
}

export async function requestFormPurge(input: { targetType: "external_party" | "contact" | "buyer"; targetId: string; requestReference: string }): Promise<ActionResult> {
  const session = await requireSession();
  if (!["external_party", "contact", "buyer"].includes(input?.targetType) || !isUuid(input.targetId)) return fail("Choose the person whose data should be removed.");
  const reference = String(input.requestReference ?? "").trim();
  if (!reference || reference.length > 200) return fail("Enter the request reference.");
  return guard(session, "admin", "Could not record the purge request.", async () => {
    const res = await requestPurge(actorFromSession(session), { ...input, requestReference: reference });
    await audit(session, { entityType: "form_purge", entityId: res.requestId, action: "request", after: { targetType: input.targetType, targetId: input.targetId } });
    return { ok: true as const, id: res.requestId, message: "Purge requested. A second admin must approve it." };
  });
}

export async function approveFormPurge(requestId: string): Promise<ActionResult & { summary?: Record<string, number> }> {
  const session = await requireSession();
  if (!isUuid(requestId)) return fail("Request not found.");
  return guard(session, "admin", "Could not run the purge.", async () => {
    const res = await approvePurge(actorFromSession(session), requestId);
    await audit(session, { entityType: "form_purge", entityId: requestId, action: "approve", after: res.summary });
    touch();
    return { ok: true as const, summary: res.summary, message: "Purge completed." };
  });
}

export async function cancelFormPurge(requestId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!isUuid(requestId)) return fail("Request not found.");
  return guard(session, "admin", "Could not cancel the request.", async () => {
    await cancelPurge(actorFromSession(session), requestId);
    await audit(session, { entityType: "form_purge", entityId: requestId, action: "cancel" });
    return { ok: true as const, message: "Purge request cancelled." };
  });
}
