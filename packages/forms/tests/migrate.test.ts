import { describe, it, expect } from "vitest";
import { migrateAnswers, parseDefinition } from "../src";
import { sample, sampleInput, UUID_A } from "./helpers";

describe("migrateAnswers", () => {
  it("keeps an answer whose field moved to another section", () => {
    const from = sample();
    const input = sampleInput();
    const moved = input.sections![0]!.fields!.splice(0, 1)[0]!;
    input.sections![1]!.fields!.push({ ...moved, order: "b0" });
    const to = parseDefinition(input);
    expect(migrateAnswers(from, to, { name: "Ous" })).toEqual({ answers: { name: "Ous" }, retired: {} });
  });

  it("retires answers for removed keys", () => {
    const from = sample();
    const input = sampleInput();
    input.sections![1]!.fields = input.sections![1]!.fields!.filter((f) => f.key !== "notes");
    const r = migrateAnswers(from, parseDefinition(input), { notes: "old", name: "A" });
    expect(r).toEqual({ answers: { name: "A" }, retired: { notes: "old" } });
  });

  it("leaves new fields empty without applying defaults", () => {
    const from = sample();
    const input = sampleInput();
    input.sections![1]!.fields!.push({ key: "extra", type: "short_text", label: "Extra", order: "b0", default: "x" });
    const r = migrateAnswers(from, parseDefinition(input), { name: "A" });
    expect(r.answers).toEqual({ name: "A" });
  });

  it("converts text to number when it parses and retires it when it does not", () => {
    const from = sample();
    const input = sampleInput();
    input.sections![0]!.fields![7]!.type = "number";
    const to = parseDefinition(input);
    expect(migrateAnswers(from, to, { flag: "42" }).answers).toEqual({ flag: 42 });
    expect(migrateAnswers(from, to, { flag: "high" })).toEqual({ answers: {}, retired: { flag: "high" } });
  });

  it("converts single choice to multiple choice and back when possible", () => {
    const from = sample();
    const input = sampleInput();
    input.sections![0]!.fields![3]!.type = "multiple_choice";
    input.sections![0]!.fields![4]!.type = "single_choice";
    const to = parseDefinition(input);
    expect(migrateAnswers(from, to, { color: "red", tags: ["x"] }).answers).toEqual({ color: ["red"], tags: "x" });
    expect(migrateAnswers(from, to, { tags: ["x", "y"] }).retired).toEqual({ tags: ["x", "y"] });
  });

  it("retires a choice that the new version removed", () => {
    const from = sample();
    const input = sampleInput();
    input.sections![0]!.fields![3]!.options = { choices: [{ value: "blue", label: "Blue" }] };
    const r = migrateAnswers(from, parseDefinition(input), { color: "red" });
    expect(r.retired).toEqual({ color: "red" });
  });

  it("wraps a single person when the field becomes multiple", () => {
    const base = (multiple: boolean) => parseDefinition({ roles: [], sections: [{ key: "s", title: "S", order: "a0", ownerRole: "r", fields: [{ key: "p", type: multiple ? "short_text" : "person", label: "P", order: "a0" }] }] });
    const to = parseDefinition({ roles: [], sections: [{ key: "s", title: "S", order: "a0", ownerRole: "r", fields: [{ key: "p", type: "person", label: "P", order: "a0", options: { multiple: true } }] }] });
    expect(migrateAnswers(base(false), to, { p: UUID_A }).answers).toEqual({ p: [UUID_A] });
    expect(migrateAnswers(base(true), to, { p: "not an id" }).retired).toEqual({ p: "not an id" });
  });
});
