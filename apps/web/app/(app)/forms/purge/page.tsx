import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { listPurgeRequests, listPurgeTargets } from "@/lib/data/form-purge";
import { approveFormPurge, cancelFormPurge } from "@/lib/actions/forms";
import { requestFormPurgeFromForm } from "@/lib/actions/form-purge";
import { ActionForm, ActionButton } from "@/components/ui/action-form";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input, Select, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function FormPurgePage() {
  const session = await requireSession();
  if (session.role !== "admin") redirect("/forms");
  const [requests, targets] = await Promise.all([listPurgeRequests(session.orgId), listPurgeTargets(session.orgId)]);

  return (
    <div className="space-y-4">
      <PageHeader title="Privacy purge" description="Removes one person's form answers, files, comments, history, and sign in records after a second admin approves." crumbs={[{ label: "Forms", href: "/forms" }, { label: "Privacy purge" }]} />
      <Alert tone="warn">A purge cannot be undone. Submissions other people worked on stay, with this person's answers replaced by "Removed on request". Older backups keep the data until they expire.</Alert>
      <Card>
        <CardHeader title="Request a purge" description="One person at a time. You cannot approve your own request." />
        <CardBody>
          <ActionForm action={requestFormPurgeFromForm} submitLabel="Request purge" resetOnSuccess className="grid gap-3 sm:grid-cols-2 items-end">
            <Field label="Person">
              <Select name="target" required defaultValue="">
                <option value="" disabled>Choose a person</option>
                {targets.map((t) => <option key={`${t.type}:${t.id}`} value={`${t.type}:${t.id}`}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="Request reference"><Input name="requestReference" required maxLength={200} placeholder="For example, the email or ticket that asked for removal" /></Field>
          </ActionForm>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Requests" />
        <CardBody>
          {requests.length === 0 ? <p className="text-[13px] text-fg-3">No purge requests.</p> : (
            <ul className="divide-y divide-border">
              {requests.map((r) => (
                <li key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-[13px]">
                  <div className="min-w-0">
                    <div className="font-medium">{r.targetLabel}</div>
                    <div className="text-fg-3 text-xs">Reference {r.requestReference}. Requested by {r.requestedByName}.{r.approvedByName ? ` Approved by ${r.approvedByName}.` : ""}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={r.status === "executed" ? "good" : r.status === "pending" ? "warn" : "neutral"}>{r.status === "executed" ? "Purged" : r.status === "pending" ? "Waiting for a second admin" : "Cancelled"}</Badge>
                    {r.status === "pending" && r.requestedBy !== session.profileId ? (
                      <ActionButton action={approveFormPurge.bind(null, r.id)} variant="primary" confirm="Remove this person's form data now? This cannot be undone.">Approve purge</ActionButton>
                    ) : null}
                    {r.status === "pending" ? <ActionButton action={cancelFormPurge.bind(null, r.id)}>Cancel request</ActionButton> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
