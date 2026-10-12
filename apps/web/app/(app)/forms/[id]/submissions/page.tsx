import Link from "next/link";
import { notFound } from "next/navigation";
import { parseDefinition, orderedSections, type FormDefinition } from "@dealcalc/forms";
import { requireSession, can } from "@/lib/auth";
import { isUuid } from "@/lib/safe";
import { getFormDetail, getSubmissionReport, getFormSummary } from "@/lib/data/forms";
import { listProfiles } from "@/lib/data/leads";
import type { SubmissionRow, SubmissionStatus, SubmissionReport } from "@/lib/forms/types";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Button, LinkButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { cn, shortDate } from "@/lib/utils";
import { ArrowUpDown, Download } from "lucide-react";
import { SummarySection } from "./summary";
import { StartSubmission } from "./start-submission";

export const metadata = { title: "Form submissions" };

const STATUS_VALUES = ["open", "draft", "in_progress", "waiting_approval", "sent_back", "completed", "archived"] as const;
const STATUS_TONE: Record<SubmissionStatus, BadgeTone> = { draft: "neutral", in_progress: "brand", waiting_approval: "info", sent_back: "warn", completed: "good", archived: "neutral" };
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

type Lookups = { choices: Map<string, Map<string, string>>; people: Map<string, string>; sectionTitles: Map<string, string> };

function buildLookups(def: FormDefinition | null, people: { id: string; fullName: string }[], report: SubmissionReport): Lookups {
  const choices = new Map<string, Map<string, string>>();
  const sectionTitles = new Map<string, string>(report.fields.map((f) => [f.sectionKey, f.sectionTitle]));
  if (def) {
    for (const s of orderedSections(def)) {
      sectionTitles.set(s.key, s.title);
      for (const f of s.fields) if (f.options.choices) choices.set(f.key, new Map(f.options.choices.map((c) => [c.value, c.label])));
    }
  }
  return { choices, people: new Map(people.map((p) => [p.id, p.fullName])), sectionTitles };
}

function formatCell(field: SubmissionReport["fields"][number], value: unknown, lk: Lookups): string {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) return "";
  const list = Array.isArray(value) ? value : [value];
  switch (field.type) {
    case "yes_no": return value === true ? "Yes" : value === false ? "No" : String(value);
    case "single_choice": case "multiple_choice": return list.map((v) => lk.choices.get(field.key)?.get(String(v)) ?? String(v)).join(", ");
    case "person": return list.map((v) => lk.people.get(String(v)) ?? "Unknown person").join(", ");
    case "file_upload": return `${list.length} ${list.length === 1 ? "file" : "files"}`;
    case "date": return typeof value === "string" ? (shortDate(value) || value) : String(value);
    default: return list.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");
  }
}

function currentSection(row: SubmissionRow, lk: Lookups): string {
  const open = row.tasks.find((t) => t.status === "open");
  if (open) return lk.sectionTitles.get(open.sectionKey) ?? open.sectionKey;
  return row.status === "completed" ? "Done" : "";
}

function sortValue(row: SubmissionRow, key: string, report: SubmissionReport, lk: Lookups): string | number {
  switch (key) {
    case "title": return (row.title ?? "").toLowerCase();
    case "subject": return (row.subjectLabel ?? "").toLowerCase();
    case "status": return row.status;
    case "started": return row.createdAt;
    case "due": return row.dueAt ?? "";
    case "section": return currentSection(row, lk).toLowerCase();
    default: {
      if (!key.startsWith("f:")) return row.createdAt;
      const field = report.fields.find((f) => f.key === key.slice(2));
      if (!field) return row.createdAt;
      const v = row.answers[field.key];
      if (field.type === "number" && typeof v === "number") return v;
      return formatCell(field, v, lk).toLowerCase();
    }
  }
}

export default async function FormSubmissionsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const status = (STATUS_VALUES as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof STATUS_VALUES)[number]) : "all";
  const [form, report, summary, team] = await Promise.all([
    getFormDetail(session.orgId, id),
    getSubmissionReport(session.orgId, id, { status, q: sp.q }),
    getFormSummary(session.orgId, id),
    listProfiles(session.orgId),
  ]);
  if (!form || !report) notFound();

  let def: FormDefinition | null = null;
  try { def = parseDefinition(form.publishedDefinition ?? form.draftDefinition ?? {}); } catch { def = null; }
  const lk = buildLookups(def, team, report);

  const sortKey = sp.sort ?? "started";
  const dir = sp.dir === "asc" ? "asc" : "desc";
  const rows = [...report.rows].sort((a, b) => {
    const x = sortValue(a, sortKey, report, lk), y = sortValue(b, sortKey, report, lk);
    const c = x < y ? -1 : x > y ? 1 : 0;
    return dir === "asc" ? c : -c;
  });

  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    const qs = p.toString();
    return `/forms/${id}/submissions${qs ? `?${qs}` : ""}`;
  };
  const sortLink = (key: string) => link({ sort: key, dir: sortKey === key && dir === "asc" ? "desc" : "asc" });
  const SortHead = ({ k, children, right }: { k: string; children: React.ReactNode; right?: boolean }) => (
    <TH right={right} aria-sort={sortKey === k ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={sortLink(k)} className={cn("inline-flex items-center gap-1 hover:text-fg", sortKey === k && "text-fg")}>{children}<ArrowUpDown className="h-3 w-3" /></Link>
    </TH>
  );

  const canStartHere = form.settings.subjectType === "none" && form.latestVersionNumber !== null && form.status === "published" && can(session, "form:fill");
  const filtered = Boolean(sp.q || sp.status);

  return (
    <>
      <PageHeader
        title={form.name}
        description={`${report.total} ${report.total === 1 ? "submission" : "submissions"}${report.form.versionNumber ? `, latest version v${report.form.versionNumber}` : ", not published yet"}`}
        crumbs={[{ label: "Forms", href: "/forms" }, { label: form.name }, { label: "Submissions" }]}
        actions={
          <>
            {canStartHere ? <StartSubmission formId={id} /> : null}
            {can(session, "form:build") && !form.archivedAt ? <LinkButton href={`/forms/${id}`} variant="outline">Open editor</LinkButton> : null}
            <LinkButton href={`/api/export/form_submissions?formId=${id}`} external variant="outline"><Download className="h-3.5 w-3.5" />Download CSV</LinkButton>
          </>
        }
      />

      <SummarySection summary={summary} />

      <form method="get" className="flex flex-wrap items-end gap-2 mb-3">
        {sp.sort ? <input type="hidden" name="sort" value={sp.sort} /> : null}
        {sp.dir ? <input type="hidden" name="dir" value={sp.dir} /> : null}
        <Input name="q" defaultValue={sp.q} placeholder="Search by submission title" aria-label="Search submissions" className="w-64" />
        <Select name="status" defaultValue={status === "all" ? "" : status} aria-label="Status" className="w-44">
          <option value="">All statuses</option>
          {STATUS_VALUES.map((s) => <option key={s} value={s}>{s === "open" ? "Open (not finished)" : titleCase(s)}</option>)}
        </Select>
        <Button type="submit" variant="outline">Apply</Button>
        {filtered ? <Link href={`/forms/${id}/submissions`} className="text-xs text-fg-3 hover:text-fg ml-1">Clear</Link> : null}
      </form>

      {rows.length === 0 ? (
        <EmptyState title={filtered ? "No submissions match" : "No submissions yet"} description={filtered ? "Try a different search or status." : "Submissions appear here once someone starts this form."} />
      ) : (
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <Table>
            <THead><tr>
              <SortHead k="title">Submission</SortHead>
              <SortHead k="subject">Subject</SortHead>
              <SortHead k="status">Status</SortHead>
              <SortHead k="started">Started</SortHead>
              <SortHead k="due">Due</SortHead>
              <SortHead k="section">Current section</SortHead>
              {report.fields.map((f) => <SortHead key={f.key} k={`f:${f.key}`} right={f.type === "number"}>{f.label}</SortHead>)}
            </tr></THead>
            <TBody>
              {rows.map((r) => {
                const open = r.tasks.find((t) => t.status === "open");
                const label = r.title ?? `Submission ${r.id.slice(0, 8)}`;
                return (
                  <TR key={r.id}>
                    <TD>
                      {open ? <Link href={`/forms/tasks/${open.taskId}`} className="font-medium hover:underline">{label}</Link> : <span className="font-medium">{label}</span>}
                      {r.editedAfterCompletion ? <div className="text-[11px] text-warn">Edited after completion</div> : null}
                    </TD>
                    <TD>{r.subjectLabel ? (r.leadId ? <Link href={`/leads/${r.leadId}`} className="hover:underline">{r.subjectLabel}</Link> : r.buyerId ? <Link href={`/buyers/${r.buyerId}`} className="hover:underline">{r.subjectLabel}</Link> : r.subjectLabel) : <span className="text-fg-3">None</span>}</TD>
                    <TD>
                      <div className="flex items-center gap-1">
                        <Badge tone={STATUS_TONE[r.status]}>{titleCase(r.status)}</Badge>
                        {r.health === "overdue" ? <Badge tone="bad">Overdue</Badge> : r.health === "due_soon" ? <Badge tone="warn">Due soon</Badge> : null}
                      </div>
                    </TD>
                    <TD>{shortDate(r.createdAt)}</TD>
                    <TD>{r.dueAt ? shortDate(r.dueAt) : <span className="text-fg-3">None</span>}</TD>
                    <TD>{currentSection(r, lk) || <span className="text-fg-3">None</span>}</TD>
                    {report.fields.map((f) => <TD key={f.key} right={f.type === "number"} className="max-w-[16rem] truncate">{formatCell(f, r.answers[f.key], lk)}</TD>)}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}
      {report.total > report.rows.length ? <p className="text-xs text-fg-3 mt-2">Showing the latest {report.rows.length} of {report.total} submissions. Download the CSV for all of them.</p> : null}
    </>
  );
}
