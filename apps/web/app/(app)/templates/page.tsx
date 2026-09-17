import { requireSession, can } from "@/lib/auth";
import { listTemplates } from "@/lib/data/campaigns";
import { saveTemplate, deleteTemplate } from "@/lib/actions/campaigns";
import { ActionForm, ActionButton } from "@/components/ui/action-form";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const session = await requireSession();
  const templates = await listTemplates(session.orgId);
  const writable = can(session, "campaign:write");
  return (
    <>
      <PageHeader title="Templates" description="Merge fields: {{first_name}}, {{last_name}}, {{property_address}}, {{city}}, {{sender_name}}. Text templates should include an opt out line on the first touch." />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          {templates.map((t) => (
            <Card key={t.id}>
              <CardHeader title={<span className="flex items-center gap-2">{t.name}<Badge tone={t.channel === "sms" ? "brand" : "info"}>{t.channel.toUpperCase()}</Badge>{!t.active ? <Badge>Inactive</Badge> : null}</span>} actions={writable ? <ActionButton action={deleteTemplate.bind(null, t.id)} variant="ghost" size="sm" confirm="Delete this template?">Delete</ActionButton> : null} />
              <CardBody>
                {writable ? (
                  <ActionForm action={saveTemplate.bind(null, t.id)} submitLabel="Save" variant="outline" size="sm" className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <Field label="Name" className="col-span-2"><Input name="name" defaultValue={t.name} /></Field>
                      <Field label="Channel"><Select name="channel" defaultValue={t.channel}><option value="sms">Text</option><option value="email">Email</option></Select></Field>
                    </div>
                    {t.channel === "email" ? <Field label="Subject"><Input name="subject" defaultValue={t.subject ?? ""} /></Field> : null}
                    <Field label="Body"><Textarea name="body" defaultValue={t.body} className="min-h-[90px]" /></Field>
                  </ActionForm>
                ) : <p className="text-[13px] whitespace-pre-wrap">{t.body}</p>}
              </CardBody>
            </Card>
          ))}
        </div>
        {writable ? (
          <Card>
            <CardHeader title="New template" />
            <CardBody>
              <ActionForm action={saveTemplate.bind(null, null)} submitLabel="Create" resetOnSuccess className="space-y-2">
                <Field label="Name"><Input name="name" required /></Field>
                <Field label="Channel"><Select name="channel" defaultValue="sms"><option value="sms">Text</option><option value="email">Email</option></Select></Field>
                <Field label="Subject (email only)"><Input name="subject" /></Field>
                <Field label="Body"><Textarea name="body" required placeholder="Hi {{first_name}}, this is {{sender_name}}..." className="min-h-[120px]" /></Field>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
