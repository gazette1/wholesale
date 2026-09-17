import { cache } from "react";
import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { profiles, orgs } from "@dealcalc/db";
import { getDb } from "./db";
import { supabaseConfigured, supabaseServer } from "./supabase/server";

export type Role = "admin" | "acquisitions" | "dispositions" | "viewer";

export type Session = {
  profileId: string;
  userId: string | null;
  orgId: string;
  orgName: string;
  branding: Record<string, string | undefined>;
  email: string;
  fullName: string;
  role: Role;
  authMode: "supabase" | "dev";
};

/**
 * Resolve the signed in profile.
 * 1. Supabase session cookie, matched to profiles.user_id, or claimed by email on first login.
 * 2. Outside production, DEV_AUTH_EMAIL selects a seeded profile with no login. Remove it before deploying.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const db = await getDb();
  // DEMO_MODE=true allows the shared demo login in production. Never set it on a real deployment.
  const devEmail = process.env.NODE_ENV !== "production" || process.env.DEMO_MODE === "true" ? process.env.DEV_AUTH_EMAIL : undefined;

  if (supabaseConfigured()) {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      let profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, user.id) });
      if (!profile && user.email) {
        // First login: claim the seeded profile that carries this email.
        const unclaimed = await db.query.profiles.findFirst({ where: and(eq(profiles.email, user.email.toLowerCase()), eq(profiles.active, true)) });
        if (unclaimed && !unclaimed.userId) {
          await db.update(profiles).set({ userId: user.id }).where(eq(profiles.id, unclaimed.id));
          profile = { ...unclaimed, userId: user.id };
        }
      }
      if (profile && profile.active) return toSession(db, profile, "supabase");
      if (!devEmail) return null;
    }
  }

  if (devEmail) {
    const profile = await db.query.profiles.findFirst({ where: and(eq(profiles.email, devEmail.toLowerCase()), eq(profiles.active, true)) });
    if (profile) return toSession(db, profile, "dev");
  }
  return null;
});

async function toSession(db: Awaited<ReturnType<typeof getDb>>, profile: typeof profiles.$inferSelect, authMode: Session["authMode"]): Promise<Session> {
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, profile.orgId) });
  return {
    profileId: profile.id, userId: profile.userId, orgId: profile.orgId, orgName: org?.name ?? "Workspace",
    branding: (org?.branding ?? {}) as Record<string, string | undefined>,
    email: profile.email, fullName: profile.fullName, role: profile.role, authMode,
  };
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

const RANK: Record<Role, number> = { viewer: 0, dispositions: 1, acquisitions: 1, admin: 2 };

export function can(session: Session, action: "lead:write" | "buyer:write" | "message:send" | "analysis:write" | "settings:write" | "campaign:write"): boolean {
  const r = session.role;
  if (r === "admin") return true;
  switch (action) {
    case "lead:write": case "analysis:write": case "campaign:write": return r === "acquisitions";
    case "buyer:write": return r === "dispositions";
    case "message:send": return r === "acquisitions" || r === "dispositions";
    case "settings:write": return false;
  }
}

export function requireCan(session: Session, action: Parameters<typeof can>[1]): void {
  if (!can(session, action)) throw new Error(`Your role (${session.role}) cannot ${action.replace(":", " ")}.`);
}

export function roleRank(role: Role): number {
  return RANK[role];
}
