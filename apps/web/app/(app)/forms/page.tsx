import Link from "next/link";
import { FORM_TEMPLATES } from "@dealcalc/forms";
import { requireSession, can } from "@/lib/auth";
import { listFormLibrary, listFormCategories } from "@/lib/data/forms";
import { listProfiles } from "@/lib/data/leads";
import type { FormStatus } from "@/lib/forms/types";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Button, LinkButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { relative } from "@/lib/utils";
import { NewFormPanel } from "./new-form";
import { FormRowActions } from "./row-actions";

export const metadata = { title: "Forms" };

const STATUS_TONE: Record<FormStatus, BadgeTone> = { draft: "neutral", published: "good", archived: "warn" };
const STATUSES = ["draft", "published", "archived"] as const;

export default async function FormsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const canBuild = can(session, "form:build");
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as FormStatus) : "all";
  const [rows, categories, team, all] = await Promise.all([
    listFormLibrary(session.orgId, { q: sp.q, category: sp.category || undefined, ownerId: sp.owner || undefined, status }),
    listFormCategories(session.orgId),
    listProfiles(session.orgId),
    canBuild ? listFormLibrary(session.orgId, { status: "all" }) : Promise.resolve([]),
  ]);
  const filtered = Boolean(sp.q || sp.category || sp.owner || sp.status);

  return (
    <>
      <PageHeader title="Forms" description={`${rows.length} ${rows.length === 1 ? "form" : "forms"}`} />
      {canBuild ? (
        <div className="flex flex-wrap items-start gap-2 mb-3">
          <NewFormPanel forms={all.map((f) => ({ id: f.id, name: f.name }))} templates={FORM_TEMPLATES.map((t) => ({ slug: t.slug, name: t.name }))} />
        </div>
      ) : null}
      <form method="get" className="flex flex-wrap items-end gap-2 mb-3">
        <Input name="q" defaultValue={sp.q} placeholder="Search by name" aria-label="Search forms" className="w-60" />
        <Select name="category" defaultValue={sp.category ?? ""} aria-label="Category" className="w-44"><option value="">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        <Select name="owner" defaultValue={sp.owner ?? ""} aria-label="Owner" className="w-44"><option value="">Any owner</option>{team.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</Select>
        <Select name="status" defaultValue={status === "all" ? "" : status} aria-label="Status" className="w-40"><option value="">Active forms</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></Select>
        <Button type="submit" variant="outline">Apply</Button>
        {filtered ? <Link href="/forms" className="text-xs text-fg-3 hover:text-fg ml-1">Clear</Link> : null}
      </form>
      {rows.length === 0 ? (
        <EmptyState title={filtered ? "No forms match" : "No forms yet"} description={filtered ? "Try a different search or filter." : canBuild ? "Create a form from a template or start blank." : "A form admin has not created any forms yet."} />
      ) : (
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <Table>
            <THead><tr>
              <TH>Name</TH><TH>Category</TH><TH>Owner</TH><TH>Status</TH><TH>Latest version</TH><TH right>Open</TH><TH right>Overdue</TH><TH>Last used</TH><TH><span className="sr-only">Actions</span></TH>
            </tr></THead>
            <TBody>
              {rows.map((f) => (
                <TR key={f.id}>
                  <TD>
                    <Link href={canBuild ? `/forms/${f.id}` : `/forms/${f.id}/submissions`} className="font-medium text-fg hover:underline">{f.name}</Link>
                    {f.description ? <div className="text-xs text-fg-3 truncate max-w-xs">{f.description}</div> : null}
                  </TD>
                  <TD>{f.category ?? <span className="text-fg-3">None</span>}</TD>
                  <TD>{f.ownerName ?? <span className="text-fg-3">None</span>}</TD>
                  <TD><Badge tone={STATUS_TONE[f.status]}>{f.status.charAt(0).toUpperCase() + f.status.slice(1)}</Badge></TD>
                  <TD>{f.latestVersionNumber ? `v${f.latestVersionNumber}` : <span className="text-fg-3">Not published</span>}</TD>
                  <TD right>{f.openCount}</TD>
                  <TD right>{f.overdueCount > 0 ? <span className="text-bad font-medium">{f.overdueCount}</span> : f.overdueCount}</TD>
                  <TD>{f.lastUsedAt ? relative(f.lastUsedAt) : <span className="text-fg-3">Never</span>}</TD>
                  <TD>
                    <div className="flex items-start justify-end gap-1.5 whitespace-nowrap">
                      <LinkButton href={`/forms/${f.id}/submissions`} variant="outline" size="sm"><span aria-hidden="true">Submissions</span><span className="sr-only">Submissions for {f.name}</span></LinkButton>
                      {canBuild && !f.archivedAt ? <LinkButton href={`/forms/${f.id}`} variant="outline" size="sm"><span aria-hidden="true">Edit</span><span className="sr-only">Edit {f.name}</span></LinkButton> : null}
                      {canBuild ? <FormRowActions id={f.id} name={f.name} archived={Boolean(f.archivedAt) || f.status === "archived"} /> : null}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </>
  );
}
