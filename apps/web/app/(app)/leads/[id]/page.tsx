import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, can } from "@/lib/auth";
import { getLead, listStages, listProfiles, listSources, listTags } from "@/lib/data/leads";
import { listLeadCalls } from "@/lib/data/calls";
import { templatesFor } from "@/lib/services/messaging";
import { listCampaigns } from "@/lib/data/campaigns";
import { PageHeader, TabNav, KeyValue, Alert } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge, StageBadge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { money, fullName, addressLine, relative, dueLabel, shortDate } from "@/lib/utils";
import { LeadHeaderControls } from "./header-controls";
import { OverviewTab } from "./tabs/overview";
import { ActivityTab } from "./tabs/activity";
import { MessagesTab } from "./tabs/messages";
import { ReportSummary } from "@/components/report/report-summary";
import { AnalyzerTab } from "./tabs/analyzer";
import { OffersTab } from "./tabs/offers";
import { DocumentsTab } from "./tabs/documents";
import { CallsTab } from "./tabs/calls";
import { runEnrichment, deleteLead } from "@/lib/actions/leads";
import type { ActionResult } from "@/lib/actions/leads";
import { ActionButton, SubmitOnce } from "@/components/ui/action-form";
import { Phone, MessageSquare, Mail, ExternalLink, Calculator } from "lucide-react";
import { createAnalysis } from "@/lib/actions/analyzer";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: "Lead" };
}

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  // An unknown tab name falls back to the overview instead of an empty page.
  const tab = ["overview", "activity", "messages", "calls", "report", "analyzer", "offers", "documents"].includes(tabParam ?? "") ? tabParam! : "overview";
  const detail = await getLead(session.orgId, id);
  if (!detail) notFound();
  const [stages, team, sources, tagList, templates, campaigns] = await Promise.all([listStages(session.orgId), listProfiles(session.orgId), listSources(session.orgId), listTags(session.orgId), templatesFor(session.orgId), listCampaigns(session.orgId)]);
  const leadCalls = tab === "calls" ? await listLeadCalls(session.orgId, id) : [];
  const { lead, property, stage, primaryContact } = detail;
  const primaryAnalysis = detail.analyses.find((a) => a.isPrimary) ?? detail.analyses[0] ?? null;
  const due = dueLabel(lead.nextFollowUpAt);
  const phone = primaryContact?.phones.find((p) => p.isPrimary)?.number ?? primaryContact?.phones[0]?.number;
  const email = primaryContact?.emails.find((e) => e.isPrimary)?.address ?? primaryContact?.emails[0]?.address;
  const writable = can(session, "lead:write");
  const tabs = [
    { key: "overview", label: "Overview" }, { key: "activity", label: "Activity", count: detail.activities.length }, { key: "messages", label: "Messages", count: detail.messages.length }, { key: "calls", label: "Calls" },
    { key: "report", label: "Property report" }, { key: "analyzer", label: "Analyzer", count: detail.analyses.length }, { key: "offers", label: "Offers", count: detail.offers.length }, { key: "documents", label: "Documents", count: detail.documents.length },
  ].map((t) => ({ ...t, href: `/leads/${id}?tab=${t.key}` }));

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Leads", href: "/leads" }, { label: property.city }]}
        title={<span className="flex items-center gap-3 flex-wrap">{property.addressLine1}<StageBadge name={stage.name} color={stage.color} /></span>}
        description={<span>{property.city}, {property.state} {property.postalCode} · {fullName(primaryContact) || "No contact"}{phone ? ` · ${phone}` : ""} · {detail.source?.name ?? "Unknown source"} · added {relative(lead.createdAt)}</span>}
        actions={
          <>
            {phone ? <LinkButton external href={`tel:${phone}`} variant="outline"><Phone className="h-4 w-4" />Call</LinkButton> : null}
            <LinkButton href={`/leads/${id}?tab=messages`} variant="outline"><MessageSquare className="h-4 w-4" />Text</LinkButton>
            {email ? <LinkButton href={`/leads/${id}?tab=messages&channel=email`} variant="outline"><Mail className="h-4 w-4" />Email</LinkButton> : null}
            <LinkButton href={`/properties/${property.id}/report`} variant="ghost"><ExternalLink className="h-4 w-4" />Report</LinkButton>
            {primaryAnalysis
              ? <LinkButton href={`/analyzer/${primaryAnalysis.id}`} variant="primary"><Calculator className="h-4 w-4" />Analyze deal</LinkButton>
              : can(session, "analysis:write") ? <form action={createAnalysis.bind(null, property.id, id)}><SubmitOnce><Calculator className="h-4 w-4" />Analyze deal</SubmitOnce></form> : null}
          </>
        }
      />
      <LeadHeaderControls leadId={id} stageId={lead.stageId} stages={stages.map((s) => ({ id: s.id, name: s.name, color: s.color }))} assignedTo={lead.assignedTo} team={team.map((p) => ({ id: p.id, name: p.fullName }))} nextFollowUpAt={lead.nextFollowUpAt?.toISOString() ?? null} dueText={due.text} dueTone={due.tone} canWrite={writable} />
      {primaryContact?.smsConsent === "opted_out" || primaryContact?.doNotContact ? <Alert tone="bad" className="mt-3">This contact opted out{primaryContact.doNotContact ? " and is marked do not contact" : " of SMS"}. Outbound texting is blocked.</Alert> : null}
      <div className="mt-4"><TabNav tabs={tabs} current={tab} /></div>
      <div className="mt-4">
        {tab === "overview" ? <OverviewTab detail={detail} sources={sources} tags={tagList} canWrite={writable} /> : null}
        {tab === "activity" ? <ActivityTab detail={detail} team={team.map((p) => ({ id: p.id, name: p.fullName }))} sessionProfileId={session.profileId} /> : null}
        {tab === "messages" ? <MessagesTab detail={detail} templates={templates} campaigns={campaigns} canSend={can(session, "message:send")} /> : null}
        {tab === "calls" ? <CallsTab detail={detail} calls={leadCalls} canCall={can(session, "message:send")} /> : null}
        {tab === "report" ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] text-fg-3">{detail.report ? `Last pulled ${relative(detail.report.fetchedAt)} from ${detail.report.provider}.` : "No property report yet."}</p>
              <div className="flex items-center gap-2">
                {writable ? <ActionButton action={runEnrichment.bind(null, property.id, id)}>{detail.report ? "Refresh report" : "Pull report"}</ActionButton> : null}
                <LinkButton href={`/properties/${property.id}/report`} variant="outline" size="sm">Full report</LinkButton>
              </div>
            </div>
            {detail.report ? <ReportSummary report={detail.report} /> : <Card><CardBody className="text-[13px] text-fg-3">Pull the report to see ownership, value, mortgage, tax, and distress signals here.</CardBody></Card>}
          </div>
        ) : null}
        {tab === "analyzer" ? <AnalyzerTab detail={detail} canWrite={can(session, "analysis:write")} /> : null}
        {tab === "offers" ? <OffersTab detail={detail} canWrite={writable} /> : null}
        {tab === "documents" ? <DocumentsTab detail={detail} canWrite={writable} sessionProfileId={session.profileId} isAdmin={session.role === "admin"} /> : null}
      </div>
      {session.role === "admin" ? (
        <div className="mt-8 pt-4 border-t border-border flex items-center justify-between gap-3">
          <p className="text-xs text-fg-3">Deleting removes this lead, its timeline, tasks, offers, and messages. The property, its analyses, and the contact are removed too when no other lead uses them.</p>
          <ActionButton action={deleteLead.bind(null, id) as () => Promise<ActionResult>} variant="ghost" className="text-bad shrink-0" confirm={`Delete the lead at ${property.addressLine1} for good? This cannot be undone.`}>Delete lead</ActionButton>
        </div>
      ) : null}
    </>
  );
}
