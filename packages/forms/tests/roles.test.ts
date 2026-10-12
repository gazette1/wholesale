import { describe, it, expect } from "vitest";
import { resolveRole, type RoleDef } from "../src";
import { UUID_A, UUID_B, UUID_C } from "./helpers";

const role: RoleDef = {
  key: "reviewer", label: "Reviewer",
  resolution: [{ kind: "person_field", fieldKey: "reviewer" }, { kind: "subject_owner" }, { kind: "role_group", role: "acquisitions" }, { kind: "fixed_profile", profileId: UUID_C }],
};
const profilesByRole = { acquisitions: [UUID_B, UUID_C] };

describe("resolveRole", () => {
  it("prefers a person field answer", () => {
    expect(resolveRole(role, { answers: { reviewer: UUID_A }, subjectOwnerId: UUID_B, profilesByRole })).toEqual({ source: "person_field", profileIds: [UUID_A], externalPartyIds: [] });
  });

  it("reads a person field holding several people, without duplicates", () => {
    expect(resolveRole(role, { answers: { reviewer: [UUID_A, UUID_B, UUID_A] }, profilesByRole }).profileIds).toEqual([UUID_A, UUID_B]);
  });

  it("falls through an empty person field to the subject owner", () => {
    expect(resolveRole(role, { answers: { reviewer: [] }, subjectOwnerId: UUID_B, profilesByRole }).source).toBe("subject_owner");
  });

  it("falls through to the role group", () => {
    const r = resolveRole(role, { answers: {}, subjectOwnerId: null, profilesByRole });
    expect(r).toEqual({ source: "role_group", profileIds: [UUID_B, UUID_C], externalPartyIds: [] });
  });

  it("falls through to a fixed profile when the group is empty", () => {
    expect(resolveRole(role, { answers: {}, profilesByRole: {} })).toEqual({ source: "fixed_profile", profileIds: [UUID_C], externalPartyIds: [] });
  });

  it("resolves the starter and external parties", () => {
    const starter: RoleDef = { key: "s", label: "S", resolution: [{ kind: "starter" }] };
    expect(resolveRole(starter, { answers: {}, starterId: UUID_A, profilesByRole: {} }).profileIds).toEqual([UUID_A]);
    const ext: RoleDef = { key: "c", label: "C", resolution: [{ kind: "external" }] };
    expect(resolveRole(ext, { answers: {}, profilesByRole: {}, externalPartyIds: ["party-1"] })).toEqual({ source: "external", profileIds: [], externalPartyIds: ["party-1"] });
  });

  it("returns no one when every source is empty", () => {
    const ext: RoleDef = { key: "c", label: "C", resolution: [{ kind: "external" }] };
    expect(resolveRole(ext, { answers: {}, profilesByRole: {} })).toEqual({ source: null, profileIds: [], externalPartyIds: [] });
  });
});
