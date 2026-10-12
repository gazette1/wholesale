import { describe, it, expect } from "vitest";
import { keyBetween, keysBetween, sortByOrder, isValidOrderKey } from "../src";

describe("order keys", () => {
  it("makes a first key with no neighbors", () => {
    const k = keyBetween(null, null);
    expect(isValidOrderKey(k)).toBe(true);
  });

  it("fits a key between two template keys", () => {
    const k = keyBetween("a0", "a1");
    expect(k > "a0" && k < "a1").toBe(true);
  });

  it("fits keys before the first and after the last", () => {
    const before = keyBetween(null, "a0");
    const after = keyBetween("a1", null);
    expect(before < "a0").toBe(true);
    expect(after > "a1").toBe(true);
  });

  it("keeps inserting between the same pair without renumbering", () => {
    let lo = "a0";
    const hi = "a1";
    for (let i = 0; i < 50; i++) {
      const k = keyBetween(lo, hi);
      expect(k > lo && k < hi).toBe(true);
      lo = k;
    }
  });

  it("makes several ordered keys at once", () => {
    const ks = keysBetween("a0", "a1", 5);
    expect([...ks].sort()).toEqual(ks);
    expect(new Set(ks).size).toBe(5);
  });

  it("rejects a reversed pair", () => {
    expect(() => keyBetween("b", "a")).toThrow();
  });

  it("sorts by key as plain strings, stable for ties", () => {
    const items = [{ id: 1, order: "b" }, { id: 2, order: "a0" }, { id: 3, order: "Z" }, { id: 4, order: "a0" }];
    expect(sortByOrder(items).map((i) => i.id)).toEqual([3, 2, 4, 1]);
  });
});
