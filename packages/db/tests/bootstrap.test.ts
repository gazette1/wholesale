import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createPgliteDb } from "../src/client";
import { migrate } from "../src/migrate";
import { bootstrap, parseTeam, DEFAULT_SOURCES } from "../src/seed/bootstrap";
import { orgs, profiles, pipelineStages, leadSources, tags, messageTemplates, costDefaults, leads, buyers } from "../src/schema";

async function fresh() {
  const db = createPgliteDb();
  await migrate(db);
  return db;
}

const TEAM = [
  { fullName: "Russ Harris", email: "Russ@Example.com", role: "admin" as const },
  { fullName: "Ous", email: "ous@example.com", role: "acquisitions" as const },
];

describe("workspace bootstrap", () => {
  it("creates a working workspace with no demo records", async () => {
    const db = await fresh();
    const out = await bootstrap(db, { orgName: "Contact My REI", team: TEAM });
    const [org] = await db.select().from(orgs);
    expect(org!.name).toBe("Contact My REI");
    expect(out.stageCount).toBe(9);
    expect(out.costDefaultCount).toBe(67);
    expect(await db.select().from(pipelineStages).then((r) => r.length)).toBe(9);
    expect(await db.select().from(leadSources).then((r) => r.map((s) => s.name))).toEqual(DEFAULT_SOURCES);
    expect(await db.select().from(tags).then((r) => r.length)).toBe(16);
    expect(await db.select().from(messageTemplates).then((r) => r.length)).toBe(out.templateCount);
    expect(await db.select().from(costDefaults).then((r) => r.length)).toBe(67);
    // A real workspace starts empty. Demo records belong to seed(), not here.
    expect(await db.select().from(leads).then((r) => r.length)).toBe(0);
    expect(await db.select().from(buyers).then((r) => r.length)).toBe(0);
  }, 60_000);

  it("stores emails in lower case and leaves accounts unclaimed until first sign in", async () => {
    const db = await fresh();
    await bootstrap(db, { orgName: "Contact My REI", team: TEAM });
    const russ = await db.query.profiles.findFirst({ where: eq(profiles.email, "russ@example.com") });
    expect(russ!.role).toBe("admin");
    expect(russ!.userId).toBeNull();
    expect(russ!.active).toBe(true);
  }, 60_000);

  it("refuses a team with no admin, a bad email, or a duplicate email", async () => {
    const db = await fresh();
    await expect(bootstrap(db, { orgName: "X", team: [{ fullName: "A", email: "a@b.co", role: "viewer" }] })).rejects.toThrow(/admin/);
    await expect(bootstrap(db, { orgName: "X", team: [{ fullName: "A", email: "nope", role: "admin" }] })).rejects.toThrow(/valid email/);
    await expect(bootstrap(db, { orgName: "X", team: [...TEAM, { fullName: "Dupe", email: "RUSS@example.com", role: "viewer" }] })).rejects.toThrow(/Duplicate/);
  }, 60_000);

  it("reads a team string", () => {
    expect(parseTeam("Russ Harris <russ@example.com>:admin, Ous <ous@example.com>:acquisitions")).toEqual([
      { fullName: "Russ Harris", email: "russ@example.com", role: "admin" },
      { fullName: "Ous", email: "ous@example.com", role: "acquisitions" },
    ]);
    // A missing role means admin, since the first person set up is usually the owner.
    expect(parseTeam("Solo <solo@example.com>")[0]!.role).toBe("admin");
    expect(() => parseTeam("no email here")).toThrow();
  });
});
