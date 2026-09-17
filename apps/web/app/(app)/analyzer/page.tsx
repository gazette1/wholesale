import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { listAnalyses } from "@/lib/data/analyses";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { money, percent, relative, cn } from "@/lib/utils";
import { Calculator } from "lucide-react";

export const metadata = { title: "Deal Analyzer" };
const TONE: Record<string, "neutral" | "info" | "good" | "bad"> = { draft: "neutral", reviewing: "info", approved_for_offer: "good", rejected: "bad" };

export default async function AnalyzerListPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await requireSession();
  const { status = "all" } = await searchParams;
  const rows = await listAnalyses(session.orgId, status);
  return (
    <>
      <PageHeader title="Deal Analyzer" description="Every analysis belongs to a property. Create new ones from a lead's Analyzer tab." />
      <div className="flex gap-1.5 mb-3 text-xs">
        {["all", "draft", "reviewing", "approved_for_offer", "rejected"].map((s) => (
          <Link key={s} href={`/analyzer?status=${s}`} className={cn("rounded-full border px-2.5 py-1", status === s ? "bg-accent text-accent-fg border-accent" : "border-border bg-surface hover:bg-surface-2")}>{s === "all" ? "All" : s.replace(/_/g, " ")}</Link>
        ))}
      </div>
      {rows.length === 0 ? <EmptyState icon={Calculator} title="No analyses" description="Open a lead and create one from the Analyzer tab." /> : (
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <Table>
            <THead><tr><TH>Property</TH><TH>Version</TH><TH>Status</TH><TH right>ARV</TH><TH right>Offer</TH><TH right>MAO</TH><TH right>Spread</TH><TH right>Flip net</TH><TH right>% ARV</TH><TH>By</TH><TH>Updated</TH></tr></THead>
            <TBody>
              {rows.map((a) => (
                <TR key={a.id}>
                  <TD><Link href={`/analyzer/${a.id}`} className="font-medium hover:underline">{a.address}</Link><div className="text-xs text-fg-3">{a.city}, {a.state}</div></TD>
                  <TD>v{a.version} {a.name}{a.isPrimary ? <Badge tone="brand" className="ml-1">Primary</Badge> : null}</TD>
                  <TD><Badge tone={TONE[a.status] ?? "neutral"}>{a.status.replace(/_/g, " ")}</Badge></TD>
                  <TD right>{money(a.arv)}</TD><TD right>{money(a.purchasePrice)}</TD><TD right>{money(a.maxAllowableOffer)}</TD>
                  <TD right className={Number(a.spread) > 0 ? "text-good" : "text-bad"}>{money(a.spread)}</TD>
                  <TD right className={Number(a.netProfit) > 0 ? "text-good" : "text-bad"}>{money(a.netProfit)}</TD>
                  <TD right>{a.arv && a.purchasePrice ? percent(Number(a.purchasePrice) / Number(a.arv)) : ""}</TD>
                  <TD className="text-fg-3">{a.createdBy ?? ""}</TD><TD className="text-fg-3">{relative(a.updatedAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </>
  );
}
