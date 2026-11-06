import { describe, expect, it } from "vitest";
import { MODULES_BY_ID } from "./modules";
import { STARTER_SETS } from "./moduleStarterSets";

describe("starter sets", () => {
  it("has a few sets, each with more than one module", () => {
    expect(STARTER_SETS.length).toBeGreaterThan(0);
    for (const s of STARTER_SETS) expect(s.moduleIds.length).toBeGreaterThan(1);
  });

  it("names only modules the registry holds, none of them core and none withdrawn", () => {
    for (const s of STARTER_SETS) {
      for (const id of s.moduleIds) {
        const def = MODULES_BY_ID[id];
        expect(def, `${s.id} names ${id}`).toBeTruthy();
        expect(def?.core, `${id} is core`).toBeFalsy();
        expect(def?.withdrawn, `${id} is withdrawn`).toBeFalsy();
      }
    }
  });

  it("gives every set a distinct id", () => {
    const ids = STARTER_SETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
