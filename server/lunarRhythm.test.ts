/**
 * THE RHYTHM IS A SETTING AGAIN, AND THIS TIME SOMETHING READS IT.
 *
 * ── WHAT THIS FILE USED TO PIN, AND WHY IT NO LONGER DOES ──────────────────
 *
 * It pinned "one rhythm, and it is the moon". That was Rye's ruling of
 * 2026-08-29 ("leave it off and retire it. let's just stick with lunar months
 * all around"), and migration `0108` carried it out.
 *
 * He reversed it on 2026-09-02, answering Q5 of the governance brief: "Yes the
 * cycle structure can be changed." So the rule this file protected is now the
 * wrong rule and the tests that stated it are rewritten here rather than
 * deleted, because the DEFECT behind the retirement has not changed at all and
 * still needs pinning.
 *
 * ── THE DEFECT, WHICH IS THE PART THAT SURVIVES ────────────────────────────
 *
 * `gratitude.cycle_mode` was a live dial in the admin panel offering "lunar"
 * or "month", reported to every client at `/api/game/rules` as `cycleMode`,
 * and read by exactly one line of code: a branch inside `currentCycleId()`
 * with no callers by that name anywhere else. A founder could switch the
 * village's whole gratitude rhythm and nothing at all changed. The product
 * stated a rhythm it did not keep.
 *
 * So what these tests hold shut now is the SHAPE and not the feature:
 *
 *  1. The retired key never comes back by its old name. A village that once
 *     stored `gratitude.cycle_mode` had its row deleted by `0108`, and a key
 *     with that spelling would silently inherit rows nobody chose.
 *  2. `cycle.mode` exists, is constitutional, and HAS A READER, proven by
 *     calling the boot assertion rather than by reading a promise in a doc.
 *  3. The old `YYYY-MM` ids are still refused out loud. `0105` decided they
 *     are never remapped, and a calendar clock that could read them would turn
 *     a loud refusal into a silently wrong total.
 *
 * COMMENTS ARE STRIPPED FIRST, so the rule is "name the retired key in a
 * comment, and nowhere else". Explaining a removal where it happened is the
 * whole point of the removal. TESTS ARE SKIPPED for the same reason: a test is
 * where an absence gets asserted, so it has to be able to say the name.
 *
 * The scan carries a control in the same run: the sibling gratitude dials must
 * still be found, so a scan that has stopped seeing anything fails here before
 * it can pass as a clean sweep.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VARIABLES, VARIABLES_BY_KEY, criticalityOf } from "../shared/gameVariables";
import {
  activeClock,
  assertCycleSettingsRead,
  cycleIdFor,
  cycleSettingKeys,
  unreadableCycleIds,
  unreadableCycleProblem,
} from "./lib/gratitude-cycles";
import { CYCLE_SETTING_READERS, cycleSettingsProblem } from "../shared/cycleClock";

const ROOT = path.resolve(__dirname, "..");
const IS_TEST = /\.(test|spec)\.tsx?$/;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /\/\/[^\n]*/g;

/**
 * The RETIRED key by its own spelling, and the wire field it was reported
 * under. Deliberately not a loose `cycleMode` match any more: the seam's own
 * functions are named for the setting they serve (`cycleModeSwitchProblem`,
 * `nextCycleModeLandingInstant`), and forbidding a well-named identifier
 * would push the next reader toward a worse name for the same thing.
 */
const RETIRED_KEY = /gratitude\.cycle_mode|["'`]cycleMode["'`]|cycleMode\s*:/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (full: string) => path.relative(ROOT, full);
const code = (full: string) =>
  fs.readFileSync(full, "utf8").replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, " ");

const sources = [
  ...walk(path.join(ROOT, "server")),
  ...walk(path.join(ROOT, "shared")),
  ...walk(path.join(ROOT, "client", "src")),
].filter((f) => !IS_TEST.test(path.basename(f)));

describe("the retired dial never comes back by its old name", () => {
  it("scans a tree it can actually see", () => {
    expect(sources.length, "the scan must find source files").toBeGreaterThan(200);
    // The control. These two gratitude dials stay, so a scan that has gone
    // blind cannot report the retired one as absent.
    const stillHere = sources.filter((f) => code(f).includes("gratitude.base_budget"));
    expect(stillHere.length, "the sibling gratitude dials must still be found").toBeGreaterThan(0);
  });

  it("offers no variable under the retired key", () => {
    expect(VARIABLES_BY_KEY["gratitude.cycle_mode"]).toBeUndefined();
    expect(VARIABLES.filter((v) => v.key === "gratitude.cycle_mode")).toEqual([]);
  });

  it("names the retired key and its old wire field in no live code anywhere in the tree", () => {
    const hits = sources.filter((f) => RETIRED_KEY.test(code(f))).map(rel);
    expect(hits, `these files still carry the retired rhythm dial: ${hits.join(", ")}`).toEqual([]);
  });
});

describe("the rhythm setting that replaced it is read", () => {
  it("exists, offers the moon and the calendar month, and defaults to the moon", () => {
    const def = VARIABLES_BY_KEY["cycle.mode"];
    expect(def).toBeDefined();
    expect(def.default).toBe("lunar");
    expect(def.choices?.map((c) => c.value).sort()).toEqual(["calendar", "lunar"]);
  });

  it("asks for the constitutional bar, because it re-times every other number", () => {
    expect(criticalityOf(VARIABLES_BY_KEY["cycle.mode"])).toBe("constitutional");
  });

  it("HAS A READER, and the boot assertion proves it by calling it", () => {
    expect(CYCLE_SETTING_READERS["cycle.mode"]).toBeTypeOf("function");
    expect(() => assertCycleSettingsRead()).not.toThrow();
    expect(activeClock().mode).toBe("lunar");
  });

  it("would REFUSE THE BOOT if a consumer were removed: the positive control", () => {
    // The exact shape `gratitude.cycle_mode` shipped in: the setting is on the
    // panel and nothing reads it.
    const problem = cycleSettingsProblem(["cycle.mode"], {}, () => "lunar");
    expect(problem).toContain("nothing in this build reads it");
  });

  it("takes the keys it checks from the REGISTRY, so a new one cannot slip in unread", () => {
    // The guard asks the variable registry what a member can see, never the
    // readers map. Asking the readers would only prove that every reader has
    // a reader, which is the check that would have passed all the way through
    // the defect 0108 retired the old dial for.
    expect(cycleSettingKeys()).toContain("cycle.mode");
    expect(cycleSettingKeys().every((k) => k in CYCLE_SETTING_READERS)).toBe(true);
    // A second rhythm key landing with no reader is a boot failure, named.
    const problem = cycleSettingsProblem(
      [...cycleSettingKeys(), "cycle.week_starts_on"],
      CYCLE_SETTING_READERS,
      () => "lunar",
    );
    expect(problem).toContain("cycle.week_starts_on");
    expect(problem).toContain("nothing in this build reads it");
  });

  it("stamps every new acknowledgement with an id carrying its clock", () => {
    expect(cycleIdFor(new Date("2026-08-29T00:00:00Z"))).toMatch(/^lunar-\d{6}$/);
  });
});

describe("a rhythm setting does not quietly reinterpret an old row", () => {
  /**
   * The decision migration 0105 recorded and this must not undo: legacy
   * "YYYY-MM" rows are NOT remapped, because there is no honest way to compute
   * a lunation from a calendar month. A village holding them meets a refusal
   * naming the ids rather than a silently wrong total. That matters MORE now
   * that calendar months are an option again, which is why the new clock takes
   * a `month-` prefix of its own.
   */
  const legacy = [
    { id: "g1", fromId: "a", toId: "b", amount: 10, cycleId: "2026-07" },
    { id: "g2", fromId: "a", toId: "c", amount: 5, cycleId: cycleIdFor() },
  ];

  it("still cannot read a calendar-month id", () => {
    expect(unreadableCycleIds(legacy)).toEqual(["2026-07"]);
  });

  it("still refuses out loud, naming the id", () => {
    const problem = unreadableCycleProblem(legacy);
    expect(problem).toBeTruthy();
    expect(problem).toContain("2026-07");
  });

  it("does not read a legacy id as one of the new calendar ids either", () => {
    expect(unreadableCycleIds([{ id: "g3", fromId: "a", toId: "b", amount: 1, cycleId: "month-2026-07" }]))
      .toEqual([]);
    expect(unreadableCycleIds([{ id: "g4", fromId: "a", toId: "b", amount: 1, cycleId: "2026-07" }]))
      .toEqual(["2026-07"]);
  });
});
