import Link from "next/link";
import type { LeadDetail } from "@/lib/data/leads";
import { createAnalysis } from "@/lib/actions/analyzer";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { money, relative, percent } from "@/lib/utils";
import { Calculator } from "lucide-react";

const STATUS_TONE: Record<string, "neutral" | "info" | "good" | "bad"> = { draft: "neutral", reviewing: "info", approved_for_offer: "good", rejected: "bad" };

export function AnalyzerTab({ detail, canWrite }: { detail: LeadDetail; canWrite: boolean }) {
  const create = createAnalysis.bind(null, detail.property.id, detail.lead.id);
  return (
    <Card>
      <CardHeader title="Analyses" description="Each version is a scenario. Approve one to drive the offer." actions={canWrite ? <form action={create}><Button variant="primary" size="sm" type="submit">New analysis</Button></form> : null} />
      <CardBody className="p-0">
        {detail.analyses.length === 0 ? <div className="p-4"><EmptyState icon={Calculator} title="No analysis yet" description="Start from the property report and the workbook defaults, then adjust." action={canWrite ? <form action={create}><Button variant="primary" type="submit">Create base case</Button></form> : undefined} /></div> : (
          <Table>
            <THead><tr><TH>Version</TH><TH>Status</TH><TH right>ARV</TH><TH right>Offer</TH><TH right>MAO</TH><TH right>Spread</TH><TH right>Flip net</TH><TH right>% ARV</TH><TH>Updated</TH></tr></THead>
            <TBody>
              {detail.analyses.map((a) => (
                <TR key={a.id}>
                  <TD><Link href={`/analyzer/${a.id}`} className="font-medium hover:underline">v{a.version} {a.name}</Link>{a.isPrimary ? <Badge tone="brand" className="ml-2">Primary</Badge> : null}</TD>
                  <TD><Badge tone={STATUS_TONE[a.status] ?? "neutral"}>{a.status.replace(/_/g, " ")}</Badge></TD>
                  <TD right>{money(a.arv)}</TD>
                  <TD right>{money(a.purchasePrice)}</TD>
                  <TD right>{money(a.maxAllowableOffer)}</TD>
                  <TD right className={Number(a.spread) > 0 ? "text-good" : "text-bad"}>{money(a.spread)}</TD>
                  <TD right className={Number(a.netProfit) > 0 ? "text-good" : "text-bad"}>{money(a.netProfit)}</TD>
                  <TD right>{a.arv && a.purchasePrice ? percent(Number(a.purchasePrice) / Number(a.arv)) : ""}</TD>
                  <TD className="text-fg-3">{relative(a.updatedAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}
