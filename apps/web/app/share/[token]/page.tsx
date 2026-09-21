import { notFound } from "next/navigation";
import { packageData } from "@/lib/services/packages";
import { PackagePreview } from "@/components/package/preview";

export const dynamic = "force-dynamic";
// The absolute title keeps the internal product name out of the buyer's browser tab.
export const metadata = { title: { absolute: "Deal package" }, robots: { index: false, follow: false } };

/** Public read only view of a deal package. Reached only by the unguessable share token. */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await packageData(token, { byToken: true });
  if (!result) notFound();
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
