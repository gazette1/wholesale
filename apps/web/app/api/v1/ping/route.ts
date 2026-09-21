import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { orgs } from "@dealcalc/db";
import { getDb } from "@/lib/db";
import { authenticateApiRequest } from "@/lib/services/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Key check for Zapier, Make, and scripts. Returns the workspace name the key belongs to. */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if ("response" in auth) return auth.response;
  const db = await getDb();
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, auth.key.orgId) });
  return NextResponse.json({ ok: true, org: org?.name ?? "Workspace" }, { headers: auth.headers });
}
