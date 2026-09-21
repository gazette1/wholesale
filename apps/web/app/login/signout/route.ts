import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (supabaseConfigured()) {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/login", new URL(request.url).origin), { status: 303 });
}

/** Someone typing the address or following an old link gets the sign in page, not a bare 405. Signing out stays POST only. */
export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/login", new URL(request.url).origin), { status: 307 });
}
