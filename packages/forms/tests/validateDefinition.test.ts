import { describe, it, expect } from "vitest";
import { FORM_TEMPLATES, validateDefinition } from "../src";
import { sampleInput, when } from "./helpers";

const messages = (input: unknown) => validateDefinition(input).errors.map((e) => e.message);

describe("validateDefinition", () => {
  it("accepts the three seeded templates", () => {
    for (const t of FORM_TEMPLATES) expect(validateDefinition(t.definition)).toEqual({ ok: true, errors: [] });
  });

  it("accepts the sample form", () => {
    expect(validateDefinition(sampleInput()).ok).toBe(true);
  });

  it("returns schema errors with paths", () => {
    const r = validateDefinition({ sections: [{ key: "Bad Key", title: "x", order: "a0", ownerRole: "acq" }] });
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.path).toBe("sections.0.key");
  });

  it("rejects duplicate field keys across sections", () => {
    const input = sampleInput();
    input.sections![1]!.fields!.push({ key: "name", type: "short_text", label: "Again", order: "a2" });
    const r = validateDefinition(input);
    expect(r.errors).toContainEqual({ path: "sections.1.fields.2.key", message: 'The field key "name" is used more than once' });
  });

  it("rejects duplicate section keys", () => {
    const input = sampleInput();
    input.sections![1]!.key = "first";
    expect(messages(input)).toContain('The section key "first" is used more than once');
  });

  it("rejects an owner role that does not exist", () => {
    const input = sampleInput();
    input.sections![0]!.ownerRole = "legal";
    expect(messages(input).join()).toMatch(/role "legal", which does not exist/);
  });

  it("rejects signature fields", () => {
    const input = sampleInput();
    input.sections![0]!.fields!.push({ key: "sig", type: "signature", label: "Sign", order: "b0" });
    expect(messages(input)).toContain("Signature fields are not available yet");
  });

  it("requires choices on choice fields", () => {
    const input = sampleInput();
    input.sections![0]!.fields!.push({ key: "pick", type: "single_choice", label: "Pick", order: "b0" });
    expect(messages(input)).toContain('The field "Pick" needs at least one choice');
  });

  it("requires a count for a minimum completion rule", () => {
    const input = sampleInput();
    input.sections![0]!.completionRule = { type: "minimum" };
    expect(messages(input)).toContain("A minimum completion rule needs a count");
  });

  it("requires date_field due rules to point at a date field", () => {
    const input = sampleInput();
    input.sections![1]!.dueRule = { from: "date_field", fieldKey: "name", offset: 0, unit: "days" };
    expect(messages(input).join()).toMatch(/count from a date field, and "name" is not one/);
    input.sections![1]!.dueRule = { from: "date_field", fieldKey: "start", offset: 0, unit: "days" };
    expect(validateDefinition(input).ok).toBe(true);
  });

  it("requires person_field role sources to point at a person field", () => {
    const input = sampleInput();
    input.roles!.push({ key: "lead", label: "Lead", resolution: [{ kind: "person_field", fieldKey: "name" }] });
    expect(messages(input).join()).toMatch(/must read a person field/);
  });

  it("rejects rules that reference missing fields, sections, or roles", () => {
    const input = sampleInput([
      { id: "r1", when: when("ghost", "is_empty"), then: [{ kind: "show", target: { kind: "section", key: "nowhere" } }] },
      { id: "r2", when: when("name", "is_empty"), then: [{ kind: "assign", sectionKey: "second", roleKey: "legal" }] },
    ]);
    const m = messages(input).join("|");
    expect(m).toMatch(/reads the field "ghost", which does not exist/);
    expect(m).toMatch(/changes the section "nowhere", which does not exist/);
    expect(m).toMatch(/assigns the role "legal", which does not exist/);
  });

  it("guard 1: rejects a rule that reads a later field", () => {
    const input = sampleInput([{ id: "late", when: when("flag", "equals", "x"), then: [{ kind: "require", fieldKey: "amount" }] }]);
    const r = validateDefinition(input);
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toMatch(/may only read fields that come before its target/);
  });

  it("guard 1: accepts a rule that reads an earlier field", () => {
    const input = sampleInput([{ id: "early", when: when("amount", "gt", 5), then: [{ kind: "show", target: { kind: "field", key: "detail" } }] }]);
    expect(validateDefinition(input).ok).toBe(true);
  });

  it("guard 1: a section target needs conditions from earlier sections", () => {
    const same = sampleInput([{ id: "s", when: when("name", "is_empty"), then: [{ kind: "skip_section", sectionKey: "first" }] }]);
    expect(messages(same).join()).toMatch(/not in a section before "first"/);
    const earlier = sampleInput([{ id: "s", when: when("name", "is_empty"), then: [{ kind: "skip_section", sectionKey: "second" }] }]);
    expect(validateDefinition(earlier).ok).toBe(true);
  });

  it("guard 2: rejects a two rule cycle", () => {
    const input = sampleInput([
      { id: "a_sets_b", when: when("name", "equals", "x"), then: [{ kind: "set_value", fieldKey: "flag", value: "y" }] },
      { id: "b_hides_a", when: when("flag", "equals", "y"), then: [{ kind: "hide", target: { kind: "field", key: "name" } }] },
    ]);
    const m = messages(input);
    expect(m.some((x) => /depend on each other in a loop: field name then field flag then field name/.test(x))).toBe(true);
  });

  it("rejects a rule placed above a rule that changes what it reads", () => {
    const input = sampleInput([
      { id: "reads_detail", when: when("detail", "is_not_empty"), then: [{ kind: "require", fieldKey: "flag" }] },
      { id: "shows_detail", when: when("amount", "gt", 5), then: [{ kind: "show", target: { kind: "field", key: "detail" } }] },
    ]);
    expect(messages(input).join()).toMatch(/later rule "shows_detail" changes. Move "reads_detail" below that rule/);
  });

  it("requires an array for is_one_of", () => {
    const input = sampleInput([{ id: "r", when: when("color", "is_one_of", "red"), then: [{ kind: "require", fieldKey: "flag" }] }]);
    expect(messages(input).join()).toMatch(/at least one value for "is one of"/);
  });

  it("checks field reference bounds on dates", () => {
    const input = sampleInput();
    input.sections![1]!.fields![0]!.options = { earliest: "field:name" };
    expect(messages(input).join()).toMatch(/must refer to a date field/);
  });
});
