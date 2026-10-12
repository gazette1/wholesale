import { and, eq } from "drizzle-orm";
import { documents, formSubmissions } from "@dealcalc/db";
import { fileStorage } from "@dealcalc/integrations";
import type { FieldDef } from "@dealcalc/forms";
import { getDb } from "../db";
import { isUuid } from "../safe";
import { checkUploadFile, checkUploadBytes, displayFilename } from "../upload-checks";

/**
 * Store one file against a form submission. Same type, magic byte, and size checks as the lead documents tab.
 * The file path carries the external party id when an outside person uploaded it, so a purge can find it later.
 * Throws an Error with a plain message when a check fails; callers turn that into an ActionResult.
 */
export async function storeFormFile(input: { orgId: string; submissionId: string; file: File; uploadedBy: string | null; externalPartyId?: string | null; field?: FieldDef }): Promise<{ documentId: string; filename: string }> {
  const { orgId, submissionId, uploadedBy } = input;
  if (!isUuid(orgId) || !isUuid(submissionId)) throw new Error("Submission not found.");
  const checked = checkUploadFile(input.file);
  if (!checked.ok) throw new Error(checked.error);
  const { file, safeName, rule } = checked;

  const db = await getDb();
  const submission = await db.query.formSubmissions.findFirst({ where: and(eq(formSubmissions.id, submissionId), eq(formSubmissions.orgId, orgId)) });
  if (!submission) throw new Error("Submission not found.");

  const field = input.field;
  if (field) {
    const o = field.options;
    if (field.type !== "file_upload") throw new Error("That field does not accept files.");
    if (o.allowedTypes && o.allowedTypes.length > 0 && !o.allowedTypes.includes(rule.mime)) throw new Error("That file type is not accepted for this field.");
    const limitMb = Math.min(o.maxSizeMb ?? 25, 25);
    if (file.size > limitMb * 1024 * 1024) throw new Error(`Files for this field are limited to ${limitMb} MB.`);
    const held = submission.answers[field.key];
    if (o.maxFiles !== undefined && Array.isArray(held) && held.length >= o.maxFiles) throw new Error(`This field allows no more than ${o.maxFiles} file${o.maxFiles === 1 ? "" : "s"}.`);
  }

  const data = Buffer.from(await file.arrayBuffer());
  const bytes = checkUploadBytes(data, file.size, rule);
  if (!bytes.ok) throw new Error(bytes.error);

  const filename = displayFilename(file.name, safeName);
  const owner = input.externalPartyId && isUuid(input.externalPartyId) ? `ext-${input.externalPartyId}/` : "";
  const storagePath = `${orgId}/forms/${submissionId}/${owner}${crypto.randomUUID()}-${safeName}`;
  const storage = fileStorage();
  await storage.put(storagePath, data, rule.mime);
  try {
    const [doc] = await db.insert(documents).values({
      orgId, leadId: submission.leadId, buyerId: submission.buyerId, submissionId,
      storagePath, filename, mime: rule.mime, size: data.length, uploadedBy,
    }).returning();
    return { documentId: doc!.id, filename };
  } catch (err) {
    // No row means nothing points at the stored file, so take it back out.
    await storage.remove(storagePath).catch(() => {});
    throw err;
  }
}

/** Remove a stored form file and its row. Used when a step after the upload fails. */
export async function discardFormFile(orgId: string, documentId: string): Promise<void> {
  const db = await getDb();
  const doc = await db.query.documents.findFirst({ where: and(eq(documents.id, documentId), eq(documents.orgId, orgId)) });
  if (!doc || !doc.storagePath.startsWith(`${orgId}/forms/`)) return;
  await fileStorage().remove(doc.storagePath).catch(() => {});
  await db.delete(documents).where(and(eq(documents.id, documentId), eq(documents.orgId, orgId)));
}
