import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, can } from "@/lib/auth";
import { compsWorkspace } from "@/lib/data/comps";
import { PageHeader } from "@/components/ui/misc";
import { isUuid } from "@/lib/safe";
import { dayKey } from "@/lib/utils";
import { CompsWorkspaceView } from "./workspace";

export const metadata = { title: "Comps and ARV" };

export default async function CompsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const workspace = await compsWorkspace(session.orgId, id);
  if (!workspace) notFound();
  const { property, lead, subject, rows, analysis } = workspace;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Leads", href: "/leads" }, ...(lead ? [{ label: property.addressLine1, href: `/leads/${lead.id}` }] : []), { label: "Property report", href: `/properties/${id}/report` }, { label: "Comps and ARV" }]}
        title={property.addressLine1}
        description={`${property.city}, ${property.state} ${property.postalCode}${property.sqft ? ` · ${property.sqft} sq ft` : ""}${property.yearBuilt ? ` · built ${property.yearBuilt}` : ""}`}
        actions={<Link href={`/properties/${id}/report`} className="text-[13px] text-brand hover:underline">Back to the property report</Link>}
      />
      <CompsWorkspaceView
        propertyId={id}
        subject={subject}
        comps={rows.map((r) => ({ input: r.input, source: r.row.source, notes: r.row.notes ?? "" }))}
        asOf={dayKey(new Date())}
        analysis={analysis}
        canEdit={can(session, "lead:write")}
        canWriteAnalysis={can(session, "analysis:write")}
      />
    </>
  );
}
