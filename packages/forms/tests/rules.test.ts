import { describe, it, expect } from "vitest";
import { applyOperator, evaluate, FORM_TEMPLATES, parseDefinition } from "../src";
import { ctx, sample, when } from "./helpers";

describe("operators", () => {
  it("text equals ignores case and surrounding spaces", () => {
    expect(applyOperator("equals", "text", "  Tenant ", "tenant")).toBe(true);
    expect(applyOperator("not_equals", "text", "owner", "tenant")).toBe(true);
  });

  it("contains works on text and on multiple choice lists", () => {
    expect(applyOperator("contains", "text", "Roof leak in attic", "LEAK")).toBe(true);
    expect(applyOperator("contains", "list", ["probate", "tax"], "tax")).toBe(true);
    expect(applyOperator("contains", "list", ["probate"], "tax")).toBe(false);
  });

  it("numbers compare numerically, with string numbers coerced", () => {
    expect(applyOperator("gt", "number", "10", 9)).toBe(true);
    expect(applyOperator("gt", "text", "10", "9")).toBe(true);
    expect(applyOperator("lte", "number", 75, "75")).toBe(true);
    expect(applyOperator("lt", "number", "abc", 5)).toBe(false);
    expect(applyOperator("equals", "number", "5.0", 5)).toBe(true);
  });

  it("dates compare as dates", () => {
    expect(applyOperator("before", "date", "2026-10-01", "2026-10-12")).toBe(true);
    expect(applyOperator("after", "date", "2026-10-01", "2026-10-12")).toBe(false);
    expect(applyOperator("gte", "date", "2026-10-12", "2026-10-12")).toBe(true);
    expect(applyOperator("before", "date", "not a date", "2026-10-12")).toBe(false);
  });

  it("is_one_of takes an array", () => {
    expect(applyOperator("is_one_of", "text", "Heir", ["owner", "heir"])).toBe(true);
    expect(applyOperator("is_one_of", "text", "agent", ["owner", "heir"])).toBe(false);
    expect(applyOperator("is_one_of", "list", ["x", "q"], ["q"])).toBe(true);
  });

  it("is_empty treats blank, null, undefined, and empty lists as empty", () => {
    for (const v of ["", "  ", null, undefined, []]) expect(applyOperator("is_empty", "text", v, undefined)).toBe(true);
    expect(applyOperator("is_not_empty", "text", 0, undefined)).toBe(true);
    expect(applyOperator("is_not_empty", "boolean", false, undefined)).toBe(true);
  });

  it("yes/no equals compares booleans", () => {
    expect(applyOperator("equals", "boolean", true, true)).toBe(true);
    expect(applyOperator("equals", "boolean", false, true)).toBe(false);
    expect(applyOperator("equals", "boolean", undefined, false)).toBe(false);
  });

  it("list equals compares as sets", () => {
    expect(applyOperator("equals", "list", ["y", "x"], ["x", "y"])).toBe(true);
    expect(applyOperator("equals", "list", ["x"], ["x", "y"])).toBe(false);
  });
});

describe("evaluate", () => {
  it("starts with defaults: hidden by default fields hidden, owner roles, section due rules", () => {
    const ev = evaluate(sample(), {}, ctx);
    expect(ev.fieldVisible.detail).toBe(false);
    expect(ev.fieldVisible.name).toBe(true);
    expect(ev.fieldRequired.name).toBe(true);
    expect(ev.assignments).toEqual({ first: "acq", second: "acq" });
    expect(ev.skippedSections).toEqual([]);
  });

  it("required only when visible", () => {
    const def = sample([{ id: "show", when: when("amount", "gt", 5), then: [{ kind: "show", target: { kind: "field", key: "detail" } }] }]);
    expect(evaluate(def, { amount: 3 }, ctx).fieldRequired.detail).toBe(false);
    const shown = evaluate(def, { amount: 7 }, ctx);
    expect(shown.fieldVisible.detail).toBe(true);
    expect(shown.fieldRequired.detail).toBe(true);
  });

  it("applies show and hide in rule order, the last matching rule wins", () => {
    const def = sample([
      { id: "show", when: when("amount", "gt", 1), then: [{ kind: "show", target: { kind: "field", key: "detail" } }] },
      { id: "hide", when: when("amount", "gt", 5), then: [{ kind: "hide", target: { kind: "field", key: "detail" } }] },
    ]);
    expect(evaluate(def, { amount: 3 }, ctx).fieldVisible.detail).toBe(true);
    expect(evaluate(def, { amount: 8 }, ctx).fieldVisible.detail).toBe(false);
  });

  it("set_value results feed later rules", () => {
    const def = sample([
      { id: "set", when: when("color", "equals", "red"), then: [{ kind: "set_value", fieldKey: "flag", value: "urgent" }] },
      { id: "use", when: when("flag", "equals", "URGENT"), then: [{ kind: "require", fieldKey: "notes" }, { kind: "skip_section", sectionKey: "second" }] },
    ]);
    const ev = evaluate(def, { color: "red" }, ctx);
    expect(ev.setValues).toEqual({ flag: "urgent" });
    expect(ev.answers.flag).toBe("urgent");
    expect(ev.skippedSections).toEqual(["second"]);
  });

  it("require and optional change requiredness", () => {
    const def = sample([
      { id: "req", when: when("ok", "equals", true), then: [{ kind: "require", fieldKey: "flag" }, { kind: "optional", fieldKey: "name" }] },
    ]);
    const ev = evaluate(def, { ok: true }, ctx);
    expect(ev.fieldRequired.flag).toBe(true);
    expect(ev.fieldRequired.name).toBe(false);
  });

  it("nested AND/OR groups", () => {
    const def = sample([{
      id: "nested",
      when: {
        combinator: "and",
        conditions: [
          { source: { kind: "field", key: "name" }, op: "is_not_empty" },
          { combinator: "or", conditions: [
            { source: { kind: "field", key: "amount" }, op: "gte", value: 8 },
            { combinator: "and", conditions: [
              { source: { kind: "field", key: "color" }, op: "equals", value: "blue" },
              { source: { kind: "field", key: "tags" }, op: "contains", value: "z" },
            ] },
          ] },
        ],
      },
      then: [{ kind: "show", target: { kind: "field", key: "detail" } }],
    }]);
    const vis = (a: Record<string, unknown>) => evaluate(def, a, ctx).fieldVisible.detail;
    expect(vis({ name: "A", amount: 9 })).toBe(true);
    expect(vis({ name: "A", amount: 2, color: "blue", tags: ["z"] })).toBe(true);
    expect(vis({ name: "A", amount: 2, color: "blue", tags: ["x"] })).toBe(false);
    expect(vis({ amount: 9 })).toBe(false);
  });

  it("an empty OR group is false and an empty AND group is true", () => {
    const def = sample([
      { id: "or", when: { combinator: "or", conditions: [] }, then: [{ kind: "require", fieldKey: "flag" }] },
      { id: "and", when: { combinator: "and", conditions: [] }, then: [{ kind: "require", fieldKey: "start" }] },
    ]);
    const ev = evaluate(def, {}, ctx);
    expect(ev.fieldRequired.flag).toBe(false);
    expect(ev.fieldRequired.start).toBe(true);
  });

  it("hiding a section hides its fields and drops their requiredness", () => {
    const def = sample([{ id: "h", when: when("ok", "equals", false), then: [{ kind: "hide", target: { kind: "section", key: "second" } }] }]);
    const ev = evaluate(def, { ok: false }, ctx);
    expect(ev.sectionVisible.second).toBe(false);
    expect(ev.fieldVisible.notes).toBe(false);
    expect(ev.fieldRequired.notes).toBe(false);
  });

  it("assign and change_due override the section defaults", () => {
    const due = { from: "submission_start" as const, offset: 1, unit: "business_days" as const };
    const def = sample([{ id: "a", when: when("amount", "gt", 5), then: [{ kind: "assign", sectionKey: "second", roleKey: "mgr" }, { kind: "change_due", sectionKey: "second", dueRule: due }] }]);
    const ev = evaluate(def, { amount: 9 }, ctx);
    expect(ev.assignments.second).toBe("mgr");
    expect(ev.dueRules.second).toEqual(due);
  });

  it("rules read hidden fields as empty", () => {
    const def = sample([
      { id: "show", when: when("amount", "gt", 5), then: [{ kind: "show", target: { kind: "field", key: "detail" } }] },
      { id: "chain", when: when("detail", "is_not_empty"), then: [{ kind: "require", fieldKey: "flag" }] },
    ]);
    expect(evaluate(def, { amount: 9, detail: "x" }, ctx).fieldRequired.flag).toBe(true);
    expect(evaluate(def, { amount: 1, detail: "x" }, ctx).fieldRequired.flag).toBe(false);
  });

  it("meta conditions read the starter role, version, and created date", () => {
    const def = sample([{
      id: "m",
      when: { combinator: "and", conditions: [
        { source: { kind: "meta", key: "starter_role" }, op: "equals", value: "Dispositions" },
        { source: { kind: "meta", key: "version" }, op: "gte", value: 2 },
        { source: { kind: "meta", key: "created_at" }, op: "after", value: "2026-10-01" },
      ] },
      then: [{ kind: "require", fieldKey: "flag" }],
    }]);
    const base = { ...ctx, starterRole: "dispositions" as const, versionNumber: 2, createdAt: new Date("2026-10-05T12:00:00Z") };
    expect(evaluate(def, {}, base).fieldRequired.flag).toBe(true);
    expect(evaluate(def, {}, { ...base, versionNumber: 1 }).fieldRequired.flag).toBe(false);
  });

  it("seller intake shows the mortgage balance only when a mortgage is owed", () => {
    const def = parseDefinition(FORM_TEMPLATES[0]!.definition);
    expect(evaluate(def, { mortgage_owed: false }, ctx).fieldVisible.mortgage_balance).toBe(false);
    const ev = evaluate(def, { mortgage_owed: true }, ctx);
    expect(ev.fieldVisible.mortgage_balance).toBe(true);
    expect(ev.fieldRequired.mortgage_balance).toBe(true);
  });

  it("does not change the answers passed in", () => {
    const def = sample([{ id: "set", when: when("color", "equals", "red"), then: [{ kind: "set_value", fieldKey: "flag", value: "u" }] }]);
    const answers = { color: "red" };
    evaluate(def, answers, ctx);
    expect(answers).toEqual({ color: "red" });
  });
});
