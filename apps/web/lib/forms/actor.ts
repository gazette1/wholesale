/** Who is acting on a form. Services take an actor so the signed in app and the external fill page share one code path. */
import type { Role, Session } from "@/lib/auth";

export type ProfileActor = {
  kind: "profile";
  orgId: string;
  profileId: string;
  role: Role;
  isFormAdmin: boolean;
  label: string;
};

export type ExternalActor = {
  kind: "external";
  orgId: string;
  partyId: string;
  /** The party's email or phone, written into form_events.actor_label. */
  label: string;
  submissionId: string;
  /** Only these sections may be read or written. */
  sectionKeys: string[];
};

export type FormActor = ProfileActor | ExternalActor;

export function actorFromSession(s: Session): ProfileActor {
  return { kind: "profile", orgId: s.orgId, profileId: s.profileId, role: s.role, isFormAdmin: s.isFormAdmin, label: s.fullName };
}
