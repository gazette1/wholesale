import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (supabaseConfigured()) {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/login", new URL(request.url).origin), { status: 303 });
}
