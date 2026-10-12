import { notFound, redirect } from "next/navigation";
import { requireSession, can } from "@/lib/auth";
import { isUuid } from "@/lib/safe";
import { getFormDetail } from "@/lib/data/forms";
import { listProfiles } from "@/lib/data/leads";
import { PageHeader } from "@/components/ui/misc";
import { Alert } from "@/components/ui/misc";
import { LinkButton } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-form";
import { restoreFormAction } from "@/lib/actions/forms";
import { FormEditor } from "@/components/forms/editor/form-editor";

export const metadata = { title: "Form editor" };

export default async function FormEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  if (!can(session, "form:build")) redirect("/forms");
  const [form, team] = await Promise.all([getFormDetail(session.orgId, id), listProfiles(session.orgId)]);
  if (!form) notFound();
  const crumbs = [{ label: "Forms", href: "/forms" }, { label: form.name }];

  if (form.archivedAt) {
    return (
      <>
        <PageHeader title={form.name} crumbs={crumbs} />
        <Alert tone="warn" className="max-w-xl">
          <p className="mb-2">This form is archived. Restore it to edit it.</p>
          <div className="flex gap-2">
            <ActionButton action={() => restoreFormAction(id)} variant="outline">Restore form</ActionButton>
            <LinkButton href="/forms" variant="ghost" size="sm">Back to forms</LinkButton>
          </div>
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Form editor" description="Edit the draft. Publishing creates a new version that every submission follows." crumbs={crumbs} />
      <FormEditor
        formId={form.id}
        status={form.status}
        latestVersionNumber={form.latestVersionNumber}
        versions={form.versions}
        draftDefinition={form.draftDefinition}
        publishedDefinition={form.publishedDefinition}
        details={{ name: form.name, category: form.category, description: form.description, ownerId: form.ownerId, settings: form.settings }}
        profiles={team.map((p) => ({ id: p.id, name: p.fullName }))}
      />
    </>
  );
}
