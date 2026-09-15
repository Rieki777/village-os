/**
 * THE ONE PLACE THE DRY RUN'S MIRRORS CAN BE CHECKED AGAINST WHAT THEY MIRROR.
 *
 * `shared/dryRun/economicsModel.ts` copies rules out of the ledger and the
 * economy engine by hand, because the cardinal rule of that directory is that
 * nothing in it may import anything under `server/`, and its own test walks the
 * import graph from disk and fails if that ever stops being true. A copy that
 * nothing compares is a copy that drifts, and one of these had already drifted:
 * the model's `ALLOW_NEGATIVE_SOURCES` held two of the keystone's three, so a
 * clawback that left a member owing was reported as a broken ledger.
 *
 * THIS FILE LIVES UNDER `server/` SO IT MAY IMPORT BOTH SIDES. It is the only
 * test in the build that can, and it is deliberately tiny: it holds no
 * fixtures, opens no database, and asserts nothing about behaviour. It asks one
 * question of each mirror, which is whether it still equals the thing it claims
 * to be a copy of.
 *
 * It needs no database. `server/lib/ledger.ts` reads `mysql2/promise` for types
 * only and opens no connection at module load, so importing it here costs a
 * module and nothing else.
 */
import { describe, expect, it } from "vitest";
import { ALLOW_NEGATIVE_SOURCES as MODEL_ALLOW_NEGATIVE } from "../shared/dryRun/economicsModel";
import { ALLOW_NEGATIVE_SOURCES as LEDGER_ALLOW_NEGATIVE } from "./lib/ledger";

describe("the dry run's mirrors, against what they mirror", () => {
  it("holds exactly the ledger's allow-negative sources, in the ledger's own order", () => {
    /*
     * The keystone declares this at server/lib/ledger.ts:266 and says in as
     * many words that it is "static ON PURPOSE: extending it is a one-line
     * reviewed change to the keystone, not a runtime registration that can race
     * the boot invariant check". So the honest check is against the RUNTIME
     * VALUE and never against a list retyped here: a member added to the
     * keystone in that one-line change turns this red on the next run, which is
     * the whole point of the file.
     */
    const ledger = Array.from(LEDGER_ALLOW_NEGATIVE);
    expect(MODEL_ALLOW_NEGATIVE).toEqual(ledger);
    // Said again as text, so a failure prints both lists rather than a diff of
    // two arrays a reader then has to line up by eye.
    expect(`model: [${MODEL_ALLOW_NEGATIVE.join(",")}]`).toBe(`model: [${ledger.join(",")}]`);
    // And as a set, so a reordering of the keystone is reported as a reordering
    // and never as a missing member.
    expect(MODEL_ALLOW_NEGATIVE.slice().sort()).toEqual(ledger.slice().sort());
    // `reversal` is the member the mirror was missing. Named so the regression
    // has a test of its own rather than only a comparison.
    expect(MODEL_ALLOW_NEGATIVE).toContain("reversal");
    expect(MODEL_ALLOW_NEGATIVE).toHaveLength(ledger.length);
  });

  it("mirrors a SET as a list with no duplicates", () => {
    // The keystone holds a Set and the model holds an array, because the array
    // is what a preview prints in a sentence. A duplicate would make the two
    // disagree on length while agreeing on membership.
    const seen: Record<string, true> = {};
    for (const source of MODEL_ALLOW_NEGATIVE) {
      expect(seen[source], `${source} appears twice in the model's mirror`).toBeUndefined();
      seen[source] = true;
    }
    for (const source of MODEL_ALLOW_NEGATIVE) {
      expect(LEDGER_ALLOW_NEGATIVE.has(source), `${source} is not in the ledger's set`).toBe(true);
    }
  });
});
