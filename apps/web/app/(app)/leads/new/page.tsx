import { requireSession } from "@/lib/auth";
import { listProfiles, listSources } from "@/lib/data/leads";
import { PageHeader } from "@/components/ui/misc";
import { NewLeadForm } from "./form";

export const metadata = { title: "New lead" };

export default async function NewLeadPage() {
  const session = await requireSession();
  const [team, sources] = await Promise.all([listProfiles(session.orgId), listSources(session.orgId)]);
  return (
    <>
      <PageHeader title="New lead" description="Property first, then the seller. Enrichment runs after save if you leave it on." crumbs={[{ label: "Leads", href: "/leads" }, { label: "New" }]} />
      <NewLeadForm team={team.map((p) => ({ id: p.id, name: p.fullName }))} sources={sources.map((s) => ({ id: s.id, name: s.name }))} defaultAssignee={session.profileId} />
    </>
  );
}
