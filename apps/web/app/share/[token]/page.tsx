import { eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { dealSubmissions } from "@dealcalc/db";
import { getDb } from "@/lib/db";
import { packageData } from "@/lib/services/packages";
import { PackagePreview } from "@/components/package/preview";

export const dynamic = "force-dynamic";
// The absolute title keeps the internal product name out of the buyer's browser tab.
export const metadata = { title: { absolute: "Deal package" }, robots: { index: false, follow: false } };

/**
 * A buyer's own tracked link, one per deal_submissions row. Looks up strictly by token (this route is
 * public and unauthenticated), records the first open and bumps the open count in one atomic update, and
 * hands back the package id it points to. Same shape (base64url, 16-64 chars) as a package share token,
 * so an unrelated token skips straight past this and falls through to the plain package link below.
 */
async function recordSubmissionOpen(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const db = await getDb();
  const [row] = await db.update(dealSubmissions)
    .set({ openCount: sql`${dealSubmissions.openCount} + 1`, firstOpenedAt: sql`coalesce(${dealSubmissions.firstOpenedAt}, now())` })
    .where(eq(dealSubmissions.token, token))
    .returning();
  return row?.packageId ?? null;
}

/** Public read only view of a deal package. Reached only by the unguessable share token, either the
 * package's own link or one buyer's tracked submission link. */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const submissionPackageId = await recordSubmissionOpen(token);
  const result = submissionPackageId ? await packageData(submissionPackageId) : await packageData(token, { byToken: true });
  if (!result || (submissionPackageId && result.expired)) notFound();
  return (
    <div className="min-h-screen px-4 py-8">
      <div className="max-w-[860px] mx-auto mb-4 flex items-center justify-between">
        <div className="text-[13px] text-fg-3">Shared by {result.data.branding.companyName ?? "Acquisitions Team"}</div>
        <a href={`/api/packages/${result.pkg.id}/pdf?token=${token}`} className="rounded-md bg-accent text-accent-fg px-3 py-1.5 text-[13px] font-medium">Download PDF</a>
      </div>
      <PackagePreview data={result.data} />
    </div>
  );
}
