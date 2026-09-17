import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { EMBEDDED_MIGRATIONS } from "../src/migrations.generated";

const dir = resolve(__dirname, "../migrations");

describe("embedded migrations", () => {
  it("match the SQL files on disk (run pnpm --filter @dealcalc/db generate if not)", () => {
    const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    expect(Object.keys(EMBEDDED_MIGRATIONS).sort()).toEqual(files);
    for (const f of files) {
      const onDisk = readFileSync(resolve(dir, f), "utf-8").replace(/\r\n/g, "\n");
      expect(EMBEDDED_MIGRATIONS[f]).toBe(onDisk);
    }
  });
});
