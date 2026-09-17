"use server";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

function safeNext(v: FormDataEntryValue | null): string {
  const s = String(v ?? "/dashboard");
  return s.startsWith("/") ? s : "/dashboard";
}

export async function signInWithPassword(form: FormData) {
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email: String(form.get("email")).trim().toLowerCase(), password: String(form.get("password")) });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect(safeNext(form.get("next")));
}

export async function signUpWithPassword(form: FormData) {
  const supabase = await supabaseServer();
  const email = String(form.get("email")).trim().toLowerCase();
  const { data, error } = await supabase.auth.signUp({ email, password: String(form.get("password")), options: { data: { full_name: String(form.get("fullName") ?? "") } } });
  if (error) redirect(`/login?mode=signup&error=${encodeURIComponent(error.message)}`);
  if (!data.session) redirect(`/login?sent=1`);
  redirect(safeNext(form.get("next")));
}

export async function sendMagicLink(form: FormData) {
  const supabase = await supabaseServer();
  const email = String(form.get("email")).trim().toLowerCase();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${process.env.APP_URL ?? "http://localhost:3000"}/login/callback?next=${encodeURIComponent(safeNext(form.get("next")))}` } });
  if (error) redirect(`/login?mode=magic&error=${encodeURIComponent(error.message)}`);
  redirect(`/login?mode=magic&sent=1`);
}
