/**
 * THE CONTRACT'S TWO GUARDS.
 *
 * `types.ts` is built to compile on a branch cut from `main`, because the
 * economics session builds its model there and a contract that only compiles
 * beside its author is not shared. Holding to that costs two things, and this
 * file is both of them.
 *
 * FIRST, the vocabularies are declared in `types.ts` instead of imported, so
 * they are copies, and a copy can drift from what it copied. The tests below
 * import the engine's own arrays and compare them member by member, at
 * runtime and again at compile time in both directions. A rename in
 * `shared/ballotSubjects.ts` fails here, before it can reach a preview
 * that quietly stops recognising a kind of change.
 *
 * SECOND, the rule that keeps it that way is not a promise in a comment. The
 * import guard reads every file in this directory off disk and says which of
 * them name the governance engine or anything under `server/`. It carries an
 * exact allowlist and never a blocklist: `governanceModel.ts` is
 * governance-owned and may call the engine's helpers, this file may name
 * `shared/ballotSubjects.ts` because comparing against it is its whole job,
 * and every other file must come back empty. It also pins the COMPLETE import
 * list of `types.ts`, `rng.ts` and `simulate.ts`, so an addition fails here
 * even when the file added is harmless.
 *
 * `simulate.test.ts` walks the graph TRANSITIVELY for connections. This walks
 * it one step, for ownership. Both are needed: the first says the preview
 * cannot write, the second says the contract still travels.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHANGE_ITEM_KINDS as ENGINE_CHANGE_ITEM_KINDS, type ChangeItemKind as EngineChangeItemKind } from "../ballotSubjects";
import { LIFECYCLE_RANK, type ModuleLifecycle } from "../modules";
import { CHANGE_ITEM_KINDS, LIFECYCLES, type ChangeItemKind, type Lifecycle } from "./types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..").split(path.sep).join("/");

describe("the change item kinds", () => {
  it("holds exactly the engine's list, in the engine's order", () => {
    expect(CHANGE_ITEM_KINDS.slice()).toEqual(ENGINE_CHANGE_ITEM_KINDS.slice());
  });

  it("names the seven the engine prices, so a green above is not a green about two empty lists", () => {
    expect(CHANGE_ITEM_KINDS.slice().sort()).toEqual([
      "brand_field",
      "dial",
      "mint_rule",
      "mode_switch",
      "module_lifecycle",
      "role",
      "weight_allocation",
    ]);
  });

  it("is the same TYPE as the engine's, in both directions", () => {
    // These four lines are the assertion. `tsconfig.tests.json` is a CI gate,
    // so a union that gained or lost a member fails the typecheck even if the
    // arrays above were somehow edited to agree with each other.
    const asEngine: EngineChangeItemKind = "dial" as ChangeItemKind;
    const asLocal: ChangeItemKind = "dial" as EngineChangeItemKind;
    expect([asEngine, asLocal]).toEqual(["dial", "dial"]);
  });
});

describe("the lifecycles", () => {
  it("holds exactly the postures `shared/modules.ts` ranks", () => {
    expect(LIFECYCLES.slice()).toEqual(Object.keys(LIFECYCLE_RANK));
  });

  it("is the same TYPE as the engine's, in both directions", () => {
    const asEngine: ModuleLifecycle = "off" as Lifecycle;
    const asLocal: Lifecycle = "off" as ModuleLifecycle;
    expect([asEngine, asLocal]).toEqual(["off", "off"]);
  });
});

/**
 * WHO MAY NAME THE ENGINE, READ OFF DISK.
 */
describe("the import guard", () => {
  /** Every file in this directory. Pinned, so a new one cannot go unchecked. */
  const EXPECTED_FILES = [
    "governanceModel.test.ts",
    "governanceModel.ts",
    "rng.test.ts",
    "rng.ts",
    "simulate.test.ts",
    "simulate.ts",
    "types.test.ts",
    "types.ts",
  ];

  /**
   * The only files that may name a forbidden module, and exactly which one
   * each may name. An allowlist and not a blocklist: a file added to this
   * directory starts with nothing allowed.
   */
  const ALLOWED: Record<string, string[]> = {
    "governanceModel.ts": ["shared/ballotSubjects", "shared/governanceEngine"],
    "types.test.ts": ["shared/ballotSubjects"],
  };

  /** The complete import list of the three files the economics session ships. */
  const EXACT: Record<string, string[]> = {
    "types.ts": ["../cycleClock"],
    "rng.ts": ["./types"],
    "simulate.ts": ["../cycleClock", "./rng", "./types"],
  };

  const specifiersIn = (file: string): string[] => {
    const source = fs.readFileSync(path.join(HERE, file), "utf8");
    const found: string[] = [];
    const patterns = [
      /\bfrom\s+["']([^"']+)["']/g,
      /\bimport\s+["']([^"']+)["']/g,
      /\brequire\(\s*["']([^"']+)["']\s*\)/g,
      /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    ];
    for (const pattern of patterns) {
      let match = pattern.exec(source);
      while (match) {
        found.push(match[1]);
        match = pattern.exec(source);
      }
    }
    return Array.from(new Set(found)).sort();
  };

  /**
   * Which forbidden module a specifier names, or null. Relative specifiers are
   * resolved against the file that wrote them, so `../../server/lib/economy`
   * is caught by where it lands and not by how it is spelled. The two path
   * aliases `tsconfig.json` declares are expanded for the same reason.
   */
  const forbidden = (spec: string, from: string): string | null => {
    const target = spec.startsWith(".")
      ? path.resolve(path.dirname(path.join(HERE, from)), spec).split(path.sep).join("/")
      : spec.replace(/^@shared\//, `${REPO}/shared/`).replace(/^@\//, `${REPO}/client/src/`);
    if (/(^|\/)server\//.test(target)) return "server/";
    if (/\/shared\/ballotSubjects(\.tsx?)?$/.test(target)) return "shared/ballotSubjects";
    if (/\/shared\/gameVariables(\.tsx?)?$/.test(target)) return "shared/gameVariables";
    if (/\/shared\/governanceEngine(\.tsx?)?$/.test(target)) return "shared/governanceEngine";
    return null;
  };

  const forbiddenIn = (file: string): string[] => {
    const hits = specifiersIn(file)
      .map((spec) => forbidden(spec, file))
      .filter((name): name is string => name !== null);
    return Array.from(new Set(hits)).sort();
  };

  it("is looking at every file in this directory and no others", () => {
    const onDisk = fs
      .readdirSync(HERE)
      .filter((f) => f.endsWith(".ts"))
      .sort();
    expect(onDisk).toEqual(EXPECTED_FILES);
  });

  it("finds the imports it is supposed to be reading, so a green is not an empty read", () => {
    // The guard is a regex over source text. If the regex ever stopped
    // matching, every file would come back clean and every assertion below
    // would pass while checking nothing.
    expect(specifiersIn("simulate.ts")).toEqual(["../cycleClock", "./rng", "./types"]);
    expect(forbiddenIn("governanceModel.ts")).toContain("shared/governanceEngine");
  });

  it("lets only the allowlisted files name the governance engine", () => {
    for (const file of EXPECTED_FILES) {
      expect(forbiddenIn(file), file).toEqual(ALLOWED[file] ?? []);
    }
  });

  it("lets nothing here name anything under server/, with no exception", () => {
    for (const file of EXPECTED_FILES) {
      expect(forbiddenIn(file), file).not.toContain("server/");
    }
  });

  it("pins the whole import list of the three files the contract travels as", () => {
    for (const file of Object.keys(EXACT)) {
      expect(specifiersIn(file), file).toEqual(EXACT[file]);
    }
  });

  it("proves those three name nothing outside this directory but the clock", () => {
    for (const file of Object.keys(EXACT)) {
      const outside = specifiersIn(file).filter((spec) => !spec.startsWith("./"));
      expect(outside, file).toEqual(outside.filter((spec) => spec === "../cycleClock"));
    }
  });
});
