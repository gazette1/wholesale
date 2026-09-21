import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { fileStorage } from "@dealcalc/integrations";

/** Serves files from local storage in development. Supabase storage uses signed URLs instead. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  const { path } = await params;
  const key = path.map(decodeURIComponent).join("/");
  // A ".." segment would pass the prefix check and then resolve outside the org folder.
  if (!key.startsWith(`${session.orgId}/`) || key.split(/[\\/]/).some((part) => part === ".." || part === ".")) return new NextResponse("Forbidden", { status: 403 });
  const data = await fileStorage().get(key);
  if (!data) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(data), { headers: { "content-type": "application/octet-stream" } });
}
