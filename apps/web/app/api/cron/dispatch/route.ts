import { NextResponse, type NextRequest } from "next/server";
import { dispatchDue } from "@/lib/services/campaigns";
import { ensureDevDatabase } from "@dealcalc/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Scheduler entry point. Vercel Cron sends Authorization: Bearer <CRON_SECRET>. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureDevDatabase();
  const result = await dispatchDue(100);
  return NextResponse.json(result);
}
