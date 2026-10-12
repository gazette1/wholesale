import { and, isNull, asc, eq } from "drizzle-orm";
import { formSubmissions, formTaskAssignees, formTasks, formVersions } from "@dealcalc/db";
import { parseDefinition } from "@dealcalc/forms";
import { getDb } from "../db";
import { isUuid } from "../safe";
import { loadTaskWindow } from "../services/forms";
import type { ExternalActor } from "./actor";
import { assertNoConfidentialData } from "./confidentiality";
import type { TaskStatus, TaskWindowData } from "./types";

export type FillTaskRow = { taskId: string; sectionTitle: string; status: TaskStatus };

/** Tasks assigned to this outside person, limited to their submission, their org, and their sections. Titles only. */
export async function listPartyTasks(actor: ExternalActor): Promise<FillTaskRow[]> {
  const db = await getDb();
  const rows = await db.select({ id: formTasks.id, sectionKey: formTasks.sectionKey, status: formTasks.status })
    .from(formTasks)
    .innerJoin(formTaskAssignees, and(eq(formTaskAssignees.taskId, formTasks.id), eq(formTaskAssignees.orgId, formTasks.orgId)))
    .where(and(
      eq(formTasks.orgId, actor.orgId), eq(formTasks.submissionId, actor.submissionId),
      eq(formTaskAssignees.orgId, actor.orgId), eq(formTaskAssignees.externalPartyId, actor.partyId),
      isNull(formTasks.archivedAt), isNull(formTaskAssignees.removedAt),
    ))
    .orderBy(asc(formTasks.createdAt));
  const mine = rows.filter((r) => actor.sectionKeys.includes(r.sectionKey));
  if (mine.length === 0) return [];

  const sub = await db.query.formSubmissions.findFirst({ where: and(eq(formSubmissions.id, actor.submissionId), eq(formSubmissions.orgId, actor.orgId)) });
  const version = sub ? await db.query.formVersions.findFirst({ where: and(eq(formVersions.id, sub.versionId), eq(formVersions.orgId, actor.orgId)) }) : null;
  const titles = new Map((version ? parseDefinition(version.definition).sections : []).map((s) => [s.key, s.title]));
  return mine.map((r) => ({ taskId: r.id, sectionTitle: titles.get(r.sectionKey) ?? "Section", status: r.status }));
}

/** Resolves the selected task among the party's own tasks (or the first open one) and loads its window. */
export async function loadFillWindow(actor: ExternalActor, tasks: FillTaskRow[], requested: string | undefined): Promise<{ selectedId: string | null; data: TaskWindowData | null }> {
  const wanted = requested && isUuid(requested) ? tasks.find((t) => t.taskId === requested) : undefined;
  const chosen = wanted ?? tasks.find((t) => t.status === "open") ?? tasks[0];
  if (!chosen) return { selectedId: null, data: null };
  const data = await loadTaskWindow(actor, chosen.taskId);
  if (!data) return { selectedId: chosen.taskId, data: null };
  checkClientPayload(data);
  return { selectedId: chosen.taskId, data };
}

/** Everything serialized to the browser for a buyer subject goes through the confidentiality scan. */
export function checkClientPayload(data: TaskWindowData): void {
  if (data.submission.subjectType === "buyer") assertNoConfidentialData(data);
}
