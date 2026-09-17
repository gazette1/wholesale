import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, can } from "@/lib/auth";
import { getLead, listStages, listProfiles, listSources, listTags } from "@/lib/data/leads";
import { templatesFor } from "@/lib/services/messaging";
import { listCampaigns } from "@/lib/data/campaigns";
import { PageHeader, TabNav, KeyValue, Alert } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge, StageBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { money, fullName, addressLine, relative, dueLabel, shortDate } from "@/lib/utils";
import { LeadHeaderControls } from "./header-controls";
import { OverviewTab } from "./tabs/overview";
import { ActivityTab } from "./tabs/activity";
import { MessagesTab } from "./tabs/messages";
import { ReportSummary } from "@/components/report/report-summary";
import { AnalyzerTab } from "./tabs/analyzer";
import { OffersTab } from "./tabs/offers";
import { runEnrichment } from "@/lib/actions/leads";
import { ActionButton } from "@/components/ui/action-form";
import { Phone, MessageSquare, Mail, ExternalLink } from "lucide-react";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: "Lead" };
}

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const detail = await getLead(session.orgId, id);
  if (!detail) notFound();
  const [stages, team, sources, tagList, templates, campaigns] = await Promise.all([listStages(session.orgId), listProfiles(session.orgId), listSources(session.orgId), listTags(session.orgId), templatesFor(session.orgId), listCampaigns(session.orgId)]);
  const { lead, property, stage, primaryContact } = detail;
  const due = dueLabel(lead.nextFollowUpAt);
  const phone = primaryContact?.phones.find((p) => p.isPrimary)?.number ?? primaryContact?.phones[0]?.number;
  const email = primaryContact?.emails.find((e) => e.isPrimary)?.address ?? primaryContact?.emails[0]?.address;
  const writable = can(session, "lead:write");
  const tabs = [
    { key: "overview", label: "Overview" }, { key: "activity", label: "Activity", count: detail.activities.length }, { key: "messages", label: "Messages", count: detail.messages.length },
    { key: "report", label: "Property report" }, { key: "analyzer", label: "Analyzer", count: detail.analyses.length }, { key: "offers", label: "Offers", count: detail.offers.length },
  ].map((t) => ({ ...t, href: `/leads/${id}?tab=${t.key}` }));

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Leads", href: "/leads" }, { label: property.city }]}
        title={<span className="flex items-center gap-3 flex-wrap">{property.addressLine1}<StageBadge name={stage.name} color={stage.color} /></span>}
        description={<span>{property.city}, {property.state} {property.postalCode} · {fullName(primaryContact) || "No contact"}{phone ? ` · ${phone}` : ""} · {detail.source?.name ?? "Unknown source"} · added {relative(lead.createdAt)}</span>}
        actions={
          <>
            {phone ? <a href={`tel:${phone}`}><Button variant="outline"><Phone className="h-4 w-4" />Call</Button></a> : null}
            <Link href={`/leads/${id}?tab=messages`}><Button variant="outline"><MessageSquare className="h-4 w-4" />Text</Button></Link>
            {email ? <Link href={`/leads/${id}?tab=messages&channel=email`}><Button variant="outline"><Mail className="h-4 w-4" />Email</Button></Link> : null}
            <Link href={`/properties/${property.id}/report`}><Button variant="ghost"><ExternalLink className="h-4 w-4" />Report</Button></Link>
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
        {tab === "report" ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] text-fg-3">{detail.report ? `Last pulled ${relative(detail.report.fetchedAt)} from ${detail.report.provider}.` : "No property report yet."}</p>
              <div className="flex items-center gap-2">
                {writable ? <ActionButton action={runEnrichment.bind(null, property.id, id)}>{detail.report ? "Refresh report" : "Pull report"}</ActionButton> : null}
                <Link href={`/properties/${property.id}/report`}><Button variant="outline" size="sm">Full report</Button></Link>
              </div>
            </div>
            {detail.report ? <ReportSummary report={detail.report} /> : <Card><CardBody className="text-[13px] text-fg-3">Pull the report to see ownership, value, mortgage, tax, and distress signals here.</CardBody></Card>}
          </div>
        ) : null}
        {tab === "analyzer" ? <AnalyzerTab detail={detail} canWrite={can(session, "analysis:write")} /> : null}
        {tab === "offers" ? <OffersTab detail={detail} canWrite={writable} /> : null}
      </div>
    </>
  );
}
