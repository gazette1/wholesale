import { describe, it, expect, beforeAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { parseDefinition } from "@dealcalc/forms";
import { createPgliteDb } from "../src/client";
import { migrate } from "../src/migrate";
import { seed } from "../src/seed";
import { bootstrap } from "../src/seed/bootstrap";
import {
  forms, formVersions, formSubmissions, formTasks, formTaskAssignees, formExternalParties,
  formComments, formEvents, formPurgeRequests, profiles, documents, alerts,
} from "../src/schema";

const db = createPgliteDb();

describe("workflow forms tables", () => {
  let result: Awaited<ReturnType<typeof seed>>;
  beforeAll(async () => {
    await migrate(db);
    result = await seed(db, { seed: 7 });
  }, 120_000);

  it("seeds the three templates as published version 1 forms", async () => {
    expect(result.formIds.length).toBe(3);
    const rows = await db.select().from(forms).where(eq(forms.orgId, result.orgId));
    expect(rows.map((f) => f.templateSlug).sort()).toEqual(["contractor_bid", "property_walkthrough", "seller_intake"]);
    for (const f of rows) {
      expect(f.status).toBe("published");
      expect(f.latestVersionId).not.toBeNull();
      const [v] = await db.select().from(formVersions).where(eq(formVersions.id, f.latestVersionId!));
      expect(v!.number).toBe(1);
      expect(parseDefinition(v!.definition).sections.length).toBeGreaterThan(0);
    }
  });

  it("gives admins the form admin capability and everyone email notices by default", async () => {
    const team = await db.select().from(profiles).where(eq(profiles.orgId, result.orgId));
    expect(team.find((p) => p.role === "admin")!.isFormAdmin).toBe(true);
    expect(team.find((p) => p.role === "acquisitions")!.isFormAdmin).toBe(false);
    expect(team.every((p) => p.notifyBy === "email")).toBe(true);
  });

  it("stores a submission with tasks, assignees, an invite, a comment, events, a file, and an alert", async () => {
    const [form] = await db.select().from(forms).where(and(eq(forms.orgId, result.orgId), eq(forms.templateSlug, "contractor_bid")));
    const orgId = result.orgId;
    const leadId = result.leadIds[0]!;
    const [sub] = await db.insert(formSubmissions).values({
      orgId, formId: form!.id, versionId: form!.latestVersionId!, subjectType: "lead", leadId, answers: { scope_summary: "Roof and kitchen" }, startedBy: result.profileIds.admin,
    }).returning();
    expect(sub!.status).toBe("in_progress");
    expect(sub!.editedAfterCompletion).toBe(false);
    const [task] = await db.insert(formTasks).values({ orgId, submissionId: sub!.id, sectionKey: "bid", roleKey: "contractor", status: "open", completionRule: "minimum", minimumCount: 1 }).returning();
    const [party] = await db.insert(formExternalParties).values({ orgId, formId: form!.id, submissionId: sub!.id, email: "bids@example.com", sectionKeys: ["bid"], tokenHash: "a".repeat(64), singleUse: true }).returning();
    await db.insert(formTaskAssignees).values([{ orgId, taskId: task!.id, externalPartyId: party!.id }, { orgId, taskId: task!.id, profileId: result.profileIds.acquisitions }]);
    await db.insert(formComments).values({ orgId, submissionId: sub!.id, taskId: task!.id, authorExternalPartyId: party!.id, body: "Bid attached" });
    await db.insert(formEvents).values({ orgId, formId: form!.id, submissionId: sub!.id, taskId: task!.id, actorExternalPartyId: party!.id, actorLabel: "bids@example.com", kind: "answer_changed", fieldKey: "bid_amount", before: null, after: 18000 });
    const [doc] = await db.insert(documents).values({ orgId, leadId, submissionId: sub!.id, storagePath: `${orgId}/x/bid.pdf`, filename: "bid.pdf", mime: "application/pdf", size: 10 }).returning();
    expect(doc!.submissionId).toBe(sub!.id);
    await db.insert(alerts).values({ orgId, kind: "form_overdue", title: "Contractor bid is overdue", dedupeKey: `form_overdue:${task!.id}`, formTaskId: task!.id, leadId });
    const assignees = await db.select().from(formTaskAssignees).where(eq(formTaskAssignees.taskId, task!.id));
    expect(assignees.length).toBe(2);
    const events = await db.select().from(formEvents).where(eq(formEvents.submissionId, sub!.id));
    expect(events[0]!.after).toBe(18000);
  });

  it("allows one task per section per submission and one row per token", async () => {
    const [form] = await db.select().from(forms).where(eq(forms.orgId, result.orgId)).limit(1);
    const [sub] = await db.insert(formSubmissions).values({ orgId: result.orgId, formId: form!.id, versionId: form!.latestVersionId! }).returning();
    await db.insert(formTasks).values({ orgId: result.orgId, submissionId: sub!.id, sectionKey: "one" });
    await expect(db.insert(formTasks).values({ orgId: result.orgId, submissionId: sub!.id, sectionKey: "one" })).rejects.toThrow();
    await expect(db.insert(formExternalParties).values({ orgId: result.orgId, formId: form!.id, tokenHash: "a".repeat(64) })).rejects.toThrow();
  });

  it("records a purge request without purged data", async () => {
    const [row] = await db.insert(formPurgeRequests).values({ orgId: result.orgId, targetType: "external_party", targetId: result.profileIds.admin!, requestReference: "REQ-1", requestedBy: result.profileIds.admin! }).returning();
    expect(row!.status).toBe("pending");
    expect(row!.approvedBy).toBeNull();
  });
});

describe("bootstrap seeds the form templates", () => {
  it("creates three published forms owned by the first admin", async () => {
    const fresh = createPgliteDb();
    await migrate(fresh);
    const out = await bootstrap(fresh, { orgName: "Test", team: [{ fullName: "A", email: "a@example.com", role: "admin" }, { fullName: "B", email: "b@example.com", role: "acquisitions" }] });
    expect(out.formIds.length).toBe(3);
    const rows = await fresh.select().from(forms);
    expect(rows.every((f) => f.status === "published" && f.ownerId === out.profileIds[0])).toBe(true);
    const team = await fresh.select().from(profiles);
    expect(team.filter((p) => p.isFormAdmin).map((p) => p.email)).toEqual(["a@example.com"]);
  }, 120_000);
});
