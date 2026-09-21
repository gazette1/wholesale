import Link from "next/link";
import { requireSession, can } from "@/lib/auth";
import { listReviewQueue } from "@/lib/services/lead-scoring";
import { acceptLeadScore, overrideLeadScore } from "@/lib/actions/lead-scores";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ActionForm, ActionButton } from "@/components/ui/action-form";
import { Input } from "@/components/ui/input";
import { relative } from "@/lib/utils";
import { Sparkles } from "lucide-react";

export const metadata = { title: "Review queue" };

const TONE: Record<string, BadgeTone> = { needs_review: "warn", suggested: "neutral" };

export default async function ReviewPage() {
  const session = await requireSession();
  const rows = await listReviewQueue(session.orgId);
  const canWrite = can(session, "lead:write");
  return (
    <>
      <PageHeader title="Review queue" description="Lead scores the scorer was not confident enough to apply on its own. Accept the score, or override it with your own number from 0 to 100." />
      {rows.length === 0 ? (
        <EmptyState icon={Sparkles} title="Nothing waiting for review" description="Every recent score was either confident enough to apply automatically, or has already been reviewed." />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardHeader
                title={<span className="flex items-center gap-2 flex-wrap"><Link href={`/leads/${r.leadId}`} className="hover:underline">{r.address}{r.city ? `, ${r.city}` : ""}</Link><Badge tone={TONE[r.reviewStatus] ?? "neutral"}>{r.reviewStatus.replace(/_/g, " ")}</Badge></span>}
                description={`Scored ${r.score} of 100, motivation ${r.motivation}, at ${Math.round(r.confidence * 100)}% confidence, ${relative(r.createdAt)}`}
              />
              <CardBody className="space-y-3">
                <ul className="list-disc pl-5 text-[13px] text-fg-2 space-y-0.5">
                  {r.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
                </ul>
                {canWrite ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <ActionButton action={acceptLeadScore.bind(null, r.id, r.leadId)} variant="primary" size="sm">Accept, motivation {r.motivation}</ActionButton>
                    <ActionForm action={overrideLeadScore.bind(null, r.id, r.leadId)} submitLabel="Override" size="sm" inline>
                      <Input name="overrideScore" type="number" min={1} max={10} step={1} defaultValue={r.motivation} className="h-8 w-16 inline-block mr-2" aria-label="Override motivation (1 to 10)" />
                    </ActionForm>
                  </div>
                ) : <p className="text-xs text-fg-3">Your role cannot review scores.</p>}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
