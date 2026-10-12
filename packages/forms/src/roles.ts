/** Resolves a form role to people. */
import type { Answers, AppRole, RoleDef, RoleSource } from "./definition";

export type RoleResolutionContext = {
  answers: Answers;
  subjectOwnerId?: string | null;
  starterId?: string | null;
  profilesByRole: Partial<Record<AppRole, string[]>>;
  externalPartyIds?: string[];
};

export type RoleResolution = {
  /** The source that produced the people, or null when no source yielded anyone. */
  source: RoleSource["kind"] | null;
  profileIds: string[];
  externalPartyIds: string[];
};

function ids(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.filter((v): v is string => typeof v === "string" && v.trim() !== ""))];
}

function fromSource(src: RoleSource, ctx: RoleResolutionContext): { profileIds: string[]; externalPartyIds: string[] } {
  const none: string[] = [];
  switch (src.kind) {
    case "person_field": return { profileIds: ids(ctx.answers[src.fieldKey]), externalPartyIds: none };
    case "subject_owner": return { profileIds: ids(ctx.subjectOwnerId), externalPartyIds: none };
    case "starter": return { profileIds: ids(ctx.starterId), externalPartyIds: none };
    case "role_group": return { profileIds: ids(ctx.profilesByRole[src.role] ?? []), externalPartyIds: none };
    case "fixed_profile": return { profileIds: ids(src.profileId), externalPartyIds: none };
    case "external": return { profileIds: none, externalPartyIds: ids(ctx.externalPartyIds ?? []) };
  }
}

/** Tries each source in the role's resolution order and returns the first that yields anyone. */
export function resolveRole(role: RoleDef, ctx: RoleResolutionContext): RoleResolution {
  for (const src of role.resolution) {
    const found = fromSource(src, ctx);
    if (found.profileIds.length > 0 || found.externalPartyIds.length > 0) return { source: src.kind, ...found };
  }
  return { source: null, profileIds: [], externalPartyIds: [] };
}
