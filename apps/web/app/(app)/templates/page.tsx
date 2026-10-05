import { requireSession, can } from "@/lib/auth";
import { listTemplates } from "@/lib/data/campaigns";
import { saveTemplate, deleteTemplate } from "@/lib/actions/campaigns";
import { ActionButton } from "@/components/ui/action-form";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MERGE_FIELD_HELP } from "@/lib/template-fields";
import { TemplateForm } from "./template-form";

export const metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const session = await requireSession();
  const templates = await listTemplates(session.orgId);
  const writable = can(session, "campaign:write");
  return (
    <>
      <PageHeader title="Templates" description={`Merge fields: ${MERGE_FIELD_HELP}. Text templates should include an opt out line on the first touch.`} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3 min-w-0">
          {templates.length === 0 ? <p className="text-[13px] text-fg-3">No templates yet.</p> : null}
          {templates.map((t) => (
            <Card key={t.id}>
              <CardHeader title={<span className="flex items-center gap-2">{t.name}<Badge tone={t.channel === "sms" ? "brand" : "info"}>{t.channel.toUpperCase()}</Badge>{!t.active ? <Badge>Inactive</Badge> : null}</span>} actions={writable ? <ActionButton action={deleteTemplate.bind(null, t.id)} variant="ghost" size="sm" confirm="Delete this template?">Delete</ActionButton> : null} />
              <CardBody>
                {writable ? (
                  <TemplateForm action={saveTemplate.bind(null, t.id)} template={{ name: t.name, channel: t.channel, subject: t.subject, body: t.body, active: t.active }} />
                ) : <p className="text-[13px] whitespace-pre-wrap break-words">{t.channel === "email" && t.subject ? <span className="block font-medium mb-1">{t.subject}</span> : null}{t.body}</p>}
              </CardBody>
            </Card>
          ))}
        </div>
        {writable ? (
          <Card className="min-w-0 self-start">
            <CardHeader title="New template" />
            <CardBody>
              <TemplateForm action={saveTemplate.bind(null, null)} />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
