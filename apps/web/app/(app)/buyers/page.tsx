import Link from "next/link";
import { requireSession, can } from "@/lib/auth";
import { listBuyers } from "@/lib/data/buyers";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Button, LinkButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { money, percent, relative, fullName } from "@/lib/utils";
import { Plus, Building2 } from "lucide-react";

export const metadata = { title: "Buyers" };

export default async function BuyersPage({ searchParams }: { searchParams: Promise<{ q?: string; state?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const rows = await listBuyers(session.orgId, sp.q, sp.state);
  return (
    <>
      <PageHeader title="Buyers" description={`${rows.length} ${rows.length === 1 ? "investor" : "investors"}${sp.q || sp.state ? " match the filter" : " with a buy box on file"}`} actions={can(session, "buyer:write") ? <LinkButton href="/buyers/new" variant="primary"><Plus className="h-4 w-4" />New buyer</LinkButton> : null} />
      <form method="get" className="flex gap-2 mb-3">
        <Input name="q" defaultValue={sp.q} placeholder="Search company or name" aria-label="Search buyers" className="w-64" />
        <Input name="state" defaultValue={sp.state} placeholder="State" aria-label="State" className="w-20 uppercase" maxLength={2} />
        {sp.q || sp.state ? <Link href="/buyers" className="self-center text-xs text-brand hover:underline">Clear</Link> : null}
        <Button type="submit" variant="outline">Filter</Button>
      </form>
      {rows.length === 0 ? (sp.q || sp.state ? <EmptyState icon={Building2} title="No buyers match" description="Try a different name or state, or clear the filter." /> : <EmptyState icon={Building2} title="No buyers yet" description="Add the investors you sell to and their buy box, then match deals against them." />) : (
        <div className="rounded-lg border border-border bg-surface overflow-x-auto">
          <Table>
            <THead><tr><TH>Buyer</TH><TH>Markets</TH><TH>Types</TH><TH right>Price range</TH><TH right>Max % ARV</TH><TH>Funding</TH><TH>Condition</TH><TH right>Deals sent</TH><TH>Last contact</TH></tr></THead>
            <TBody>
              {rows.map(({ buyer, criteria, submissions }) => (
                <TR key={buyer.id} className={!buyer.active ? "opacity-50" : ""}>
                  <TD><Link href={`/buyers/${buyer.id}`} className="font-medium hover:underline">{buyer.company ?? fullName(buyer)}</Link><div className="text-xs text-fg-3">{buyer.company ? fullName(buyer) : ""}{buyer.phones[0] ? ` · ${buyer.phones[0].number}` : ""}</div></TD>
                  <TD>{criteria?.states.join(", ")}{criteria?.counties.length ? <div className="text-xs text-fg-3">{criteria.counties.join(", ")}</div> : null}</TD>
                  <TD className="text-xs">{criteria?.propertyTypes.join(", ")}</TD>
                  <TD right>{criteria?.priceMin || criteria?.priceMax ? `${money(criteria.priceMin)} to ${money(criteria.priceMax)}` : ""}</TD>
                  <TD right>{criteria?.arvPctMax ? percent(criteria.arvPctMax) : ""}</TD>
                  <TD><Badge tone={criteria?.funding === "cash" ? "good" : "neutral"}>{(criteria?.funding ?? "").replace(/_/g, " ")}</Badge>{criteria?.proofOfFundsOnFile ? <Badge tone="brand" className="ml-1">POF</Badge> : null}</TD>
                  <TD className="text-xs">{criteria?.conditionLevels.join(", ")}{criteria?.sightUnseen ? " · sight unseen" : ""}</TD>
                  <TD right>{submissions}</TD>
                  <TD className="text-fg-3">{buyer.lastContactedAt ? relative(buyer.lastContactedAt) : "never"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </>
  );
}
