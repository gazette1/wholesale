import { and, desc, eq } from "drizzle-orm";
import { auditLog, profiles as profilesTable, orgs } from "@dealcalc/db";
import { providerStatus } from "@dealcalc/integrations";
import { getDb, dbKind } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { listStages, listProfiles, listSources, listTags } from "@/lib/data/leads";
import { inviteProfile, updateProfile, saveStage, moveStage, saveSource, updateSource, saveBranding, deleteTag } from "@/lib/actions/settings";
import { createTag } from "@/lib/actions/leads";
import { ActionForm, ActionButton } from "@/components/ui/action-form";
import { PageHeader, TabNav, Alert } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { dateTime } from "@/lib/utils";
import { loadIntegrationSettings, SUBSCRIBABLE_EVENTS } from "@/lib/services/integrations";
import { IntegrationsPanel } from "./integrations-panel";

export const metadata = { title: "Settings" };

/** "campaign_step" reads as "campaign step". */
function words(value: string): string {
  return value.replace(/[_:]+/g, " ");
}

/** A short name for the thing that changed, when the audit row carries one. */
function auditLabel(side: unknown): string | null {
  if (!side || typeof side !== "object") return null;
  const row = side as Record<string, unknown>;
  for (const key of ["name", "title", "fullName", "email", "addressLine1", "company"]) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.length > 80 ? `${v.slice(0, 80)}...` : v;
  }
  return null;
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await requireSession();
  const TABS = ["team", "pipeline", "tags", "branding", "integrations", "audit"];
  const sp = await searchParams;
  // An unknown or repeated tab value shows the team tab instead of an empty page.
  const tab = typeof sp.tab === "string" && TABS.includes(sp.tab) ? sp.tab : "team";
  const db = await getDb();
  const [team, stages, sources, tags, org, audit] = await Promise.all([
    db.select().from(profilesTable).where(eq(profilesTable.orgId, session.orgId)).orderBy(profilesTable.fullName), listStages(session.orgId), listSources(session.orgId, { includeInactive: true }), listTags(session.orgId),
    db.query.orgs.findFirst({ where: eq(orgs.id, session.orgId) }),
    db.select({ a: auditLog, actor: profilesTable.fullName }).from(auditLog).leftJoin(profilesTable, eq(auditLog.actorId, profilesTable.id)).where(eq(auditLog.orgId, session.orgId)).orderBy(desc(auditLog.at)).limit(100),
  ]);
  const isAdmin = session.role === "admin";
  const status = providerStatus();
  // Keys and webhook secrets are loaded for admins only, and only on the tab that shows them.
  const connect = tab === "integrations" && isAdmin ? await loadIntegrationSettings(session.orgId) : { keys: [], webhooks: [] };
  const branding = (org?.branding ?? {}) as Record<string, string | undefined>;
  const tabs = TABS.map((t) => ({ key: t, label: t[0]!.toUpperCase() + t.slice(1), href: `/settings?tab=${t}` }));
  return (
    <>
      <PageHeader title="Settings" description={isAdmin ? "Team, pipeline, tags, branding, integrations, and the audit log." : "Read only. Ask an admin to change settings."} />
      <TabNav tabs={tabs} current={tab} />
      <div className="mt-4">
        {tab === "team" ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-3 min-w-0">
              {team.map((p) => (
                <Card key={p.id}>
                  <CardBody>
                    <ActionForm action={updateProfile.bind(null, p.id)} submitLabel="Save" variant="outline" size="sm" className="grid gap-2 sm:grid-cols-6 items-end">
                      <Field label="Name" className="sm:col-span-2"><Input name="fullName" defaultValue={p.fullName} disabled={!isAdmin} required maxLength={120} /></Field>
                      <Field label={p.id === session.profileId ? "Email (your login, fixed)" : "Email"} className="sm:col-span-2"><Input name="email" type="email" defaultValue={p.email} disabled={!isAdmin} readOnly={p.id === session.profileId} required /></Field>
                      <Field label="Role"><Select name="role" defaultValue={p.role} disabled={!isAdmin}><option value="admin">Admin</option><option value="acquisitions">Acquisitions</option><option value="dispositions">Dispositions</option><option value="viewer">Viewer</option></Select></Field>
                      <Field label="Active"><Select name="active" defaultValue={p.active ? "on" : "off"} disabled={!isAdmin}><option value="on">Yes</option><option value="off">No</option></Select></Field>
                      <Field label="Twilio number for outbound texts" className="sm:col-span-3"><Input name="twilioNumber" defaultValue={p.twilioNumber ?? ""} disabled={!isAdmin} placeholder="+14105550000" /></Field>
                      <div className="sm:col-span-3 text-xs text-fg-3 pb-2">{p.userId ? "Signed in before" : "Has not signed in yet. They sign up with this email."}</div>
                    </ActionForm>
                  </CardBody>
                </Card>
              ))}
            </div>
            {isAdmin ? (
              <Card className="min-w-0 self-start">
                <CardHeader title="Add team member" description="They create a login with this exact email." />
                <CardBody>
                  <ActionForm action={inviteProfile} submitLabel="Add" resetOnSuccess className="space-y-2">
                    <Field label="Full name"><Input name="fullName" required maxLength={120} /></Field>
                    <Field label="Email"><Input name="email" type="email" required /></Field>
                    <Field label="Role"><Select name="role" defaultValue="acquisitions"><option value="admin">Admin</option><option value="acquisitions">Acquisitions</option><option value="dispositions">Dispositions</option><option value="viewer">Viewer</option></Select></Field>
                  </ActionForm>
                  <div className="mt-3 text-xs text-fg-3 space-y-1">
                    <p><b>Admin</b>: everything. <b>Acquisitions</b>: leads, messaging, analyses. <b>Dispositions</b>: buyers, packages, notes. <b>Viewer</b>: read only.</p>
                  </div>
                </CardBody>
              </Card>
            ) : null}
          </div>
        ) : null}

        {tab === "pipeline" ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-2 min-w-0">
              {stages.map((s, i) => (
                <Card key={s.id}><CardBody>
                  <ActionForm action={saveStage.bind(null, s.id)} submitLabel="Save" variant="outline" size="sm" inline className="flex flex-wrap items-end gap-2">
                    <Field label="Stage"><Input name="name" defaultValue={s.name} disabled={!isAdmin} className="w-48" /></Field>
                    <Field label="Color"><input type="color" name="color" defaultValue={s.color ?? "#6b7280"} disabled={!isAdmin} className="h-8 w-12 rounded border border-border" /></Field>
                    <label className="flex items-center gap-2 text-[13px] h-8"><input type="checkbox" name="isTerminal" defaultChecked={s.isTerminal} disabled={!isAdmin} className="h-4 w-4" />Closes the lead</label>
                    <span className="text-xs text-fg-3">key {s.key}</span>
                    {isAdmin ? <><ActionButton action={moveStage.bind(null, s.id, -1)} variant="ghost" size="sm">Up</ActionButton><ActionButton action={moveStage.bind(null, s.id, 1)} variant="ghost" size="sm">Down</ActionButton></> : null}
                  </ActionForm>
                </CardBody></Card>
              ))}
            </div>
            <div className="space-y-4 min-w-0">
              {isAdmin ? <Card><CardHeader title="Add stage" /><CardBody><ActionForm action={saveStage.bind(null, null)} submitLabel="Add" resetOnSuccess className="space-y-2"><Field label="Name"><Input name="name" required /></Field><Field label="Key (optional)"><Input name="key" placeholder="auto from name" /></Field><Field label="Color"><input type="color" name="color" defaultValue="#6366f1" className="h-8 w-12" /></Field></ActionForm></CardBody></Card> : null}
              <Card><CardHeader title="Lead sources" /><CardBody>
                {isAdmin ? (
                  <div className="space-y-3 mb-3">
                    {sources.map((src) => (
                      <ActionForm key={src.id} action={updateSource.bind(null, src.id)} submitLabel="Save" variant="outline" size="sm" className="grid grid-cols-2 gap-2 items-end border-b border-border pb-3">
                        <Field label="Source" className="col-span-2"><Input name="name" defaultValue={src.name} required maxLength={80} /></Field>
                        <Field label="Cost per lead"><Input name="costPerLead" type="number" min={0} max={100000} step="0.01" defaultValue={src.costPerLead ?? ""} placeholder="none" /></Field>
                        <Field label="Active"><Select name="active" defaultValue={src.active ? "on" : "off"}><option value="on">Yes</option><option value="off">No</option></Select></Field>
                      </ActionForm>
                    ))}
                    {sources.length === 0 ? <p className="text-xs text-fg-3">No sources yet.</p> : null}
                  </div>
                ) : (
                  <ul className="text-[13px] space-y-1 mb-3">{sources.map((src) => <li key={src.id} className="flex justify-between gap-2"><span className="break-words min-w-0">{src.name}{src.active ? "" : " (inactive)"}</span><span className="text-fg-3 num shrink-0">{src.costPerLead ? `$${src.costPerLead} per lead` : ""}</span></li>)}</ul>
                )}
                {isAdmin ? (
                  <ActionForm action={saveSource} submitLabel="Add source" variant="outline" size="sm" resetOnSuccess className="space-y-2">
                    <Field label="New source name"><Input name="name" placeholder="Source name" required maxLength={80} /></Field>
                    <Field label="Cost per lead"><Input name="costPerLead" type="number" min={0} max={100000} step="0.01" placeholder="Cost per lead" /></Field>
                    <p className="text-xs text-fg-3">Dollars, zero or more. Adding a name that already exists updates its cost.</p>
                  </ActionForm>
                ) : null}
              </CardBody></Card>
            </div>
          </div>
        ) : null}

        {tab === "tags" ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2 min-w-0"><CardHeader title="Tags" description="Issue tags mirror the deal issue checklist. Lead tags are free form." /><CardBody className="flex flex-wrap gap-2">
              {tags.map((t) => <span key={t.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs"><span className="h-2 w-2 rounded-full" style={{ background: t.color ?? "#999" }} />{t.name}<span className="text-fg-3">· {t.kind}</span>{isAdmin ? <ActionButton action={deleteTag.bind(null, t.id)} variant="ghost" size="sm" className="h-5 px-1 text-fg-3" confirm="Delete this tag? It is removed from every lead that has it."><span className="sr-only">Delete tag {t.name}</span><span aria-hidden="true">x</span></ActionButton> : null}</span>)}
            </CardBody></Card>
            {isAdmin ? <Card><CardHeader title="New tag" /><CardBody><ActionForm action={createTag} submitLabel="Add" resetOnSuccess className="space-y-2"><Field label="Name"><Input name="name" required /></Field><Field label="Kind"><Select name="kind" defaultValue="lead"><option value="lead">Lead</option><option value="buyer">Buyer</option><option value="issue">Issue</option></Select></Field><Field label="Color"><input type="color" name="color" defaultValue="#6366f1" className="h-8 w-12" /></Field></ActionForm></CardBody></Card> : null}
          </div>
        ) : null}

        {tab === "branding" ? (
          <Card className="max-w-2xl"><CardHeader title="Branding" description="Used on deal packages and the share page." /><CardBody>
            <ActionForm action={saveBranding} submitLabel="Save branding" className="grid gap-3 sm:grid-cols-2">
              <Field label="Workspace name"><Input name="orgName" defaultValue={org?.name ?? ""} disabled={!isAdmin} /></Field>
              <Field label="Company name on packages"><Input name="companyName" defaultValue={branding.companyName ?? ""} disabled={!isAdmin} /></Field>
              <Field label="Phone"><Input name="phone" defaultValue={branding.phone ?? ""} disabled={!isAdmin} /></Field>
              <Field label="Email"><Input name="email" type="email" defaultValue={branding.email ?? ""} disabled={!isAdmin} /></Field>
              <Field label="Accent color"><input type="color" name="primaryColor" defaultValue={branding.primaryColor ?? "#0f172a"} disabled={!isAdmin} className="h-8 w-16" /></Field>
              <Field label="Logo URL (https, optional)"><Input name="logoUrl" type="url" inputMode="url" maxLength={500} pattern="https://.*" placeholder="https://example.com/logo.png" defaultValue={branding.logoUrl ?? ""} disabled={!isAdmin} /></Field>
              <Field label="Disclosure" className="sm:col-span-2"><Textarea name="disclosure" defaultValue={branding.disclosure ?? ""} disabled={!isAdmin} /></Field>
            </ActionForm>
          </CardBody></Card>
        ) : null}

        {tab === "integrations" ? (
          <div className="space-y-3 max-w-2xl">
            <Alert tone="info">Provider keys live only in environment variables. Set them in <code>.env.local</code> for development and in the hosting provider for production, then restart. Provider credentials are never stored in the database.</Alert>
            {[
              ["Database", status.database, "DATABASE_URL", status.database === "postgres" ? "Supabase Postgres" : "Local PGlite file under .pglite (demo data, single machine)"],
              ["Auth", status.auth, "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY", session.authMode === "dev" ? "Signed in through DEV_AUTH_EMAIL. Remove before deploying." : "Supabase Auth"],
              ["Property data", status.propertyData, "PROPERTY_DATA_PROVIDER=realestateapi, REALESTATEAPI_KEY", status.propertyData === "mock" ? "Deterministic sample data" : "RealEstateAPI live"],
              ["SMS", status.sms, "MESSAGING_PROVIDER=twilio, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID", status.sms === "mock" ? "Messages are recorded, nothing is sent" : "Twilio live. Webhooks: /api/webhooks/twilio/sms and /api/webhooks/twilio/status"],
              ["Email", status.email, "EMAIL_PROVIDER=resend, RESEND_API_KEY, EMAIL_FROM", status.email === "mock" ? "Emails are recorded, nothing is sent" : "Resend live. Webhook: /api/webhooks/resend"],
              ["Judgment (Jev)", status.judgment, "JUDGMENT_PROVIDER=typesafe, TYPESAFE_API_KEY", status.judgment === "mock" ? "Keyword rules, low confidence, never acts automatically" : "TypeSafe jev-latest: reply intent, urgency, deal issue suggestions, buyer criteria"],
              ["Sequences", process.env.CRON_SECRET ? "cron" : "manual", "CRON_SECRET plus a scheduler hitting /api/cron/dispatch every minute", process.env.CRON_SECRET ? "Scheduler configured" : "Use Send due steps now on the Campaigns page until a scheduler is set"],
            ].map(([name, value, keys, note]) => (
              <Card key={name as string}><CardBody className="flex items-start justify-between gap-4">
                <div><div className="text-[13px] font-medium">{name}</div><div className="text-xs text-fg-3 mt-0.5">{note}</div><div className="text-[11px] text-fg-3 mt-1 font-mono">{keys}</div></div>
                <Badge tone={value === "mock" || value === "pglite" || value === "dev" || value === "manual" ? "warn" : "good"}>{value}</Badge>
              </CardBody></Card>
            ))}
          </div>
        ) : null}

        {tab === "integrations" ? <div className="mt-6 max-w-4xl"><IntegrationsPanel isAdmin={isAdmin} keys={connect.keys} webhooks={connect.webhooks} events={SUBSCRIBABLE_EVENTS} origin={process.env.APP_URL ?? ""} /></div> : null}

        {tab === "audit" ? (
          <Card className="min-w-0"><CardHeader title="Audit log" description="Last 100 changes, newest first" /><CardBody className="p-0 min-w-0">
            {audit.length === 0 ? <p className="p-4 text-[13px] text-fg-3">No changes recorded yet.</p> : null}
            <ul className="divide-y divide-border text-[13px] min-w-0">{audit.map(({ a, actor }) => {
              const label = auditLabel(a.after) ?? auditLabel(a.before);
              const hasDetail = a.before != null || a.after != null;
              return (
                <li key={a.id} className="px-4 py-2 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 min-w-0">
                    <span className="text-fg-3 whitespace-nowrap sm:w-36 sm:shrink-0">{dateTime(a.at)}</span>
                    <span className="font-medium sm:w-32 sm:shrink-0 truncate">{actor ?? "System"}</span>
                    <span className="text-fg-2 min-w-0 break-words">{words(a.action)} {words(a.entityType)}{label ? <> <span className="text-fg font-medium">{label}</span></> : null} <span className="text-fg-3 font-mono text-[11px]">{a.entityId.slice(0, 8)}</span></span>
                  </div>
                  {hasDetail ? (
                    <details className="mt-1 min-w-0">
                      <summary className="cursor-pointer text-xs text-fg-3 hover:text-fg">Before and after</summary>
                      <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {([["Before", a.before], ["After", a.after]] as const).map(([side, value]) => (
                          <div key={side} className="min-w-0">
                            <div className="text-[11px] text-fg-3 mb-0.5">{side}</div>
                            <pre className="max-h-48 overflow-auto rounded-md border border-border bg-surface-2 p-2 text-[11px] leading-snug whitespace-pre-wrap break-words">{value == null ? "none" : JSON.stringify(value, null, 2)}</pre>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </li>
              );
            })}</ul>
          </CardBody></Card>
        ) : null}
      </div>
    </>
  );
}
