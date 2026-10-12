import { parseDefinition, type FormDefinition, type FormDefinitionInput } from "../src";

export const UUID_A = "11111111-1111-4111-8111-111111111111";
export const UUID_B = "22222222-2222-4222-8222-222222222222";
export const UUID_C = "33333333-3333-4333-8333-333333333333";

export const ctx = { now: new Date("2026-10-12T14:00:00Z"), timeZone: "America/New_York" };

export const owner = { key: "acq", label: "Acquisitions", resolution: [{ kind: "role_group" as const, role: "acquisitions" as const }] };

/** A two section form with a field of each common type for rule and validation tests. */
export function sampleInput(rules: FormDefinitionInput["rules"] = []): FormDefinitionInput {
  return {
    roles: [owner, { key: "mgr", label: "Manager", resolution: [{ kind: "starter" }] }],
    sections: [
      {
        key: "first", title: "First", order: "a0", ownerRole: "acq",
        fields: [
          { key: "name", type: "short_text", label: "Name", order: "a0", required: true },
          { key: "amount", type: "number", label: "Amount", order: "a1", options: { min: 0, max: 10, decimals: 0 } },
          { key: "start", type: "date", label: "Start", order: "a2" },
          { key: "color", type: "single_choice", label: "Color", order: "a3", options: { choices: [{ value: "red", label: "Red" }, { value: "blue", label: "Blue" }] } },
          { key: "tags", type: "multiple_choice", label: "Tags", order: "a4", options: { choices: [{ value: "x", label: "X" }, { value: "y", label: "Y" }, { value: "z", label: "Z" }] } },
          { key: "ok", type: "yes_no", label: "OK", order: "a5" },
          { key: "detail", type: "long_text", label: "Detail", order: "a6", hiddenByDefault: true, required: true },
          { key: "flag", type: "short_text", label: "Flag", order: "a7" },
        ],
      },
      {
        key: "second", title: "Second", order: "a1", ownerRole: "acq",
        fields: [
          { key: "end", type: "date", label: "End", order: "a0", options: { earliest: "field:start" } },
          { key: "notes", type: "long_text", label: "Notes", order: "a1", required: true },
        ],
      },
    ],
    rules,
  };
}

export function sample(rules: FormDefinitionInput["rules"] = []): FormDefinition {
  return parseDefinition(sampleInput(rules));
}

export function when(key: string, op: string, value?: unknown) {
  return { combinator: "and" as const, conditions: [{ source: { kind: "field" as const, key }, op: op as never, value }] };
}
