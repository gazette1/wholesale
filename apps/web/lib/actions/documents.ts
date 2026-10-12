"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { activities, documents, leads, properties, buyers } from "@dealcalc/db";
import { fileStorage } from "@dealcalc/integrations";
import { getDb } from "../db";
import { requireSession, requireCan } from "../auth";
import { audit } from "../audit";
import { friendlyError, isUuid } from "../safe";
import { checkUploadFile, checkUploadBytes, displayFilename } from "../upload-checks";
import type { ActionResult } from "./leads";

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
    const checked = checkUploadFile(form.get("file"));
    if (!checked.ok) return checked;
    const { file, safeName, rule } = checked;
    const target = await resolveTarget(session.orgId, kind, targetId);
    if (!target.ok) return target;
    const data = Buffer.from(await file.arrayBuffer());
    const bytes = checkUploadBytes(data, file.size, rule);
    if (!bytes.ok) return bytes;

    const filename = displayFilename(file.name, safeName);
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
