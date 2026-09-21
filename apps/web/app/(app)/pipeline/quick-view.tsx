"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { addActivity, addTask, getLeadQuickView, type ActionResult } from "@/lib/actions/leads";
import { createAnalysis } from "@/lib/actions/analyzer";
import type { LeadQuickView } from "@/lib/data/leads";
import { Dialog, DrawerContent } from "@/components/ui/dialog";
import { ActionForm } from "@/components/ui/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge, StageBadge, type BadgeTone } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Alert, Skeleton } from "@/components/ui/misc";
import { cn, money, percent, relative, dueLabel } from "@/lib/utils";
import { Phone, Mail, MessageSquare, StickyNote, ArrowRightLeft, DollarSign, CheckSquare, Sparkles, FileText, Calculator, Bot, ExternalLink, AlertTriangle } from "lucide-react";
import type { BoardLead, BoardStage } from "./board";

const ACTIVITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = { call: Phone, sms: MessageSquare, email: Mail, note: StickyNote, stage_change: ArrowRightLeft, offer: DollarSign, task: CheckSquare, enrichment: Sparkles, document: FileText, analysis: Calculator, system: Bot };
const ACTIVITY_LABELS: Record<string, string> = { call: "Call", sms: "Text message", email: "Email", note: "Note", stage_change: "Stage change", offer: "Offer", task: "Task", enrichment: "Property report", document: "Document", analysis: "Analysis", system: "System" };
const STATUS_TONE: Record<string, BadgeTone> = { draft: "neutral", reviewing: "info", approved_for_offer: "good", rejected: "bad" };
const CONSENT: Record<string, { text: string; tone: BadgeTone }> = { opted_in: { text: "SMS opted in", tone: "good" }, opted_out: { text: "SMS opted out", tone: "bad" }, unknown: { text: "SMS consent unknown", tone: "neutral" } };
const URGENCY_TONE: Record<string, BadgeTone> = { immediate: "bad", high: "warn", medium: "info", low: "neutral", none: "neutral" };

type LoadState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: LeadQuickView };
export type LeadPatch = Partial<Pick<BoardLead, "nextFollowUpAt" | "attempts" | "analysisId" | "analysisMao" | "analysisSpread">>;

function dueTone(tone: "bad" | "warn" | "good" | "muted"): BadgeTone {
  return tone === "bad" ? "bad" : tone === "warn" ? "warn" : tone === "good" ? "good" : "neutral";
}

/** Tomorrow at 9:00 in the viewer's time zone, formatted for a datetime-local input. */
function defaultDue(): string {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LeadQuickViewDrawer({ lead, stages, canMove, canAnalyze, onClose, onStageChange, onLeadPatch }: {
  lead: BoardLead | null; stages: BoardStage[]; canMove: boolean; canAnalyze: boolean; onClose: () => void;
  onStageChange: (leadId: string, stageId: string) => Promise<ActionResult>; onLeadPatch: (leadId: string, patch: LeadPatch) => void;
}) {
  return (
    <Dialog open={lead !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      {lead ? <DrawerBody key={lead.id} lead={lead} stages={stages} canMove={canMove} canAnalyze={canAnalyze} onStageChange={onStageChange} onLeadPatch={onLeadPatch} /> : null}
    </Dialog>
  );
}

function DrawerBody({ lead, stages, canMove, canAnalyze, onStageChange, onLeadPatch }: {
  lead: BoardLead; stages: BoardStage[]; canMove: boolean; canAnalyze: boolean;
  onStageChange: (leadId: string, stageId: string) => Promise<ActionResult>; onLeadPatch: (leadId: string, patch: LeadPatch) => void;
}) {
  const leadId = lead.id;
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [stageError, setStageError] = useState<string | null>(null);
  const [stagePending, setStagePending] = useState(false);
  const requestRef = useRef(0);
  const patchRef = useRef(onLeadPatch);
  patchRef.current = onLeadPatch;

  const load = useCallback(async (showSkeleton: boolean) => {
    const request = ++requestRef.current;
    if (showSkeleton) setState({ status: "loading" });
    try {
      const res = await getLeadQuickView(leadId);
      if (request !== requestRef.current) return;
      if (!res.ok) { setState({ status: "error", error: res.error }); return; }
      setState({ status: "ready", data: res.data });
      patchRef.current(leadId, { nextFollowUpAt: res.data.nextFollowUpAt, attempts: res.data.contactAttempts, analysisId: res.data.analysis?.id ?? null, analysisMao: res.data.analysis?.maxAllowableOffer ?? null, analysisSpread: res.data.analysis?.spread ?? null });
    } catch {
      if (request === requestRef.current) setState({ status: "error", error: "Could not load this lead. Check the connection and try again." });
    }
  }, [leadId]);

  useEffect(() => {
    void load(true);
    return () => { requestRef.current++; };
  }, [load]);

  const refresh = useCallback(() => { void load(false); }, [load]);

  async function changeStage(stageId: string) {
    if (stageId === lead.stageId) return;
    setStageError(null); setStagePending(true);
    const res = await onStageChange(leadId, stageId);
    setStagePending(false);
    if (!res.ok) setStageError(res.error); else refresh();
  }

  const stage = stages.find((s) => s.id === lead.stageId);
  const due = dueLabel(state.status === "ready" ? state.data.nextFollowUpAt : lead.nextFollowUpAt);
  const data = state.status === "ready" ? state.data : null;
  const analysisId = data ? data.analysis?.id ?? null : lead.analysisId;
  const linkButton = buttonVariants({ variant: "outline", size: "sm" });

  return (
    <DrawerContent
      title={lead.address}
      description={data ? `${data.city}, ${data.state} ${data.postalCode}` : lead.city}
      headerExtra={
        <div className="flex flex-wrap items-center gap-1.5">
          {stage ? <StageBadge name={stage.name} color={stage.color} /> : null}
          <Badge tone={dueTone(due.tone)}>{due.text}</Badge>
          {lead.urgency && lead.urgency !== "none" ? <Badge tone={URGENCY_TONE[lead.urgency] ?? "neutral"}>{lead.urgency} urgency</Badge> : null}
          {lead.attempts === 0 ? <Badge tone="bad">Untouched</Badge> : null}
        </div>
      }
    >
      <div className="space-y-5">
        <section aria-label="Quick actions" className="flex flex-wrap gap-2">
          <Link href={`/leads/${leadId}`} className={buttonVariants({ variant: "primary", size: "sm" })}><ExternalLink className="h-3.5 w-3.5" />Open lead</Link>
          {analysisId ? <Link href={`/analyzer/${analysisId}`} className={linkButton}><Calculator className="h-3.5 w-3.5" />Open analyzer</Link> : null}
          {!analysisId && data && canAnalyze ? <CreateAnalysisForm propertyId={data.propertyId} leadId={leadId} size="sm" variant="outline" /> : null}
          <Link href={`/properties/${lead.propertyId}/report`} className={linkButton}><FileText className="h-3.5 w-3.5" />Property report</Link>
          <Link href={`/leads/${leadId}?tab=messages`} className={linkButton}><MessageSquare className="h-3.5 w-3.5" />Messages</Link>
        </section>

        {state.status === "loading" ? <QuickViewSkeleton /> : null}
        {state.status === "error" ? (
          <Alert tone="bad">
            <div>{state.error}</div>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void load(true)}>Try again</Button>
          </Alert>
        ) : null}

        {data ? (
          <>
            <Section title="Deal numbers" aside={data.analysis ? <Link href={`/analyzer/${data.analysis.id}`} className="text-xs text-brand hover:underline">Open analyzer</Link> : null}>
              {data.analysis ? (
                <div>
                  <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                    <span className="text-[13px] font-medium">v{data.analysis.version} {data.analysis.name}</span>
                    {data.analysis.isPrimary ? <Badge tone="brand">Primary</Badge> : <Badge tone="neutral">Latest</Badge>}
                    <Badge tone={STATUS_TONE[data.analysis.status] ?? "neutral"}>{data.analysis.status.replace(/_/g, " ")}</Badge>
                  </div>
                  <Stat label="ARV" value={money(data.analysis.arv) || "n/a"} />
                  <Stat label="Proposed offer" value={money(data.analysis.purchasePrice) || "n/a"} />
                  <Stat label="Max allowable offer" value={money(data.analysis.maxAllowableOffer) || "n/a"} />
                  <Stat label="Spread" value={money(data.analysis.spread) || "n/a"} tone={data.analysis.spread == null ? "muted" : data.analysis.spread > 0 ? "good" : "bad"} />
                  <Stat label="Flip net profit" value={money(data.analysis.netProfit) || "n/a"} tone={data.analysis.netProfit == null ? "muted" : data.analysis.netProfit > 0 ? "good" : "bad"} />
                  <Stat label="Offer as % of ARV" value={data.analysis.offerPctOfArv != null ? percent(data.analysis.offerPctOfArv) : "n/a"} />
                  {data.analysis.purchasePrice != null && data.analysis.maxAllowableOffer != null && data.analysis.purchasePrice > data.analysis.maxAllowableOffer ? (
                    <p className="mt-2 flex items-center gap-1 text-xs text-warn"><AlertTriangle className="h-3 w-3 shrink-0" />Offer is {money(data.analysis.purchasePrice - data.analysis.maxAllowableOffer)} above the max allowable offer.</p>
                  ) : null}
                  <p className="mt-2 text-xs text-fg-3">Updated {relative(data.analysis.updatedAt)}{data.analysisCount > 1 ? `. ${data.analysisCount} versions on this property.` : "."}</p>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border bg-surface-2/60 px-4 py-5 text-center">
                  <Calculator className="h-5 w-5 text-fg-3 mx-auto" />
                  <div className="text-[13px] font-medium mt-2">No analysis yet</div>
                  <p className="text-xs text-fg-3 mt-1">Run the deal analyzer on this property to see ARV, max allowable offer, and spread here.</p>
                  {canAnalyze ? <div className="mt-3 flex justify-center"><CreateAnalysisForm propertyId={data.propertyId} leadId={leadId} size="md" variant="primary" /></div> : <p className="text-xs text-fg-3 mt-2">Your role cannot create analyses.</p>}
                </div>
              )}
            </Section>

            <Section title="Seller">
              {data.contact ? (
                <div className="space-y-1.5 text-[13px]">
                  <div className="font-medium">{data.contact.name || "No name on file"}</div>
                  {data.contact.phone ? <a href={`tel:${data.contact.phone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-2 text-brand hover:underline w-fit"><Phone className="h-3.5 w-3.5" />{data.contact.phone}</a> : <div className="flex items-center gap-2 text-fg-3"><Phone className="h-3.5 w-3.5" />No phone on file</div>}
                  {data.contact.email ? <a href={`mailto:${data.contact.email}`} className="flex items-center gap-2 text-brand hover:underline w-fit break-all"><Mail className="h-3.5 w-3.5 shrink-0" />{data.contact.email}</a> : <div className="flex items-center gap-2 text-fg-3"><Mail className="h-3.5 w-3.5" />No email on file</div>}
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    <Badge tone={(CONSENT[data.contact.smsConsent] ?? CONSENT.unknown!).tone}>{(CONSENT[data.contact.smsConsent] ?? CONSENT.unknown!).text}</Badge>
                    {data.contact.doNotContact ? <Badge tone="bad">Do not contact</Badge> : null}
                  </div>
                </div>
              ) : <p className="text-[13px] text-fg-3">No primary contact on this lead.</p>}
            </Section>

            <Section title="Lead">
              <Stat label="Next follow up" value={due.text} tone={due.tone === "bad" ? "bad" : due.tone === "warn" ? "warn" : undefined} />
              <Stat label="Contact attempts" value={data.contactAttempts} tone={data.contactAttempts === 0 ? "bad" : undefined} />
              <Stat label="Last contact" value={data.lastContactAt ? relative(data.lastContactAt) : "Never"} />
              <Stat label="Asking price" value={money(data.askingPrice) || "Not given"} />
              <Stat label="Source" value={data.source ?? "Unknown"} />
              <Stat label="Assigned to" value={data.assignedName ?? "Unassigned"} />
              <Stat label="Urgency" value={<span className="capitalize">{data.urgency}</span>} />
              <Stat label="Messy score" value={data.messyScore} tone={data.messyScore > 0 ? "warn" : undefined} hint={data.issues.length ? data.issues.map((k) => k.replace(/_/g, " ")).join(", ") : undefined} />
              {data.issues.length ? <p className="text-xs text-fg-3 mt-1.5">Flagged: {data.issues.map((k) => k.replace(/_/g, " ")).join(", ")}</p> : null}
              {data.tags.length ? <div className="flex flex-wrap gap-1.5 mt-2">{data.tags.map((t) => <Badge key={`${t.kind}:${t.name}`} tone={t.kind === "issue" ? "warn" : "brand"}>{t.name}</Badge>)}</div> : null}
            </Section>

            {canMove ? (
              <Section title="Update">
                <div className="space-y-4">
                  <Field label="Stage">
                    <Select value={lead.stageId} disabled={stagePending} onChange={(e) => void changeStage(e.target.value)} aria-label="Pipeline stage">
                      {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                    {stageError ? <p className="mt-1 text-xs text-bad">{stageError}</p> : null}
                  </Field>
                  <ActionForm action={addActivity.bind(null, leadId)} submitLabel="Log note" variant="outline" size="sm" resetOnSuccess onSuccess={refresh}>
                    <input type="hidden" name="type" value="note" />
                    <Field label="Log a note"><Textarea name="text" placeholder="What the seller said, what is wrong with the house" required /></Field>
                  </ActionForm>
                  <FollowUpForm leadId={leadId} onSuccess={refresh} />
                </div>
              </Section>
            ) : null}

            <Section title="Recent activity" aside={<Link href={`/leads/${leadId}?tab=activity`} className="text-xs text-brand hover:underline">Full timeline</Link>}>
              {data.activities.length === 0 ? <p className="text-[13px] text-fg-3">Nothing logged yet.</p> : (
                <ul className="space-y-2.5">
                  {data.activities.map((a) => {
                    const Icon = ACTIVITY_ICONS[a.type] ?? Bot;
                    return (
                      <li key={a.id} className="flex gap-2.5">
                        <div className="h-6 w-6 rounded-full bg-surface-2 border border-border flex items-center justify-center shrink-0"><Icon className="h-3 w-3 text-fg-3" /></div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs font-medium">{ACTIVITY_LABELS[a.type] ?? a.type.replace(/_/g, " ")}</span>
                            <span className="text-[11px] text-fg-3 shrink-0">{relative(a.occurredAt)}</span>
                          </div>
                          {a.text ? <p className="text-[13px] text-fg-2 line-clamp-3 whitespace-pre-wrap break-words">{a.text}</p> : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          </>
        ) : null}
      </div>
    </DrawerContent>
  );
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function FollowUpForm({ leadId, onSuccess }: { leadId: string; onSuccess: () => void }) {
  const [due] = useState(defaultDue);
  // The datetime-local value has no time zone. Convert it in the browser so the server stores the time the user meant.
  const action = useCallback(async (form: FormData) => {
    const value = String(form.get("dueAt") ?? "");
    if (value) { const parsed = new Date(value); if (!Number.isNaN(parsed.getTime())) form.set("dueAt", parsed.toISOString()); }
    return addTask(leadId, form);
  }, [leadId]);
  return (
    <ActionForm action={action} submitLabel="Add task" variant="outline" size="sm" resetOnSuccess onSuccess={onSuccess}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Add follow up task" className="col-span-2"><Input name="title" defaultValue="Follow up call" required /></Field>
        <Field label="Due"><Input name="dueAt" type="datetime-local" defaultValue={due} /></Field>
        <Field label="Type"><Select name="kind" defaultValue="call"><option value="call">Call</option><option value="text">Text</option><option value="email">Email</option><option value="visit">Visit</option><option value="other">Other</option></Select></Field>
      </div>
    </ActionForm>
  );
}

function CreateAnalysisForm({ propertyId, leadId, size, variant }: { propertyId: string; leadId: string; size: "sm" | "md"; variant: "primary" | "outline" }) {
  return (
    <form action={createAnalysis.bind(null, propertyId, leadId)}>
      <CreateAnalysisSubmit size={size} variant={variant} />
    </form>
  );
}

function CreateAnalysisSubmit({ size, variant }: { size: "sm" | "md"; variant: "primary" | "outline" }) {
  const { pending } = useFormStatus();
  return <Button type="submit" size={size} variant={variant} loading={pending}>{pending ? null : <Calculator className="h-3.5 w-3.5" />}Create analysis</Button>;
}

function QuickViewSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading lead">
      {[6, 3, 5].map((rows, i) => (
        <div key={i}>
          <Skeleton className="h-3 w-24 mb-3" />
          <div className="space-y-2">{Array.from({ length: rows }).map((_, j) => <div key={j} className="flex justify-between gap-6"><Skeleton className="h-4 w-28" /><Skeleton className={cn("h-4", j % 2 ? "w-16" : "w-24")} /></div>)}</div>
        </div>
      ))}
    </div>
  );
}
