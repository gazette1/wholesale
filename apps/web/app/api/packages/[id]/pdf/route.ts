import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { packageData } from "@/lib/services/packages";
import { renderPackagePdf } from "@/lib/pdf/package-pdf";

export const dynamic = "force-dynamic";

/** PDF for a package. Signed in users of the org, or anyone holding a valid share token (?token=). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = request.nextUrl.searchParams.get("token");
  const result = token ? await packageData(token, { byToken: true }) : await packageData(id);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!token) {
    const session = await getSession();
    if (!session || session.orgId !== result.orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const pdf = await renderPackagePdf(result.data);
  const filename = `deal-package-${result.data.property.address.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
  return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${filename}"`, "cache-control": "private, no-store" } });
}
