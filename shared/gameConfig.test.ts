/**
 * The one file every fork inherits, and until now the only file in `shared/`
 * with no test.
 *
 * `shared/` carries 29 test files. This was not one of them, and this is the
 * file whose defaults thirteen founders each start from. When five identity
 * strings belonging to one village sat in it, nothing here said so.
 *
 * WHY THIS IS A VITEST FILE AND NOT ONLY A SCRIPT. `scripts/check-identity-keys.mjs`
 * holds the same rule and is the better tool for CI annotations, and it is a
 * standalone script, which means it runs only where somebody wired it into a
 * workflow. This file rides in `pnpm test`, which every lane already runs, so
 * the rule survives a workflow edit that drops the script. It is pure: no
 * database, no server, no fixtures on disk, and it does not care what proper
 * nouns anyone used.
 *
 * WHY THERE IS NO LIST OF BANNED WORDS HERE. Measured against the brand
 * guard's own pattern, two of the three strings that leaked one village's
 * identity into the platform defaults contain no village name at all
 * ("Co-Become the Most Beautiful Village", and a footer sentence naming only a
 * country). A word list structurally cannot see those. The property asserted
 * below is KEY PRESENCE: a slot is empty, or it holds a value the platform
 * itself approved, or it holds somebody's identity. That decides correctly
 * without knowing a single proper noun, and it is why adding a word list here
 * would make this test longer and weaker.
 *
 * DELIBERATELY OUT OF SCOPE. `season.timezone` and the seeded `season.seasons`
 * entries also describe a particular place and a particular year. They are not
 * in the identity block this file gates, and widening the gate is a decision
 * for whoever owns the season config rather than a line to add quietly here.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { claimPaths, GAME_CONFIG } from "./gameConfig";

/**
 * The guard's rule, loaded from the guard rather than restated.
 *
 * The specifier is built at runtime on purpose: `tsconfig.tests.json` is a CI
 * gate and does not include `scripts/`, so a static import of a `.mjs` there
 * would fail the typecheck rather than the thing being tested.
 *
 * Loaded in `beforeAll` rather than with a top-level await. The top-level form
 * ran green half a dozen times, including two full suite runs, and then failed
 * collection with `SyntaxError: Invalid or unexpected token` on the `await`
 * itself, which depends on how the file happened to be transformed that run. A
 * guard that reports a different answer depending on a cache is the failure
 * this whole file exists to catch, so the await lives inside an async function
 * where it is unambiguous.
 */
type IdentityGuard = {
  IDENTITY_KEYS: string[];
  NEUTRAL: Record<string, string[]>;
  KNOWN_PENDING: { key: string; since: string; why: string }[];
  PENDING_CEILING: number;
  parseConfigValues: (src: string) => Record<string, string> | null;
  isViolation: (key: string, value: string) => boolean;
};

let guard!: IdentityGuard;
let IDENTITY_KEYS!: string[];
let NEUTRAL!: Record<string, string[]>;
let KNOWN_PENDING!: { key: string; since: string; why: string }[];
let PENDING_CEILING!: number;
let isViolation!: (key: string, value: string) => boolean;
let PENDING_KEYS!: string[];

beforeAll(async () => {
  const url = new URL("../scripts/check-identity-keys.mjs", import.meta.url).href;
  guard = (await import(/* @vite-ignore */ url)) as IdentityGuard;
  ({ IDENTITY_KEYS, NEUTRAL, KNOWN_PENDING, PENDING_CEILING, isViolation } = guard);
  PENDING_KEYS = KNOWN_PENDING.map((p) => p.key);
});

/** Walk a dotted path into the real, typed config object. */
function valueAt(key: string): unknown {
  return key.split(".").reduce<unknown>(
    (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
    GAME_CONFIG,
  );
}

describe("platform identity defaults", () => {
  it("has every gated key present, so the rule cannot pass by finding nothing", () => {
    const absent = IDENTITY_KEYS.filter((key) => typeof valueAt(key) !== "string");
    expect(absent, "a renamed or removed key makes this test check less than it did yesterday").toEqual([]);
    expect(IDENTITY_KEYS.length).toBeGreaterThan(20);
  });

  it("carries no village's identity outside the known-pending list", () => {
    const populated = IDENTITY_KEYS.filter((key) => isViolation(key, valueAt(key) as string));
    expect(
      populated.filter((key) => !PENDING_KEYS.includes(key)),
      "every fork inherits this file, so a value here becomes every village's default",
    ).toEqual([]);
  });

  it("ships all nine image slots empty, because an empty slot is a real state", () => {
    // The six heroes, the two marks and the favicon. Empty means "this village
    // has not added its art yet", which every consumer already renders as a
    // placeholder. A URL here would be one village's private host, inherited.
    const images = GAME_CONFIG.images as unknown as Record<string, unknown>;
    const filled = Object.entries(images)
      .filter(([key]) => IDENTITY_KEYS.includes(`images.${key}`))
      .filter(([, value]) => value !== "");
    expect(filled).toEqual([]);
  });

  it("approves a non-empty value only where the platform declared one neutral", () => {
    for (const key of IDENTITY_KEYS) {
      const value = valueAt(key) as string;
      if (value === "" || PENDING_KEYS.includes(key)) continue;
      expect(NEUTRAL[key] ?? [], `${key} is populated, so it needs a declared neutral value`).toContain(value);
    }
  });
});

describe("the known-pending list", () => {
  /*
   * These five are STILL POPULATED at main on purpose. The live deployment
   * reads its identity from these defaults and its own record was never
   * seeded, so for these five the platform default is the only place those
   * values exist. The founder types them into the live Admin screen FIRST.
   * Blanking them first would delete the value and its only copy in one move,
   * which is the outage this whole effort exists to undo rather than repeat.
   *
   * THE LIST MUST REACH ZERO once those values are confirmed in the
   * deployment's own record. It only ever shrinks.
   */
  it("holds exactly the keys that are actually still populated", () => {
    const populated = IDENTITY_KEYS.filter((key) => isViolation(key, valueAt(key) as string));
    expect(
      populated.slice().sort(),
      "a pending entry for a key that is already clean is a standing permission to repopulate it",
    ).toEqual(PENDING_KEYS.slice().sort());
  });

  it("may only shrink, so growing it means editing the ceiling in the same diff", () => {
    expect(KNOWN_PENDING.length).toBe(PENDING_CEILING);
    expect(KNOWN_PENDING.length).toBeLessThanOrEqual(5);
  });

  it("dates every entry, so an old carve-out cannot pass for a new decision", () => {
    for (const entry of KNOWN_PENDING) {
      expect(entry.since, `${entry.key} needs the date it was recorded`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.why.length, `${entry.key} needs a reason`).toBeGreaterThan(20);
    }
  });
});

describe("the guard reading the same file this test imports", () => {
  /*
   * The script reads gameConfig.ts as TEXT, because it runs as plain node in
   * CI ahead of any TypeScript toolchain. A text reader can stop finding a key
   * without ever going red: it just checks one fewer thing and prints the same
   * green. This is the cross-check. The typed import below is the ground
   * truth, and the two readings have to agree key for key.
   */
  it("agrees with the typed object on every gated key", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(new URL("./gameConfig.ts", import.meta.url), "utf8");
    const parsed = guard.parseConfigValues(source);
    expect(parsed, "the script must be able to find the GAME_CONFIG literal at all").not.toBeNull();

    const disagreements = IDENTITY_KEYS.filter((key) => parsed![key] !== valueAt(key));
    expect(disagreements, "the text reader and the real object must see the same values").toEqual([]);
  });
});

describe("claimPaths: what may reach a member's paths column", () => {
  /*
   * PUT /api/profile used to be `if (paths) u.paths = paths` and wrote
   * whatever arrived. These are the cases that used to land in the database.
   * The route-level proof that a refusal writes nothing lives in
   * server/profilePaths.routes.e2e.test.ts; this half runs with no database
   * and therefore runs on every commit.
   */
  const offered = GAME_CONFIG.paths.map((p) => p.id);

  it("takes every id this build offers", () => {
    expect(claimPaths(offered)).toEqual({ ok: true, paths: offered });
  });

  it("reads an absent field as leave-my-paths-alone", () => {
    expect(claimPaths(undefined)).toEqual({ ok: true, paths: undefined });
  });

  it("reads an empty list as drop them all, which [] being truthy hid", () => {
    expect(claimPaths([])).toEqual({ ok: true, paths: [] });
  });

  it("refuses an id nothing has ever defined", () => {
    const out = claimPaths(["wizard"]);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toContain("wizard");
  });

  it("refuses everything that is not a list of strings", () => {
    for (const junk of [null, "investor", 7, { id: "investor" }, [7], [null], [["investor"]]]) {
      expect(claimPaths(junk as unknown).ok, JSON.stringify(junk)).toBe(false);
    }
  });

  it("collapses duplicates and keeps the order it was given", () => {
    expect(claimPaths(["steward", "investor", "steward"])).toEqual({
      ok: true,
      paths: ["steward", "investor"],
    });
  });

  it("survives a held value that is not a list of ids", () => {
    // The rows the unvalidated route already wrote. `fromJsonCol` in the users
    // repo hands back whatever JSON it finds, so these reach the guard as they
    // stand, and a `held.map` on one of them would answer a member's first
    // claim with a 500 rather than a saved path.
    for (const junk of [null, "investor", 7, { a: 1 }, undefined]) {
      expect(claimPaths(["steward"], junk as unknown)).toEqual({ ok: true, paths: ["steward"] });
    }
    // A list that is only PARTLY ids keeps the ids and ignores the rest.
    expect(claimPaths(["hermit"], ["hermit", 7, null]).ok).toBe(true);
  });

  it("lets a member keep an id this build no longer offers", () => {
    // A village that retires a path must not lock the members holding it out
    // of the control entirely: their own stored value would fail validation
    // and take down the request that drops it.
    expect(claimPaths(["hermit", "steward"], ["hermit"])).toEqual({
      ok: true,
      paths: ["hermit", "steward"],
    });
    // And it stays theirs alone. Nobody else can claim it.
    expect(claimPaths(["hermit"], []).ok).toBe(false);
  });
});
