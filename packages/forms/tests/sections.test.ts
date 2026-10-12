import { describe, it, expect } from "vitest";
import { allSectionsDone, isTaskComplete, nextSectionsToOpen, orderedFields, orderedSections, parseDefinition, type SectionState } from "../src";

function flow(sections: { key: string; parallelGroup?: string; stopPoint?: boolean }[]) {
  return parseDefinition({
    roles: [{ key: "r", label: "R", resolution: [{ kind: "starter" }] }],
    sections: sections.map((s, i) => ({ ...s, title: s.key, order: `a${i}`, ownerRole: "r" })),
  });
}
const none = { skippedSections: [] as string[], sectionVisible: {} as Record<string, boolean> };

describe("ordering", () => {
  it("orders sections and fields by order key, not array position", () => {
    const def = parseDefinition({
      roles: [], sections: [
        { key: "two", title: "Two", order: "b", ownerRole: "r", fields: [{ key: "y", type: "short_text", label: "Y", order: "a" }] },
        { key: "one", title: "One", order: "a", ownerRole: "r", fields: [
          { key: "x2", type: "short_text", label: "X2", order: "b" }, { key: "x1", type: "short_text", label: "X1", order: "a" },
        ] },
      ],
    });
    expect(orderedSections(def).map((s) => s.key)).toEqual(["one", "two"]);
    expect(orderedFields(def).map((p) => p.field.key)).toEqual(["x1", "x2", "y"]);
  });
});

describe("nextSectionsToOpen", () => {
  it("opens the first section of a new submission", () => {
    expect(nextSectionsToOpen(flow([{ key: "a" }, { key: "b" }]), {}, none)).toEqual({ open: ["a"], skip: [] });
  });

  it("runs sections in order", () => {
    const def = flow([{ key: "a" }, { key: "b" }, { key: "c" }]);
    expect(nextSectionsToOpen(def, { a: "open" }, none).open).toEqual([]);
    expect(nextSectionsToOpen(def, { a: "completed" }, none).open).toEqual(["b"]);
  });

  it("opens adjacent sections in the same parallel group together", () => {
    const def = flow([{ key: "a" }, { key: "it", parallelGroup: "p" }, { key: "fac", parallelGroup: "p" }, { key: "d" }]);
    expect(nextSectionsToOpen(def, { a: "completed" }, none).open).toEqual(["it", "fac"]);
    expect(nextSectionsToOpen(def, { a: "completed", it: "completed", fac: "open" }, none).open).toEqual([]);
    expect(nextSectionsToOpen(def, { a: "completed", it: "completed", fac: "completed" }, none).open).toEqual(["d"]);
  });

  it("a stop point holds later sections, even within a parallel group", () => {
    const def = flow([{ key: "a", parallelGroup: "p", stopPoint: true }, { key: "b", parallelGroup: "p" }]);
    expect(nextSectionsToOpen(def, {}, none).open).toEqual(["a"]);
    expect(nextSectionsToOpen(def, { a: "completed" }, none).open).toEqual(["b"]);
  });

  it("passes over sections the rules skip and reports them", () => {
    const def = flow([{ key: "a" }, { key: "b" }, { key: "c" }]);
    const ev = { skippedSections: ["b"], sectionVisible: {} };
    expect(nextSectionsToOpen(def, { a: "completed" }, ev)).toEqual({ open: ["c"], skip: ["b"] });
    expect(nextSectionsToOpen(def, { a: "completed", b: "skipped" }, none).open).toEqual(["c"]);
  });

  it("knows when every section is done", () => {
    const def = flow([{ key: "a" }, { key: "b" }]);
    const state: Record<string, SectionState> = { a: "completed", b: "not_started" };
    expect(allSectionsDone(def, state, none)).toBe(false);
    expect(allSectionsDone(def, state, { skippedSections: ["b"], sectionVisible: {} })).toBe(true);
    expect(nextSectionsToOpen(def, { a: "completed", b: "completed" }, none)).toEqual({ open: [], skip: [] });
  });
});

describe("isTaskComplete", () => {
  it("any one", () => {
    expect(isTaskComplete({ type: "any" }, 3, 0)).toBe(false);
    expect(isTaskComplete({ type: "any" }, 3, 1)).toBe(true);
  });
  it("all", () => {
    expect(isTaskComplete({ type: "all" }, 3, 2)).toBe(false);
    expect(isTaskComplete({ type: "all" }, 3, 3)).toBe(true);
  });
  it("minimum count, capped at the number of assignees", () => {
    expect(isTaskComplete({ type: "minimum", count: 2 }, 3, 1)).toBe(false);
    expect(isTaskComplete({ type: "minimum", count: 2 }, 3, 2)).toBe(true);
    expect(isTaskComplete({ type: "minimum", count: 3 }, 2, 2)).toBe(true);
  });
  it("no assignees is never complete", () => {
    expect(isTaskComplete({ type: "any" }, 0, 0)).toBe(false);
  });
});
