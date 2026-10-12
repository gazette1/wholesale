"use server";
import { revalidatePath } from "next/cache";
import { requireSession, requireCan } from "../auth";
import { friendlyError, isUuid } from "../safe";
import { actorFromSession } from "../forms/actor";
import { discardFormFile, storeFormFile } from "../services/form-files";
import { loadTaskWindow, saveAnswers } from "../services/forms";
import type { ActionResult } from "./leads";

/**
 * Upload one file into a file upload field of a task the signed in person may edit.
 * Form data: file. The field key is passed separately. The document id is appended to the field's answer.
 */
export async function uploadFormFile(taskId: string, fieldKey: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!isUuid(taskId)) return { ok: false, error: "Task not found." };
  try {
    requireCan(session, "form:fill");
    const actor = actorFromSession(session);
    const data = await loadTaskWindow(actor, taskId);
    if (!data) return { ok: false, error: "Task not found." };
    if (!data.permissions.canEdit) return { ok: false, error: "You cannot add files to this section." };
    const field = data.section.fields.find((f) => f.key === String(fieldKey));
    if (!field || field.type !== "file_upload" || field.readOnly) return { ok: false, error: "That field does not accept files." };
    if (data.evaluation.fieldVisible[field.key] === false) return { ok: false, error: "That field does not accept files." };
    const file = form.get("file");
    if (!(file instanceof File)) return { ok: false, error: "Choose a file to upload." };

    const held = Array.isArray(data.answers[field.key]) ? (data.answers[field.key] as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const stored = await storeFormFile({ orgId: session.orgId, submissionId: data.submission.id, file, uploadedBy: session.profileId, field });
    try {
      const res = await saveAnswers(actor, taskId, { [field.key]: [...held, stored.documentId] });
      if (res.errors.length) throw new Error(res.errors[0]!.message);
    } catch (err) {
      await discardFormFile(session.orgId, stored.documentId).catch(() => {});
      throw err;
    }
    revalidatePath(`/forms/tasks/${taskId}`);
    return { ok: true, id: stored.documentId, message: `Uploaded ${stored.filename}` };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not upload the file.") };
  }
}
