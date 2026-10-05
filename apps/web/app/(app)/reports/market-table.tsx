"use client";
import { useMemo, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { money, num, percent } from "@/lib/utils";
import type { MarketRow } from "@/lib/data/reports";

type ColumnKey = "key" | "leads" | "contactRate" | "offersMade" | "offerAcceptanceRate" | "contracts" | "avgSpread" | "avgAssignmentFee" | "medianAsking";

const COLUMNS: { key: ColumnKey; label: string; right?: boolean }[] = [
  { key: "key", label: "Area" },
  { key: "leads", label: "Leads", right: true },
  { key: "contactRate", label: "Contact rate", right: true },
  { key: "offersMade", label: "Offers made", right: true },
  { key: "offerAcceptanceRate", label: "Offer acceptance", right: true },
  { key: "contracts", label: "Contracts", right: true },
  { key: "avgSpread", label: "Avg spread", right: true },
  { key: "avgAssignmentFee", label: "Avg assignment fee", right: true },
  { key: "medianAsking", label: "Median asking", right: true },
];

/** A figure that cannot be computed yet. The reason shows on hover and to screen readers. */
function NotAvailable({ reason }: { reason: string }) {
  return <span className="text-fg-3" title={reason}>Not available yet<span className="sr-only">. {reason}</span></span>;
}

/** Nulls (not available yet) always sort to the bottom, in either direction, so a missing figure never reads as a zero. */
function compareRows(a: MarketRow, b: MarketRow, key: ColumnKey): number {
  const av = a[key], bv = b[key];
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv));
  return (av as number) - (bv as number);
}

export function MarketTable({ rows, emptyLabel }: { rows: MarketRow[]; emptyLabel: string }) {
  const [sort, setSort] = useState<{ key: ColumnKey; dir: "asc" | "desc" }>({ key: "leads", dir: "desc" });
  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => (sort.dir === "asc" ? compareRows(a, b, sort.key) : -compareRows(a, b, sort.key)));
    return copy;
  }, [rows, sort]);
  const toggle = (key: ColumnKey) => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));

  if (rows.length === 0) return <p className="text-xs text-fg-3 px-4 py-3">{emptyLabel}</p>;

  return (
    <Table>
      <THead>
        <tr>
          {COLUMNS.map((c) => (
            <TH key={c.key} right={c.right}>
              <button type="button" onClick={() => toggle(c.key)} className="inline-flex items-center gap-1 hover:text-fg">{c.label}<ArrowUpDown className="h-3 w-3" /></button>
            </TH>
          ))}
        </tr>
      </THead>
      <TBody>
        {sorted.map((r) => (
          <TR key={r.key}>
            <TD>{r.key}{r.lowSample ? <span className="ml-1.5 text-fg-3" title="Fewer than 5 leads. Rates on this row are not a reliable sample.">· small sample</span> : null}</TD>
            <TD right>{num(r.leads)}</TD>
            <TD right>{r.contactRate === null ? <NotAvailable reason="No leads here yet." /> : percent(r.contactRate)}</TD>
            <TD right>{num(r.offersMade)}</TD>
            <TD right>{r.offerAcceptanceRate === null ? <NotAvailable reason="No offers made here yet." /> : percent(r.offerAcceptanceRate)}</TD>
            <TD right>{num(r.contracts)}</TD>
            <TD right>{r.avgSpread === null ? <NotAvailable reason="No primary analysis with a spread on a property here." /> : money(r.avgSpread)}</TD>
            <TD right>{r.avgAssignmentFee === null ? <NotAvailable reason="No primary analysis with an assignment fee on a property here." /> : money(r.avgAssignmentFee)}</TD>
            <TD right>{r.medianAsking === null ? <NotAvailable reason="No lead here has an asking price recorded." /> : money(r.medianAsking)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
