"use client";
import * as React from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createApiKey, revokeApiKey, deleteApiKey, saveWebhook, deleteWebhook, toggleWebhook, testWebhook, rotateWebhookSecret, importLeadsCsv, importBuyersCsv, type ImportResult } from "@/lib/actions/integrations";
import type { ActionResult } from "@/lib/actions/leads";
import type { ApiKeyView, WebhookView } from "@/lib/services/integrations";
import { ActionForm, ActionButton } from "@/components/ui/action-form";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input, Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { dateTime, relative } from "@/lib/utils";
import { plural } from "@/lib/plural";

type Props = { isAdmin: boolean; keys: ApiKeyView[]; webhooks: WebhookView[]; events: string[]; origin: string };

export function IntegrationsPanel({ isAdmin, keys, webhooks, events, origin: serverOrigin }: Props) {
  const [origin, setOrigin] = useState(serverOrigin || "https://your-app.example.com");
  useEffect(() => { setOrigin(window.location.origin); }, []);
  return (
    <div className="space-y-4">
      {!isAdmin ? <Alert tone="info">Read only. An admin manages API keys, webhooks, and imports. You can still download exports below.</Alert> : null}
      {isAdmin ? <ApiKeysCard keys={keys} /> : null}
      {isAdmin ? <WebhooksCard webhooks={webhooks} events={events} /> : null}
      <ImportExportCard isAdmin={isAdmin} />
      <ConnectCard origin={origin} />
    </div>
  );
}

/* Shared pieces */

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
  };
  return { copied, copy };
}

function CopyBox({ value, secret, multiline, label = "value" }: { value: string; secret?: boolean; multiline?: boolean; label?: string }) {
  const { copied, copy } = useCopy();
  const [shown, setShown] = useState(!secret);
  const display = shown ? value : `${value.slice(0, 6)}${"•".repeat(24)}`;
  return (
    <div className="flex items-start gap-2">
      {multiline
        ? <pre className="flex-1 min-w-0 overflow-x-auto rounded-md border border-border bg-surface-2 px-3 py-2 text-[11px] leading-relaxed font-mono text-fg-2 whitespace-pre">{display}</pre>
        : <code className="flex-1 min-w-0 truncate rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] font-mono text-fg-2">{display}</code>}
      <div className="flex shrink-0 gap-1">
        {secret ? <Button type="button" variant="ghost" size="sm" aria-label={`${shown ? "Hide" : "Reveal"} ${label}`} onClick={() => setShown((s) => !s)}>{shown ? "Hide" : "Reveal"}</Button> : null}
        <Button type="button" variant="outline" size="sm" aria-label={copied ? `Copied ${label}` : `Copy ${label}`} onClick={() => copy(value)}>{copied ? "Copied" : "Copy"}</Button>
      </div>
    </div>
  );
}

/** Runs a server action and shows its message, success or failure, next to the button. */
function RunButton({ action, children, confirm }: { action: () => Promise<ActionResult>; children: React.ReactNode; confirm?: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" loading={pending} onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => { const res = await action(); setResult(res); router.refresh(); });
      }}>{children}</Button>
      {result ? <span className={result.ok ? "text-xs text-good" : "text-xs text-bad"}>{result.ok ? result.message ?? "Done" : result.error}</span> : null}
    </span>
  );
}

/* API keys */

function ApiKeysCard({ keys }: { keys: ApiKeyView[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ key: string; name: string } | null>(null);
  return (
    <Card>
      <CardHeader title="API keys" description="Other software uses a key to send leads to this workspace. Each tool should get its own key so it can be revoked on its own." />
      <CardBody className="space-y-4">
        {fresh ? (
          <Alert tone="warn" className="space-y-2">
            <div className="font-medium">Copy the key for {fresh.name} now. It will not be shown again.</div>
            <CopyBox value={fresh.key} label="API key" />
            <div className="text-xs">Only a hash is stored. If the key is lost, revoke it and create a new one.</div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setFresh(null)}>I have saved it</Button>
          </Alert>
        ) : null}

        {keys.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left text-xs text-fg-3 border-b border-border"><th className="py-1.5 pr-3 font-medium">Name</th><th className="py-1.5 pr-3 font-medium">Key</th><th className="py-1.5 pr-3 font-medium">Default source</th><th className="py-1.5 pr-3 font-medium">Last used</th><th className="py-1.5 pr-3 font-medium text-right">Uses</th><th className="py-1.5 font-medium" /></tr></thead>
              <tbody className="divide-y divide-border">
                {keys.map((k) => (
                  <tr key={k.id} className={k.revokedAt ? "text-fg-3" : ""}>
                    <td className="py-2 pr-3">{k.name}</td>
                    <td className="py-2 pr-3 font-mono text-[12px]">{k.prefix}...</td>
                    <td className="py-2 pr-3">{k.defaultSource ?? "API"}</td>
                    <td className="py-2 pr-3" suppressHydrationWarning>{k.lastUsedAt ? relative(k.lastUsedAt) : "Never"}</td>
                    <td className="py-2 pr-3 text-right num">{k.useCount}</td>
                    <td className="py-2 text-right">{k.revokedAt ? (
                      <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        <Badge tone="bad"><span suppressHydrationWarning>Revoked {dateTime(k.revokedAt)}</span></Badge>
                        <ActionButton action={deleteApiKey.bind(null, k.id)} variant="ghost" size="sm" confirm={`Delete the revoked key "${k.name}"? It is removed from this list for good. The audit log keeps a record.`}>Delete</ActionButton>
                      </span>
                    ) : <ActionButton action={revokeApiKey.bind(null, k.id)} variant="ghost" size="sm" confirm={`Revoke the key "${k.name}"? Any tool using it stops working at once.`}>Revoke</ActionButton>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-[13px] text-fg-3">No keys yet.</p>}

        <form ref={formRef} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end" onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          start(async () => {
            const res = await createApiKey(form);
            if (!res.ok) { setError(res.error); return; }
            setError(null); setFresh({ key: res.key, name: String(form.get("name") ?? "") }); formRef.current?.reset(); router.refresh();
          });
        }}>
          <Field label="Key name"><Input name="name" placeholder="Zapier, website form, dialer" required maxLength={100} /></Field>
          <Field label="Default lead source" hint="Used when the sending tool does not provide a source"><Input name="defaultSource" placeholder="Website form" maxLength={100} /></Field>
          <Button type="submit" variant="primary" loading={pending}>Create key</Button>
        </form>
        {error ? <Alert tone="bad">{error}</Alert> : null}
      </CardBody>
    </Card>
  );
}

/* Webhooks */

function EventChecks({ events, selected }: { events: string[]; selected: string[] }) {
  const all = selected.length === 0;
  return (
    <fieldset className="min-w-0">
      <legend className="text-xs font-medium text-fg-2 mb-1">Events</legend>
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {events.map((ev) => (
          <label key={ev} className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="events" value={ev} defaultChecked={all || selected.includes(ev)} className="h-4 w-4" /><span className="font-mono text-[12px]">{ev}</span></label>
        ))}
      </div>
      <p className="text-xs text-fg-3 mt-1">Checking every event, or none, subscribes the endpoint to all events, including ones added later.</p>
    </fieldset>
  );
}

const URL_HINT = "https is required. http is accepted only for localhost and 127.0.0.1, and only in development.";

function statusTone(w: WebhookView): "good" | "bad" | "neutral" {
  if (w.lastStatus == null) return w.lastDeliveryAt ? "bad" : "neutral";
  return w.lastStatus >= 200 && w.lastStatus < 300 ? "good" : "bad";
}

function WebhookRow({ w, events }: { w: WebhookView; events: string[] }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium">{w.name}</span>
            <Badge tone={w.active ? "good" : "warn"}>{w.active ? "Active" : "Paused"}</Badge>
            <Badge tone={statusTone(w)}><span suppressHydrationWarning>{w.lastDeliveryAt ? `Last: ${w.lastStatus ?? "no response"}, ${relative(w.lastDeliveryAt)}` : "No deliveries yet"}</span></Badge>
            {w.failureCount > 0 ? <span className="text-xs text-bad">{plural(w.failureCount, "consecutive failure", "consecutive failures")}</span> : null}
          </div>
          <div className="text-xs text-fg-3 font-mono truncate mt-1" title={w.url}>{w.url}</div>
          <div className="text-xs text-fg-3 mt-1">{w.events.length ? w.events.join(", ") : "All events"}</div>
          {!w.active && w.failureCount >= 10 ? <div className="text-xs text-warn mt-1">Paused automatically after 10 failed deliveries in a row. Fix the receiver, then resume.</div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <RunButton action={testWebhook.bind(null, w.id)}>Send test</RunButton>
          <ActionButton action={toggleWebhook.bind(null, w.id, !w.active)} variant="outline" size="sm">{w.active ? "Pause" : "Resume"}</ActionButton>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>{editing ? "Close" : "Edit"}</Button>
          <ActionButton action={deleteWebhook.bind(null, w.id)} variant="ghost" size="sm" confirm={`Delete the webhook "${w.name}" and its delivery history?`}>Delete</ActionButton>
        </div>
      </div>

      {editing ? (
        <div className="border-t border-border px-3 py-3 bg-surface-2/60">
          <ActionForm action={saveWebhook.bind(null, w.id)} submitLabel="Save webhook" size="sm" className="space-y-3" onSuccess={() => setEditing(false)}>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Name"><Input name="name" defaultValue={w.name} required maxLength={100} /></Field>
              <Field label="URL" hint={URL_HINT}><Input name="url" type="url" defaultValue={w.url} required /></Field>
            </div>
            <EventChecks events={events} selected={w.events} />
          </ActionForm>
        </div>
      ) : null}

      <div className="border-t border-border px-3 py-2.5 space-y-2">
        <div className="text-xs font-medium text-fg-2">Signing secret</div>
        <CopyBox value={w.secret} secret label={`signing secret for ${w.name}`} />
        <div className="flex items-center gap-2"><RunButton action={rotateWebhookSecret.bind(null, w.id)} confirm="Generate a new secret? The receiver must be updated or its signature checks will fail.">Rotate secret</RunButton></div>
      </div>

      <details className="border-t border-border px-3 py-2">
        <summary className="cursor-pointer text-xs text-fg-2 select-none">{w.deliveries.length === 0 ? "No deliveries yet" : w.deliveries.length === 1 ? "Last delivery" : `Last ${w.deliveries.length} deliveries`}</summary>
        {w.deliveries.length ? (
          <ul className="mt-2 divide-y divide-border text-xs">
            {w.deliveries.map((d) => (
              <li key={d.id} className="py-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="text-fg-3 w-28 shrink-0" suppressHydrationWarning>{dateTime(d.createdAt)}</span>
                <span className="font-mono w-40 shrink-0">{d.event}</span>
                <span className={d.ok ? "text-good" : "text-bad"}>{d.statusCode ?? "no response"}</span>
                <span className="text-fg-3 num">{d.durationMs != null ? `${d.durationMs} ms` : ""}</span>
                {d.error ? <span className="text-bad truncate max-w-full" title={d.error}>{d.error}</span> : null}
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-xs text-fg-3">Nothing sent yet. Use Send test to check the connection.</p>}
      </details>
    </div>
  );
}

function WebhooksCard({ webhooks, events }: { webhooks: WebhookView[]; events: string[] }) {
  return (
    <Card>
      <CardHeader title="Webhooks" description="When something happens in the CRM, a signed JSON POST goes to each URL below. Deliveries time out after 5 seconds and an endpoint pauses itself after 10 failures in a row." />
      <CardBody className="space-y-4">
        {webhooks.length ? <div className="space-y-3">{webhooks.map((w) => <WebhookRow key={w.id} w={w} events={events} />)}</div> : <p className="text-[13px] text-fg-3">No webhooks yet.</p>}
        <div className="rounded-md border border-dashed border-border px-3 py-3">
          <div className="text-[13px] font-medium mb-2">Add webhook</div>
          <ActionForm action={saveWebhook.bind(null, null)} submitLabel="Add webhook" resetOnSuccess className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Name"><Input name="name" placeholder="Zapier: new lead to Google Sheets" required maxLength={100} /></Field>
              <Field label="URL" hint={URL_HINT}><Input name="url" type="url" placeholder="https://hooks.zapier.com/hooks/catch/..." required /></Field>
            </div>
            <EventChecks events={events} selected={[]} />
          </ActionForm>
        </div>
      </CardBody>
    </Card>
  );
}

/* Import and export */

function CsvImport({ title, action, templateHref, columns, withSource }: { title: string; action: (form: FormData) => Promise<ImportResult>; templateHref: string; columns: string; withSource?: boolean }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);
  return (
    <div className="rounded-md border border-border px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-medium">{title}</div>
        <a href={templateHref} download className="text-xs text-brand hover:underline">Download template</a>
      </div>
      <p className="text-xs text-fg-3 mt-1">{columns}</p>
      <form ref={formRef} className="mt-2 space-y-2" onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        start(async () => { const res = await action(form); setResult(res); if (res.ok) { formRef.current?.reset(); router.refresh(); } });
      }}>
        <input type="file" name="file" aria-label={`${title}: CSV file`} accept=".csv,text/csv" required className="block w-full text-[13px] file:mr-3 file:h-8 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:text-[13px] file:text-fg hover:file:bg-surface-2" />
        {withSource ? <Field label="Lead source for rows without one"><Input name="defaultSource" placeholder="CSV import" maxLength={100} /></Field> : null}
        <Button type="submit" variant="outline" size="sm" loading={pending}>{pending ? "Importing" : "Import"}</Button>
      </form>
      {result && !result.ok ? <Alert tone="bad" className="mt-2">{result.error}</Alert> : null}
      {result && result.ok ? (
        <Alert tone={result.errors ? "warn" : "good"} className="mt-2">
          <div>{plural(result.total, "row", "rows")} read. {result.message}</div>
          {result.errorMessages.length ? <ul className="mt-1 list-disc pl-4 text-xs space-y-0.5">{result.errorMessages.map((m, i) => <li key={i}>{m}</li>)}{result.errors > result.errorMessages.length ? <li>{plural(result.errors - result.errorMessages.length, "more row", "more rows")} had errors.</li> : null}</ul> : null}
        </Alert>
      ) : null}
    </div>
  );
}

function ImportExportCard({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Card>
      <CardHeader title="Import and export" description="CSV files up to 2 MB and 2,000 rows. Columns are matched by header name, in any order." />
      <CardBody className="space-y-4">
        {isAdmin ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <CsvImport title="Import leads" action={importLeadsCsv} templateHref="/api/export/leads-template.csv" withSource
              columns="Required: address, city, state, zip. Optional: first_name, last_name or name, phone, email, asking_price, source, urgency, beds, baths, sqft, year_built, property_type, notes, external_id. A row that matches an open lead at the same address adds a note to that lead. SMS consent is always set to unknown." />
            <CsvImport title="Import buyers" action={importBuyersCsv} templateHref="/api/export/buyers-template.csv"
              columns="Required: first_name, name, or company. Optional: last_name, phone, email, website, states (two letter codes separated by commas or spaces, for example MD, PA), source, notes. A row is skipped when its email or phone already belongs to a buyer. A row with no phone and no email is skipped when a buyer with the same company and first name exists. A buyers export can be imported as it is." />
          </div>
        ) : null}
        <div>
          <div className="text-[13px] font-medium mb-1.5">Export</div>
          <div className="flex flex-wrap gap-2">
            {[["Leads", "/api/export/leads.csv"], ["Buyers", "/api/export/buyers.csv"], ["Analyses", "/api/export/analyses.csv"]].map(([label, href]) => (
              <a key={href} href={href} download className="inline-flex h-8 items-center rounded-md border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">{label} CSV</a>
            ))}
          </div>
          <p className="text-xs text-fg-3 mt-1.5">Cells that begin with =, +, -, or @ are prefixed with a single quote so a spreadsheet does not run them as formulas.</p>
        </div>
      </CardBody>
    </Card>
  );
}

/* Instructions */

const VERIFY_SNIPPET = `const crypto = require("node:crypto");

// rawBody must be the exact bytes received, before any JSON parsing.
function verifyDealCalcWebhook(headers, rawBody, secret) {
  const timestamp = headers["x-dealcalc-timestamp"];
  const given = String(headers["x-dealcalc-signature"] || "").replace("sha256=", "");
  const expected = crypto.createHmac("sha256", secret).update(timestamp + "." + rawBody).digest("hex");
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300; // 5 minutes
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return fresh && a.length === b.length && crypto.timingSafeEqual(a, b);
}`;

type Shell = "bash" | "powershell";

/** The same request written for bash (curl) and for Windows PowerShell, with a small switch between them. */
function ShellExample({ shell, onShell, bash, powershell, label }: { shell: Shell; onShell: (s: Shell) => void; bash: string; powershell: string; label: string }) {
  const tab = (value: Shell, text: string) => (
    <button type="button" role="tab" aria-selected={shell === value} onClick={() => onShell(value)}
      className={shell === value ? "rounded px-2 py-0.5 text-xs font-medium bg-surface-2 text-fg border border-border" : "rounded px-2 py-0.5 text-xs text-fg-3 border border-transparent hover:text-fg"}>{text}</button>
  );
  return (
    <div className="space-y-1">
      <div role="tablist" aria-label={`${label}: choose a shell`} className="flex gap-1">{tab("bash", "bash")}{tab("powershell", "PowerShell")}</div>
      <CopyBox value={shell === "bash" ? bash : powershell} multiline label={`${label} example`} />
    </div>
  );
}

function ConnectCard({ origin }: { origin: string }) {
  const [shell, setShell] = useState<Shell>("bash");
  const createCurl = `curl -X POST ${origin}/api/v1/leads \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"address":"123 Main St","city":"Baltimore","state":"MD","zip":"21201","name":"Jane Doe","phone":"410-555-0100","asking_price":150000,"source":"Website form"}'`;
  const createPs = `$body = @{ address = "123 Main St"; city = "Baltimore"; state = "MD"; zip = "21201"; name = "Jane Doe"; phone = "410-555-0100"; asking_price = 150000; source = "Website form" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "${origin}/api/v1/leads" -Headers @{ Authorization = "Bearer YOUR_API_KEY" } -ContentType "application/json" -Body $body`;
  const pingCurl = `curl ${origin}/api/v1/ping -H "Authorization: Bearer YOUR_API_KEY"`;
  const pingPs = `Invoke-RestMethod -Uri "${origin}/api/v1/ping" -Headers @{ Authorization = "Bearer YOUR_API_KEY" }`;
  const listCurl = `curl "${origin}/api/v1/leads?updatedSince=2026-01-01T00:00:00Z&limit=100" -H "X-Api-Key: YOUR_API_KEY"`;
  const listPs = `Invoke-RestMethod -Uri "${origin}/api/v1/leads?updatedSince=2026-01-01T00:00:00Z&limit=100" -Headers @{ "X-Api-Key" = "YOUR_API_KEY" }`;
  const h = "text-[13px] font-medium";
  const p = "text-[13px] text-fg-2";
  return (
    <Card>
      <CardHeader title="Connect other software" description="Anything that can send or receive an HTTP request can connect: Zapier, Make, a website form, a dialer, a list provider, or a script." />
      <CardBody className="space-y-5">
        <section className="space-y-2">
          <h4 className={h}>1. Send leads in</h4>
          <p className={p}>Create an API key above, then POST JSON to <code className="font-mono text-[12px]">{origin}/api/v1/leads</code>. Send one lead, or <code className="font-mono text-[12px]">{"{ \"leads\": [...] }"}</code> with up to 200. Field names may be camelCase or snake_case. JSON is expected; form encoded and multipart form posts work for a single lead. Required: address, city, state, zip. Notes may be up to 5,000 characters. A lead at an address that already has an open lead is not created twice; a note is added instead and the response marks it as a duplicate. The limit is 120 requests per minute per key.</p>
          <ShellExample shell={shell} onShell={setShell} bash={createCurl} powershell={createPs} label="Create a lead" />
          <p className={p}>Check that a key works:</p>
          <ShellExample shell={shell} onShell={setShell} bash={pingCurl} powershell={pingPs} label="Check a key" />
          <p className={p}>Read leads back, newest first, for polling triggers:</p>
          <ShellExample shell={shell} onShell={setShell} bash={listCurl} powershell={listPs} label="List leads" />
        </section>

        <section className="space-y-2">
          <h4 className={h}>2. Send events out</h4>
          <p className={p}>Add a webhook above. Each delivery is a JSON POST with the shape <code className="font-mono text-[12px]">{"{ id, event, createdAt, orgId, data }"}</code> and the headers X-DealCalc-Event, X-DealCalc-Delivery, X-DealCalc-Timestamp, and X-DealCalc-Signature. The body id names the event and is the same at every endpoint that receives it, so use it to ignore an event you have already handled. X-DealCalc-Delivery is different for every delivery attempt and matches one row in the delivery list above. Reply with any 2xx status within 5 seconds. Failed deliveries are not retried, so poll the leads endpoint if you need a backstop.</p>
        </section>

        <section className="space-y-2">
          <h4 className={h}>3. Verify the signature</h4>
          <p className={p}>The signature is <code className="font-mono text-[12px]">sha256=</code> plus the hex HMAC-SHA256 of <code className="font-mono text-[12px]">{"{timestamp}.{raw body}"}</code> using the endpoint signing secret. Reject requests older than 5 minutes. Node example:</p>
          <CopyBox value={VERIFY_SNIPPET} multiline label="signature check example" />
        </section>

        <section className="space-y-2">
          <h4 className={h}>4. Zapier and Make</h4>
          <ul className="list-disc pl-5 space-y-1.5 text-[13px] text-fg-2">
            <li><b>Into the CRM (Zapier):</b> add the action Webhooks by Zapier, event POST. URL <code className="font-mono text-[12px]">{origin}/api/v1/leads</code>, payload type json, map your fields under Data, and add the header <code className="font-mono text-[12px]">Authorization</code> with the value <code className="font-mono text-[12px]">Bearer YOUR_API_KEY</code>.</li>
            <li><b>Out of the CRM (Zapier):</b> start a Zap with the trigger Webhooks by Zapier, event Catch Hook. Copy the hook URL Zapier gives you, paste it above as a new webhook, pick the events, then press Send test so Zapier sees a sample.</li>
            <li><b>Make:</b> use the HTTP module, Make a request, for inbound leads with the same URL and header. For outbound, create a Custom webhook in Make and paste its URL above as a webhook.</li>
            <li><b>Polling instead of webhooks:</b> Webhooks by Zapier, event Retrieve Poll, URL <code className="font-mono text-[12px]">{origin}/api/v1/leads</code>, key <code className="font-mono text-[12px]">leads</code>, with the X-Api-Key header. Zapier removes duplicates by the id field.</li>
            <li><b>Spreadsheets:</b> use the CSV import and export above. No key is needed.</li>
          </ul>
        </section>
        <p className="text-xs text-fg-3">The full reference, including every event payload, is in docs/INTEGRATIONS.md under Connecting other software.</p>
      </CardBody>
    </Card>
  );
}
