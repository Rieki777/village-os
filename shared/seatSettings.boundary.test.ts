/**
 * MONEY IN A SEAT'S TERMS IS A RECORD, AND THIS IS THE WALL THAT KEEPS IT ONE.
 *
 * Pay, allowance and bonus in shared/seatSettings.ts are words and numbers
 * somebody wrote down. Nothing may read them to post, pay, settle, promote or
 * release value. So no module that moves value is allowed to reach this file,
 * directly or through anything it imports: the ledger, the economy and its
 * seeds, the exchange, payments, redemption, minting, treasuries, cycle
 * settlement, the `role.cycle` pay path, and the Contributor promotion path.
 *
 * The walk follows relative and `@shared/` imports transitively, so a helper
 * that imports the settings model and is imported by the ledger is caught,
 * not only a direct import. Two controls keep it honest: the subject list is
 * not empty, and the walk does find the settings model from a module that is
 * known to reach it.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const TARGET = path.join(ROOT, "shared", "seatSettings.ts");

/** The modules that move value, by name, under server/lib, server/routes and shared. */
const SUBJECT = /(ledger|econom|settle|settlement|exchange|payment|payout|redemption|mint|faucet|treasury|swap|cyclePool|gratitude-cycles|contributionPay|admission|vouches|dryRun)/i;
const SUBJECT_DIRS = ["server/lib", "server/routes", "shared", "shared/dryRun"];
/** `role.cycle` is a capability key, and the files that act on it are subjects too. */
const ROLE_CYCLE = /["']role\.cycle["']/;

const isSource = (f: string) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && !f.endsWith(".d.ts");

function subjects(): string[] {
  const out = new Set<string>();
  for (const dir of SUBJECT_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      const file = path.join(abs, name);
      if (!fs.statSync(file).isFile() || !isSource(name)) continue;
      if (SUBJECT.test(name) || ROLE_CYCLE.test(fs.readFileSync(file, "utf8"))) out.add(file);
    }
  }
  // server/index.ts names role.cycle, and it is the composition root: it
  // imports every route, so it is no subject. The routes it mounts are.
  out.delete(path.join(ROOT, "server", "index.ts"));
  return Array.from(out).sort();
}

const IMPORT = /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g;

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@shared/")) base = path.join(ROOT, "shared", spec.slice("@shared/".length));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** The import chain from `entry` to `target`, or null when there is none. */
function chainTo(entry: string, target: string): string[] | null {
  const seen = new Set<string>([entry]);
  const queue: Array<{ file: string; chain: string[] }> = [{ file: entry, chain: [entry] }];
  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;
    if (file === target) return chain;
    let src: string;
    try {
      src = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const m of src.matchAll(IMPORT)) {
      const next = resolve(file, m[1] ?? m[2] ?? m[3]);
      if (!next || seen.has(next)) continue;
      seen.add(next);
      queue.push({ file: next, chain: [...chain, next] });
    }
  }
  return null;
}

const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, "/");

describe("no value-moving module reaches the seat settings model", () => {
  const list = subjects();

  it("finds the modules it is about", () => {
    const names = list.map(rel);
    for (const must of ["server/lib/ledger.ts", "server/lib/economy.ts", "server/lib/cycleSettlement.ts", "server/lib/contributionPay.ts", "shared/moonSettlement.ts"]) {
      expect(names, must).toContain(must);
    }
    expect(list.length).toBeGreaterThan(15);
  });

  it("holds every one of them away from shared/seatSettings.ts, transitively", () => {
    const reached = list.flatMap((f) => {
      const chain = chainTo(f, TARGET);
      return chain ? [chain.map(rel).join(" -> ")] : [];
    });
    expect(reached).toEqual([]);
  });

  it("control: the walk does find the model from a module that imports it", () => {
    const chain = chainTo(path.join(ROOT, "shared", "seatPresets.ts"), TARGET);
    expect(chain?.map(rel)).toEqual(["shared/seatPresets.ts", "shared/seatSettings.ts"]);
  });
});
