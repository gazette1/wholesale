import { describe, it, expect } from "vitest";
import { FORM_TEMPLATES, parseDefinition } from "../src";

describe("seeded templates", () => {
  it("parse through the definition schema", () => {
    for (const t of FORM_TEMPLATES) {
      const def = parseDefinition(t.definition);
      expect(def.sections.length).toBeGreaterThan(0);
    }
  });

  it("put the external contractor only on the bid section", () => {
    const bid = parseDefinition(FORM_TEMPLATES.find((t) => t.slug === "contractor_bid")!.definition);
    expect(bid.sections.filter((s) => s.allowExternal).map((s) => s.key)).toEqual(["bid"]);
    expect(bid.sections.find((s) => s.key === "approval")!.needsApproval).toBe(true);
  });
});
