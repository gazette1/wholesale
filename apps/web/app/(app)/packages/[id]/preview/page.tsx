import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, can } from "@/lib/auth";
import { packageData, SECTION_LABELS } from "@/lib/services/packages";
import { updatePackageSections } from "@/lib/actions/packages";
import { ActionForm } from "@/components/ui/action-form";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { PackagePreview } from "@/components/package/preview";
import { CopyButton } from "./copy";

export const metadata = { title: "Deal package" };

export default async function PackagePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const result = await packageData(id);
  if (!result || result.orgId !== session.orgId) notFound();
  const { pkg, data } = result;
  const shareUrl = `${process.env.APP_URL ?? "http://localhost:3000"}/share/${pkg.shareToken}`;
  return (
    <>
      <PageHeader crumbs={[{ label: "Deal Analyzer", href: "/analyzer" }, { label: "Analysis", href: `/analyzer/${pkg.analysisId}` }, { label: `Package v${pkg.version}` }]} title={`Deal package: ${data.property.address}`} description="Investor facing summary. Download the PDF or share the link."
        actions={<>
          <a href={`/api/packages/${pkg.id}/pdf`} target="_blank" rel="noreferrer"><Button variant="primary">Download PDF</Button></a>
          <CopyButton text={shareUrl} />
          <Link href={`/buyers/match/${pkg.analysisId}?package=${pkg.id}`}><Button variant="outline">Send to matched buyers</Button></Link>
        </>} />
      <div className="grid gap-4 lg:grid-cols-4">
        <div className="lg:col-span-3"><PackagePreview data={data} /></div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Sections" />
            <CardBody>
              {can(session, "buyer:write") ? (
                <ActionForm action={updatePackageSections.bind(null, pkg.id)} submitLabel="Apply" variant="outline" size="sm" className="space-y-2">
                  {Object.entries(data.sections).map(([k, v]) => <label key={k} className="flex items-center gap-2 text-[13px]"><input type="checkbox" name={`section_${k}`} defaultChecked={v} className="h-4 w-4" />{SECTION_LABELS[k as keyof typeof SECTION_LABELS] ?? k}</label>)}
                  <Field label="Share link expires in (days, 0 for never)"><Input name="expiresDays" type="number" defaultValue={pkg.expiresAt ? Math.max(1, Math.round((pkg.expiresAt.getTime() - Date.now()) / 86_400_000)) : 0} /></Field>
                </ActionForm>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Share link" description="Read only, no login required" />
            <CardBody className="text-xs break-all text-fg-2">{shareUrl}</CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
