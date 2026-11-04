import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EMBLEM_NAMES } from "./ModuleArt";

describe("module art emblems", () => {
  it("draws every emblem the catalog names, so none falls back to a bare ring", () => {
    const src = readFileSync(new URL("../../../../shared/moduleCatalog.ts", import.meta.url), "utf8");
    const named = Array.from(new Set(Array.from(src.matchAll(/emblem: "([A-Za-z]+)"/g), (m) => m[1])));
    expect(named.filter((n) => !EMBLEM_NAMES.includes(n))).toEqual([]);
  });
});
