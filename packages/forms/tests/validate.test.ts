import { describe, it, expect } from "vitest";
import { parseDefinition, validateAnswer, validateSection, type FieldDef } from "../src";
import { ctx, sample, when, UUID_A, UUID_B } from "./helpers";

function field(type: FieldDef["type"], options: FieldDef["options"] = {}): FieldDef {
  return parseDefinition({ roles: [], sections: [{ key: "s", title: "S", order: "a0", ownerRole: "r", fields: [{ key: "f", type, label: "F", order: "a0", options }] }] }).sections[0]!.fields[0]!;
}

describe("validateAnswer", () => {
  it("passes empty values, leaving requiredness to the section check", () => {
    expect(validateAnswer(field("number"), "")).toBeNull();
    expect(validateAnswer(field("multiple_choice"), [])).toBeNull();
  });

  it("short text length", () => {
    const f = field("short_text", { minLength: 2, maxLength: 4 });
    expect(validateAnswer(f, "a")).toBe("Enter at least 2 characters");
    expect(validateAnswer(f, "abcde")).toBe("Enter no more than 4 characters");
    expect(validateAnswer(f, "abc")).toBeNull();
  });

  it("email pattern", () => {
    const f = field("short_text", { pattern: "email" });
    expect(validateAnswer(f, "russ@example.com")).toBeNull();
    expect(validateAnswer(f, "russ@example")).toBe("Enter a valid email address");
  });

  it("phone pattern counts 10 US digits after stripping", () => {
    const f = field("short_text", { pattern: "phone" });
    expect(validateAnswer(f, "(555) 123-4567")).toBeNull();
    expect(validateAnswer(f, "+1 555 123 4567")).toBeNull();
    expect(validateAnswer(f, "555-1234")).toBe("Enter a 10 digit phone number");
  });

  it("url pattern", () => {
    const f = field("short_text", { pattern: "url" });
    expect(validateAnswer(f, "https://example.com/a")).toBeNull();
    expect(validateAnswer(f, "example")).toMatch(/web address/);
  });

  it("custom regex pattern", () => {
    const f = field("short_text", { pattern: "custom", regex: "^INV-\\d{4}$" });
    expect(validateAnswer(f, "INV-1234")).toBeNull();
    expect(validateAnswer(f, "1234")).toBe("Enter a value in the expected format");
  });

  it("long text max length", () => {
    expect(validateAnswer(field("long_text", { maxLength: 5 }), "too long")).toBe("Enter no more than 5 characters");
  });

  it("number range and decimals", () => {
    const f = field("number", { min: 1, max: 10, decimals: 0 });
    expect(validateAnswer(f, 11)).toBe("Enter a number no larger than 10");
    expect(validateAnswer(f, 0)).toBe("Enter a number no smaller than 1");
    expect(validateAnswer(f, 2.5)).toBe("Enter a whole number");
    expect(validateAnswer(f, "7")).toBeNull();
    expect(validateAnswer(field("number", { decimals: 1 }), 2.25)).toBe("Enter a number with no more than 1 decimal place");
    expect(validateAnswer(f, "seven")).toBe("Enter a number");
  });

  it("date must be a real ISO date inside the window", () => {
    const f = field("date", { earliest: "2026-10-12", latest: "2026-12-31" });
    expect(validateAnswer(f, "2026-02-30")).toBe("Enter a valid date");
    expect(validateAnswer(f, "10/20/2026")).toBe("Enter a valid date");
    expect(validateAnswer(f, "2026-10-11")).toBe("Enter a date on or after 12 Oct 2026");
    expect(validateAnswer(f, "2027-01-01")).toBe("Enter a date on or before 31 Dec 2026");
    expect(validateAnswer(f, "2026-10-12")).toBeNull();
  });

  it("business days only rejects weekends", () => {
    const f = field("date", { businessDaysOnly: true });
    expect(validateAnswer(f, "2026-10-17")).toBe("Choose a weekday, Monday to Friday");
    expect(validateAnswer(f, "2026-10-16")).toBeNull();
  });

  it("single choice must be a listed value unless other is allowed", () => {
    const choices = [{ value: "a", label: "A" }];
    expect(validateAnswer(field("single_choice", { choices }), "b")).toBe("Choose one of the listed options");
    expect(validateAnswer(field("single_choice", { choices, allowOther: true }), "b")).toBeNull();
  });

  it("multiple choice selections and counts", () => {
    const choices = [{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }];
    const f = field("multiple_choice", { choices, minSelections: 2, maxSelections: 2 });
    expect(validateAnswer(f, ["a"])).toBe("Choose at least 2 options");
    expect(validateAnswer(f, ["a", "b", "c"])).toBe("Choose no more than 2 options");
    expect(validateAnswer(f, ["a", "q"])).toBe("Choose only the listed options");
    expect(validateAnswer(f, ["a", "b"])).toBeNull();
  });

  it("yes/no needs a boolean", () => {
    expect(validateAnswer(field("yes_no"), "yes")).toBe("Choose Yes or No");
    expect(validateAnswer(field("yes_no"), false)).toBeNull();
  });

  it("person is one uuid unless multiple", () => {
    expect(validateAnswer(field("person"), UUID_A)).toBeNull();
    expect(validateAnswer(field("person"), [UUID_A])).toBe("Choose one person");
    expect(validateAnswer(field("person", { multiple: true }), [UUID_A, UUID_B])).toBeNull();
    expect(validateAnswer(field("person"), "bob")).toBe("Choose a person from the list");
  });

  it("file upload is a list of document ids within maxFiles", () => {
    const f = field("file_upload", { maxFiles: 1 });
    expect(validateAnswer(f, [UUID_A])).toBeNull();
    expect(validateAnswer(f, [UUID_A, UUID_B])).toBe("Attach no more than 1 file");
    expect(validateAnswer(f, "file.pdf")).toBe("Upload files through the file picker");
  });
});

describe("validateSection", () => {
  it("lists required fields that are empty", () => {
    const r = validateSection(sample(), "first", {}, ctx);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([{ fieldKey: "name", message: "This field is required" }]);
  });

  it("does not require a hidden required field", () => {
    const def = sample([{ id: "show", when: when("amount", "gt", 5), then: [{ kind: "show", target: { kind: "field", key: "detail" } }] }]);
    expect(validateSection(def, "first", { name: "A", amount: 2 }, ctx).ok).toBe(true);
    expect(validateSection(def, "first", { name: "A", amount: 7 }, ctx).errors).toEqual([{ fieldKey: "detail", message: "This field is required" }]);
  });

  it("skips format checks on hidden fields and keeps their answers", () => {
    const r = validateSection(sample(), "first", { name: "A", detail: 42 }, ctx);
    expect(r.ok).toBe(true);
  });

  it("reports format errors on visible fields", () => {
    const r = validateSection(sample(), "first", { name: "A", amount: 50 }, ctx);
    expect(r.errors).toEqual([{ fieldKey: "amount", message: "Enter a number no larger than 10" }]);
  });

  it("cross field check: end must be after start", () => {
    const r = validateSection(sample(), "second", { start: "2026-10-12", end: "2026-10-12", notes: "n" }, ctx);
    expect(r.errors).toEqual([{ fieldKey: "end", message: "Enter a date after 12 Oct 2026" }]);
    expect(validateSection(sample(), "second", { start: "2026-10-12", end: "2026-10-13", notes: "n" }, ctx).ok).toBe(true);
  });

  it("checks uniqueness through the callback", () => {
    const def = parseDefinition({ roles: [], sections: [{ key: "s", title: "S", order: "a0", ownerRole: "r", fields: [{ key: "invoice", type: "short_text", label: "Invoice", order: "a0", unique: true }] }] });
    const r = validateSection(def, "s", { invoice: "INV-1" }, ctx, { isUnique: (_k, v) => v !== "INV-1" });
    expect(r.errors[0]!.message).toBe("This value is already used in another submission of this form");
    expect(validateSection(def, "s", { invoice: "INV-2" }, ctx, { isUnique: (_k, v) => v !== "INV-1" }).ok).toBe(true);
  });

  it("uses values set by rules", () => {
    const def = sample([{ id: "set", when: when("ok", "equals", true), then: [{ kind: "set_value", fieldKey: "flag", value: "x" }, { kind: "require", fieldKey: "flag" }] }]);
    expect(validateSection(def, "first", { name: "A", ok: true }, ctx).ok).toBe(true);
  });

  it("reports an unknown section", () => {
    expect(validateSection(sample(), "nope", {}, ctx).ok).toBe(false);
  });
});
