import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { listAlerts } from "@/lib/data/alerts";
import { markAlertRead, dismissAlert, markAllAlertsRead } from "@/lib/actions/alerts";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/ui/action-form";
import { relative, cn } from "@/lib/utils";
import { Bell } from "lucide-react";

export const metadata = { title: "Alerts" };

const KIND_LABEL: Record<string, string> = { lead_untouched: "Not contacted", follow_up_overdue: "Follow up overdue", offer_expiring: "Offer expiring" };

export default async function AlertsPage() {
  const session = await requireSession();
  const rows = await listAlerts(session.orgId, session.profileId);
  const unread = rows.filter((r) => !r.readAt).length;
  return (
    <>
      <PageHeader
        title="Alerts"
        description={rows.length ? `${unread} unread of ${rows.length} shown.` : "Untouched leads, overdue follow ups, and offers about to expire."}
        actions={unread > 0 ? <ActionButton action={markAllAlertsRead} variant="outline" size="sm">Mark all read</ActionButton> : undefined}
      />
      {rows.length === 0 ? (
        <EmptyState icon={Bell} title="No alerts" description="Untouched leads, overdue follow ups, and offers about to expire will show up here." />
      ) : (
        <Card>
          <CardBody className="p-0">
            <ul className="divide-y divide-border">
              {rows.map((a) => (
                <li key={a.id} className={cn("px-4 py-3 flex items-start gap-3", !a.readAt && "bg-surface-2")}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge tone="neutral">{KIND_LABEL[a.kind] ?? a.kind}</Badge>
                      <span className="text-[13px] font-medium">{a.title}</span>
                      <span className="text-xs text-fg-3">{relative(a.createdAt)}</span>
                    </div>
                    {a.body ? <p className="text-[13px] text-fg-2 mt-1">{a.body}</p> : null}
                    {a.leadId ? <Link href={`/leads/${a.leadId}`} className="text-xs text-brand hover:underline mt-1 inline-block">Open lead</Link> : null}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!a.readAt ? <ActionButton action={markAlertRead.bind(null, a.id)} size="sm" variant="ghost">Mark read</ActionButton> : null}
                    <ActionButton action={dismissAlert.bind(null, a.id)} size="sm" variant="ghost">Dismiss</ActionButton>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </>
  );
}
