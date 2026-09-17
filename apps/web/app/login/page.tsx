import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase/server";
import { signInWithPassword, signUpWithPassword, sendMagicLink } from "./actions";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; sent?: string; mode?: string }> }) {
  const session = await getSession();
  const sp = await searchParams;
  if (session) redirect(sp.next && sp.next.startsWith("/") ? sp.next : "/dashboard");
  const configured = supabaseConfigured();
  const mode = sp.mode === "signup" ? "signup" : sp.mode === "magic" ? "magic" : "signin";
  const action = mode === "signup" ? signUpWithPassword : mode === "magic" ? sendMagicLink : signInWithPassword;
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-6">
          <div className="h-8 w-8 rounded-md bg-accent text-accent-fg flex items-center justify-center font-bold">A</div>
          <div>
            <div className="text-sm font-semibold">Acquisitions CRM</div>
            <div className="text-xs text-fg-3">Leads, analysis, buyers, packages</div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface shadow-[var(--shadow-card)] p-5">
          {!configured ? (
            <Alert tone="warn">Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or set DEV_AUTH_EMAIL to a seeded profile for local work.</Alert>
          ) : (
            <form action={action} className="space-y-3">
              <input type="hidden" name="next" value={sp.next ?? "/dashboard"} />
              <h1 className="text-base font-semibold">{mode === "signup" ? "Create your account" : mode === "magic" ? "Email me a sign in link" : "Sign in"}</h1>
              {sp.error ? <Alert tone="bad">{sp.error}</Alert> : null}
              {sp.sent ? <Alert tone="good">Check your email for the sign in link.</Alert> : null}
              <Field label="Email"><Input name="email" type="email" required autoComplete="email" placeholder="you@company.com" /></Field>
              {mode !== "magic" ? <Field label="Password"><Input name="password" type="password" required minLength={8} autoComplete={mode === "signup" ? "new-password" : "current-password"} /></Field> : null}
              {mode === "signup" ? <Field label="Full name"><Input name="fullName" required placeholder="Your name" /></Field> : null}
              <Button type="submit" variant="primary" className="w-full" size="lg">{mode === "signup" ? "Create account" : mode === "magic" ? "Send link" : "Sign in"}</Button>
              <div className="text-xs text-fg-3 flex items-center justify-between pt-1">
                {mode === "signin" ? <Link className="hover:text-fg" href="/login?mode=magic">Use a magic link</Link> : <Link className="hover:text-fg" href="/login">Use a password</Link>}
                {mode === "signup" ? <Link className="hover:text-fg" href="/login">Have an account? Sign in</Link> : <Link className="hover:text-fg" href="/login?mode=signup">Create account</Link>}
              </div>
            </form>
          )}
        </div>
        <p className="text-[11px] text-fg-3 mt-4 text-center">Your email must match a team profile created by an admin under Settings, Team.</p>
      </div>
    </div>
  );
}
