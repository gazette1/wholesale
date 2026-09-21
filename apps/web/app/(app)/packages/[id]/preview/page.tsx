import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, can } from "@/lib/auth";
import { packageData, SECTION_LABELS } from "@/lib/services/packages";
import { updatePackageSections, setShareLinkEnabled, createPackage } from "@/lib/actions/packages";
import { ActionForm, ActionButton, SubmitOnce } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { shortDate } from "@/lib/utils";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Button, LinkButton } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { PackagePreview } from "@/components/package/preview";
import { CopyButton } from "./copy";

export const metadata = { title: "Deal package" };

export default async function PackagePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const result = await packageData(id);
  if (!result || result.orgId !== session.orgId) notFound();
  const { pkg, data, expired } = result;
  const writable = can(session, "buyer:write");
  const shareUrl = `${process.env.APP_URL ?? "http://localhost:3000"}/share/${pkg.shareToken}`;
  return (
    <>
      <PageHeader crumbs={[{ label: "Deal Analyzer", href: "/analyzer" }, { label: "Analysis", href: `/analyzer/${pkg.analysisId}` }, { label: `Package v${pkg.version}` }]} title={`Deal package: ${data.property.address}`} description="Investor facing summary. Download the PDF or share the link."
        actions={<>
          <LinkButton external href={`/api/packages/${pkg.id}/pdf`} target="_blank" rel="noreferrer" variant="primary">Download PDF</LinkButton>
          <CopyButton text={shareUrl} />
          <LinkButton href={`/buyers/match/${pkg.analysisId}?package=${pkg.id}`} variant="outline">Send to matched buyers</LinkButton>
        </>} />
      {expired ? <Alert tone="warn" className="mb-3">The public link for this package is off. Buyers who open it see a not found page. Turn it back on in the Share link card.</Alert> : null}
      <div className="grid gap-4 lg:grid-cols-4">
        <div className="lg:col-span-3 min-w-0"><PackagePreview data={data} /></div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Sections" />
            <CardBody>
              {writable ? (
                <ActionForm action={updatePackageSections.bind(null, pkg.id)} submitLabel="Apply" variant="outline" size="sm" className="space-y-2">
                  {Object.entries(data.sections).map(([k, v]) => <label key={k} className="flex items-center gap-2 text-[13px]"><input type="checkbox" name={`section_${k}`} defaultChecked={v} className="h-4 w-4" />{SECTION_LABELS[k as keyof typeof SECTION_LABELS] ?? k}</label>)}
                  <Field label="Share link expires in (days, 0 for never)"><Input name="expiresDays" type="number" min={0} max={365} step={1} defaultValue={pkg.expiresAt ? (expired ? 30 : Math.max(1, Math.round((pkg.expiresAt.getTime() - Date.now()) / 86_400_000))) : 0} /></Field>
                </ActionForm>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Share link" description="Read only, no login required" actions={<Badge tone={expired ? "bad" : "good"}>{expired ? "Off" : pkg.expiresAt ? `On until ${shortDate(pkg.expiresAt)}` : "On, no expiry"}</Badge>} />
            <CardBody className="space-y-2">
              <div className={expired ? "text-xs break-all text-fg-3 line-through" : "text-xs break-all text-fg-2"}>{shareUrl}</div>
              {writable ? (expired
                ? <ActionButton action={setShareLinkEnabled.bind(null, pkg.id, true)} variant="outline">Turn the link on for 30 days</ActionButton>
                : <ActionButton action={setShareLinkEnabled.bind(null, pkg.id, false)} variant="ghost" className="text-bad" confirm="Turn off the public link? Anyone holding it will see a not found page.">Turn the link off</ActionButton>) : null}
            </CardBody>
          </Card>
          {writable ? (
            <Card>
              <CardHeader title={`Version ${pkg.version}`} description="A package is a snapshot of its analysis. Make a new version after the numbers change. Each version has its own link." />
              <CardBody><form action={createPackage.bind(null, pkg.analysisId)}><SubmitOnce variant="outline" size="sm">Create a new version</SubmitOnce></form></CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
