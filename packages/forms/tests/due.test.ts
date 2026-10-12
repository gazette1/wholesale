import { describe, it, expect } from "vitest";
import { addBusinessDays, computeDueAt, localDate, zonedTime } from "../src";

const NY = "America/New_York";
const base = (startedAt: string, timeZone = NY) => ({ now: new Date(startedAt), timeZone, submissionStartedAt: new Date(startedAt), answers: {} });

describe("addBusinessDays", () => {
  it("skips the weekend going forward", () => {
    expect(addBusinessDays("2026-10-16", 1)).toBe("2026-10-19");
    expect(addBusinessDays("2026-10-16", 5)).toBe("2026-10-23");
  });

  it("counts back with a negative offset", () => {
    expect(addBusinessDays("2026-10-19", -1)).toBe("2026-10-16");
  });

  it("starting on a Saturday, one business day is Monday", () => {
    expect(addBusinessDays("2026-10-17", 1)).toBe("2026-10-19");
  });

  it("zero leaves the date alone", () => {
    expect(addBusinessDays("2026-10-14", 0)).toBe("2026-10-14");
  });
});

describe("zone helpers", () => {
  it("reads the local date in the zone", () => {
    expect(localDate(new Date("2026-10-17T03:30:00Z"), NY)).toBe("2026-10-16");
    expect(localDate(new Date("2026-10-17T03:30:00Z"), "UTC")).toBe("2026-10-17");
  });

  it("converts a local wall time to an instant in daylight and standard time", () => {
    expect(zonedTime("2026-10-19", 17, NY).toISOString()).toBe("2026-10-19T21:00:00.000Z");
    expect(zonedTime("2026-11-02", 17, NY).toISOString()).toBe("2026-11-02T22:00:00.000Z");
  });
});

describe("computeDueAt", () => {
  it("one business day from a Friday start lands Monday at 17:00 local", () => {
    const due = computeDueAt({ from: "submission_start", offset: 1, unit: "business_days" }, base("2026-10-16T18:00:00Z"));
    expect(due!.toISOString()).toBe("2026-10-19T21:00:00.000Z");
  });

  it("uses the local weekday across a zone boundary", () => {
    const rule = { from: "submission_start" as const, offset: 1, unit: "business_days" as const };
    // Friday 23:30 in New York is already Saturday in UTC.
    expect(computeDueAt(rule, base("2026-10-17T03:30:00Z", NY))!.toISOString()).toBe("2026-10-19T21:00:00.000Z");
    expect(computeDueAt(rule, base("2026-10-17T03:30:00Z", "UTC"))!.toISOString()).toBe("2026-10-19T17:00:00.000Z");
    const two = { ...rule, offset: 2 };
    expect(computeDueAt(two, base("2026-10-17T03:30:00Z", NY))!.toISOString()).toBe("2026-10-20T21:00:00.000Z");
  });

  it("handles the end of daylight saving time", () => {
    const due = computeDueAt({ from: "submission_start", offset: 1, unit: "business_days" }, base("2026-10-30T15:00:00Z"));
    expect(due!.toISOString()).toBe("2026-11-02T22:00:00.000Z");
  });

  it("calendar days land at 17:00 local", () => {
    const due = computeDueAt({ from: "submission_start", offset: 2, unit: "days" }, base("2026-10-16T18:00:00Z"));
    expect(due!.toISOString()).toBe("2026-10-18T21:00:00.000Z");
  });

  it("hours add hours to the start", () => {
    const due = computeDueAt({ from: "submission_start", offset: 4, unit: "hours" }, base("2026-10-16T18:00:00Z"));
    expect(due!.toISOString()).toBe("2026-10-16T22:00:00.000Z");
  });

  it("counts back from a date field", () => {
    const ctx = { ...base("2026-10-12T12:00:00Z"), answers: { bid_due: "2026-10-19" } };
    const due = computeDueAt({ from: "date_field", fieldKey: "bid_due", offset: -1, unit: "business_days" }, ctx);
    expect(due!.toISOString()).toBe("2026-10-16T21:00:00.000Z");
    const same = computeDueAt({ from: "date_field", fieldKey: "bid_due", offset: 0, unit: "days" }, ctx);
    expect(same!.toISOString()).toBe("2026-10-19T21:00:00.000Z");
  });

  it("counts from the previous section's completion", () => {
    const ctx = { ...base("2026-10-12T12:00:00Z"), previousSectionCompletedAt: new Date("2026-10-14T15:00:00Z") };
    const due = computeDueAt({ from: "previous_section", offset: 2, unit: "business_days" }, ctx);
    expect(due!.toISOString()).toBe("2026-10-16T21:00:00.000Z");
  });

  it("returns null when the starting point is unknown", () => {
    expect(computeDueAt({ from: "previous_section", offset: 1, unit: "days" }, base("2026-10-12T12:00:00Z"))).toBeNull();
    expect(computeDueAt({ from: "date_field", fieldKey: "bid_due", offset: 1, unit: "days" }, base("2026-10-12T12:00:00Z"))).toBeNull();
  });
});

describe("documented edge behavior", () => {
  it("business days with offset 0 keeps a weekend date as is", () => {
    expect(addBusinessDays("2026-10-17", 0)).toBe("2026-10-17");
  });

  it("does not depend on now, only on the anchor event", () => {
    const rule = { from: "submission_start" as const, offset: 1, unit: "business_days" as const };
    const a = computeDueAt(rule, { ...base("2026-10-16T14:00:00Z"), now: new Date("2026-10-16T14:00:00Z") });
    const b = computeDueAt(rule, { ...base("2026-10-16T14:00:00Z"), now: new Date("2026-12-01T14:00:00Z") });
    expect(a!.toISOString()).toBe(b!.toISOString());
  });
});
