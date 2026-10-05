"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { activities, documents, leads, properties, buyers } from "@dealcalc/db";
import { fileStorage } from "@dealcalc/integrations";
import { getDb } from "../db";
import { requireSession, requireCan } from "../auth";
import { audit } from "../audit";
import { friendlyError, isUuid } from "../safe";
import type { ActionResult } from "./leads";

const MAX_BYTES = 25 * 1024 * 1024;

const startsWith = (bytes: number[], at = 0) => (b: Buffer) => bytes.every((v, i) => b[at + i] === v);
const ascii = (text: string, at = 0) => startsWith(Array.from(text, (c) => c.charCodeAt(0)), at);
const looksLikeText = (b: Buffer) => !b.subarray(0, 4096).includes(0);
const isZip = startsWith([0x50, 0x4b, 0x03, 0x04]);

/**
 * The allow list, keyed by extension. `mime` is what gets stored; `accepts` is what a browser may report for that extension
 * (Windows reports a .csv as an Excel file). The browser's type is only a claim, so `magic` checks the first bytes as well.
 */
const FILE_TYPES: Record<string, { mime: string; accepts: string[]; magic: (b: Buffer) => boolean }> = {
  pdf: { mime: "application/pdf", accepts: ["application/pdf"], magic: (b) => b.subarray(0, 1024).includes("%PDF-") },
  png: { mime: "image/png", accepts: ["image/png"], magic: startsWith([0x89, 0x50, 0x4e, 0x47]) },
  jpg: { mime: "image/jpeg", accepts: ["image/jpeg"], magic: startsWith([0xff, 0xd8, 0xff]) },
  jpeg: { mime: "image/jpeg", accepts: ["image/jpeg"], magic: startsWith([0xff, 0xd8, 0xff]) },
  webp: { mime: "image/webp", accepts: ["image/webp"], magic: (b) => ascii("RIFF")(b) && ascii("WEBP", 8)(b) },
  heic: { mime: "image/heic", accepts: ["image/heic", "image/heif"], magic: ascii("ftyp", 4) },
  heif: { mime: "image/heif", accepts: ["image/heic", "image/heif"], magic: ascii("ftyp", 4) },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", accepts: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], magic: isZip },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", accepts: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], magic: isZip },
  csv: { mime: "text/csv", accepts: ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"], magic: looksLikeText },
  txt: { mime: "text/plain", accepts: ["text/plain"], magic: looksLikeText },
};
const ALLOWED_LABEL = "PDF, PNG, JPEG, WebP, HEIC, Word (.docx), Excel (.xlsx), CSV, or plain text";

/** Name used in the storage path: last path segment, ASCII letters, digits, dot, dash, underscore. Never starts with a dot. */
function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^[._-]+/, "");
  const dot = cleaned.lastIndexOf(".");
  const stem = (dot > 0 ? cleaned.slice(0, dot) : cleaned).slice(0, 100) || "file";
  const ext = dot > 0 ? cleaned.slice(dot).toLowerCase().slice(0, 12) : "";
  return `${stem}${ext}`;
}

export type DocTarget = "lead" | "property" | "buyer";

/** One row per document target: the entity check, the storage path prefix, and the activity/audit scope. */
async function resolveTarget(orgId: string, kind: DocTarget, id: string): Promise<{ ok: true; pathPrefix: string; leadId: string | null } | { ok: false; error: string }> {
  const db = await getDb();
  if (kind === "lead") {
    const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, id), eq(leads.orgId, orgId)) });
    if (!lead) return { ok: false, error: "Lead not found." };
    return { ok: true, pathPrefix: `${orgId}/leads/${id}`, leadId: id };
  }
  if (kind === "property") {
    const property = await db.query.properties.findFirst({ where: and(eq(properties.id, id), eq(properties.orgId, orgId)) });
    if (!property) return { ok: false, error: "Property not found." };
    // A property document also shows up on the lead's Documents tab (that query already unions on propertyId), so the timeline entry rides along.
    const lead = await db.query.leads.findFirst({ where: eq(leads.propertyId, id) });
    return { ok: true, pathPrefix: `${orgId}/properties/${id}`, leadId: lead?.id ?? null };
  }
  const buyer = await db.query.buyers.findFirst({ where: and(eq(buyers.id, id), eq(buyers.orgId, orgId)) });
  if (!buyer) return { ok: false, error: "Buyer not found." };
  return { ok: true, pathPrefix: `${orgId}/buyers/${id}`, leadId: null };
}

/** Upload a file onto a lead, a property, or a buyer. Property documents need lead:write (they travel with the deal); buyer documents need buyer:write. */
export async function uploadDocument(kind: DocTarget, targetId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  try {
    requireCan(session, kind === "buyer" ? "buyer:write" : "lead:write");
    if (!isUuid(targetId)) return { ok: false, error: "Not found." };
    const file = form.get("file");
    if (!(file instanceof File) || !file.name) return { ok: false, error: "Choose a file to upload." };
    if (file.size === 0) return { ok: false, error: "That file is empty." };
    if (file.size > MAX_BYTES) return { ok: false, error: "Files are limited to 25 MB." };
    const safeName = safeFilename(file.name);
    const rule = FILE_TYPES[safeName.split(".").pop() ?? ""];
    const claimed = file.type.toLowerCase();
    if (!rule || !safeName.includes(".") || (claimed && claimed !== "application/octet-stream" && !rule.accepts.includes(claimed))) return { ok: false, error: `That file type is not allowed. Upload a ${ALLOWED_LABEL} file.` };
    const target = await resolveTarget(session.orgId, kind, targetId);
    if (!target.ok) return target;
    const data = Buffer.from(await file.arrayBuffer());
    if (data.length !== file.size || data.length > MAX_BYTES) return { ok: false, error: "The upload did not arrive whole. Try again." };
    if (!rule.magic(data)) return { ok: false, error: "The file contents do not match its extension." };

    const filename = (file.name.split(/[\\/]/).pop() ?? "").replace(/\p{Cc}/gu, "").trim().slice(0, 200) || safeName;
    const storagePath = `${target.pathPrefix}/${crypto.randomUUID()}-${safeName}`;
    const storage = fileStorage();
    await storage.put(storagePath, data, rule.mime);
    let docId: string;
    const db = await getDb();
    try {
      const [doc] = await db.insert(documents).values({
        orgId: session.orgId, leadId: kind === "lead" ? targetId : null, propertyId: kind === "property" ? targetId : null, buyerId: kind === "buyer" ? targetId : null,
        storagePath, filename, mime: rule.mime, size: data.length, uploadedBy: session.profileId,
      }).returning();
      docId = doc!.id;
    } catch (err) {
      // No row means nothing points at the stored file, so take it back out.
      await storage.remove(storagePath).catch(() => {});
      throw err;
    }
    if (target.leadId) await db.insert(activities).values({ orgId: session.orgId, leadId: target.leadId, propertyId: kind === "property" ? targetId : null, actorId: session.profileId, type: "document", payload: { text: `Uploaded ${filename}`, filename, documentId: docId } });
    await audit(session, { entityType: "document", entityId: docId, action: "create", after: { kind, targetId, filename, mime: rule.mime, size: data.length } });
    if (kind === "lead") revalidatePath(`/leads/${targetId}`);
    if (kind === "property") { revalidatePath(`/properties/${targetId}/report`); if (target.leadId) revalidatePath(`/leads/${target.leadId}`); }
    if (kind === "buyer") revalidatePath(`/buyers/${targetId}`);
    return { ok: true, id: docId, message: `Uploaded ${filename}` };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not upload the file.") };
  }
}

/** Kept for the lead documents tab, which was written before property and buyer documents existed. */
export async function uploadLeadDocument(leadId: string, form: FormData): Promise<ActionResult> {
  return uploadDocument("lead", leadId, form);
}

/** The uploader or an admin. The file goes first: if storage fails the row stays, and the list still matches what is stored. */
export async function deleteDocument(documentId: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    if (!isUuid(documentId)) return { ok: false, error: "Document not found." };
    const db = await getDb();
    const doc = await db.query.documents.findFirst({ where: and(eq(documents.id, documentId), eq(documents.orgId, session.orgId)) });
    if (!doc) return { ok: false, error: "Document not found." };
    const allowed = session.role === "admin" || (session.role !== "viewer" && doc.uploadedBy === session.profileId);
    if (!allowed) return { ok: false, error: "Only the person who uploaded a document, or an admin, can delete it." };
    // The path prefix is checked again here because the storage client runs with the service role.
    if (!doc.storagePath.startsWith(`${session.orgId}/`)) return { ok: false, error: "Document not found." };
    await fileStorage().remove(doc.storagePath);
    await db.delete(documents).where(and(eq(documents.id, documentId), eq(documents.orgId, session.orgId)));
    if (doc.leadId) { await db.insert(activities).values({ orgId: session.orgId, leadId: doc.leadId, actorId: session.profileId, type: "document", payload: { text: `Deleted ${doc.filename}`, filename: doc.filename } }); revalidatePath(`/leads/${doc.leadId}`); }
    if (doc.propertyId) revalidatePath(`/properties/${doc.propertyId}/report`);
    if (doc.buyerId) revalidatePath(`/buyers/${doc.buyerId}`);
    await audit(session, { entityType: "document", entityId: documentId, action: "delete", before: { leadId: doc.leadId, propertyId: doc.propertyId, buyerId: doc.buyerId, filename: doc.filename, mime: doc.mime, size: doc.size, storagePath: doc.storagePath } });
    return { ok: true, message: `Deleted ${doc.filename}` };
  } catch (err) {
    return { ok: false, error: friendlyError(err, "Could not delete the document.") };
  }
}
