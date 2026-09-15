/**
 * Every ledger source the server writes has been decided on.
 *
 * `LEDGER_SOURCE_PAYS_A_CONTRIBUTION` is an allowlist, so a source it has never
 * heard of fails closed: nobody is promoted by it. That is the safe failure for
 * a rung that opens `member.vouch`, and it is still a failure, because a new way
 * of paying people would quietly promote nobody. This file turns that into a
 * question asked in review.
 *
 * ── WHAT THE SCAN CAN AND CANNOT SEE ────────────────────────────────────────
 *
 * It reads what is written on the right of every `source:` key in server code:
 * each string literal, including both arms of a ternary, and the value of any
 * SCREAMING_CASE constant the expression names. A snake_case word with an
 * underscore counts as a ledger source; every ledger source in the tree has
 * that shape except `reversal`, which is named explicitly, and every other
 * `source:` field in the server ("uploaded", "admin", "hub") is a single word.
 *
 * THE CONSTANTS WERE A BLIND SPOT, found by the economics session: seven of
 * wt/econ's sources are written as `source: HOLD_SOURCE` and the first version
 * of this scan skipped every one. They are resolved by NAME through every
 * `const NAME = "value"` in the server, so two files declaring one name with
 * different values would confuse it. A source built at runtime, spelled as a
 * single word, or reached through a property (`SOURCES.hold`) still slips past,
 * and fails closed. The scan's own mechanism is tested on a fixture below, so
 * it is proven even while main writes no source through a constant.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { contributionSources, LEDGER_SOURCE_PAYS_A_CONTRIBUTION } from "./contributionPay";

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function serverFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) serverFiles(full, out);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Every `const NAME = "snake_value"` across the given sources, by name. */
function constantValues(bodies: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const body of bodies) {
    const decl = /\bconst\s+([A-Z][A-Z0-9_]*)\s*(?::[^=\n]+)?=\s*["'`]([a-z][a-z0-9_]*)["'`]/g;
    let d: RegExpExecArray | null;
    while ((d = decl.exec(body)) !== null) out.set(d[1], d[2]);
  }
  return out;
}

/** Everything a `source:` key is given: its literals, and the constants it names. */
function sourcesIn(body: string, constants: ReadonlyMap<string, string>): string[] {
  const found: string[] = [];
  const key = /\bsource:\s*([^,\n}]+)/g;
  let m: RegExpExecArray | null;
  while ((m = key.exec(body)) !== null) {
    const literal = /["'`]([a-z][a-z0-9_]*)["'`]/g;
    let l: RegExpExecArray | null;
    while ((l = literal.exec(m[1])) !== null) found.push(l[1]);
    const identifier = /\b([A-Z][A-Z0-9_]+)\b/g;
    let i: RegExpExecArray | null;
    while ((i = identifier.exec(m[1])) !== null) {
      const value = constants.get(i[1]);
      if (value) found.push(value);
    }
  }
  return found;
}

const looksLikeALedgerSource = (s: string) => /^[a-z]+(_[a-z0-9]+)+$/.test(s) || s === "reversal";

const files = serverFiles(SERVER);
const bodies = files.map((file) => fs.readFileSync(file, "utf8"));
const constants = constantValues(bodies);
const seen = new Map<string, string>();
files.forEach((file, index) => {
  for (const s of sourcesIn(bodies[index], constants)) {
    if (looksLikeALedgerSource(s) && !seen.has(s)) seen.set(s, path.relative(SERVER, file).split(path.sep).join("/"));
  }
});

describe("the scan itself", () => {
  it("reads a literal, both arms of a ternary, and a constant the server declares", () => {
    const body = [
      'const TREASURY_SPEND_SOURCE = "circle_treasury_spend";',
      'export const HOLD_SOURCE: string = "redemption_hold";',
      'await postTransfer(pool, { source: "quest_consent", amount });',
      'await postTransfer(pool, { source: amount > 0 ? "library_manual" : "library_burn" });',
      "await postTransfer(pool, { from, to, source: TREASURY_SPEND_SOURCE, amount });",
      "await postTransfer(pool, { source: HOLD_SOURCE });",
    ].join("\n");
    expect(sourcesIn(body, constantValues([body])).sort()).toEqual([
      "circle_treasury_spend",
      "library_burn",
      "library_manual",
      "quest_consent",
      "redemption_hold",
    ]);
  });
});

describe("every ledger source the server writes has an answer", () => {
  it("finds the sources it is meant to find, so an empty scan cannot pass", () => {
    // One of each shape the server uses today: a plain literal, an argument to
    // a wrapper, and both arms of a ternary.
    for (const known of ["quest_consent", "stay_purchase", "exchange_swap", "quest_stay_reward", "library_manual", "library_burn"]) {
      expect(seen.has(known), `the scan found no "${known}" in ${files.length} server files`).toBe(true);
    }
    expect(seen.size, `the scan found ${seen.size} sources in ${files.length} server files`).toBeGreaterThanOrEqual(25);
  });

  it("has decided, for every one, whether it is the village paying somebody", () => {
    const undecided = Array.from(seen.entries())
      .filter(([source]) => !(source in LEDGER_SOURCE_PAYS_A_CONTRIBUTION))
      .map(([source, file]) => `${source} (${file})`);
    expect(
      undecided,
      "add each to LEDGER_SOURCE_PAYS_A_CONTRIBUTION in server/lib/contributionPay.ts: true only when it is the village paying somebody for what they brought it",
    ).toEqual([]);
  });
});

describe("contributionSources", () => {
  it("never counts buying your own stay or a product, a swap, or a gift between members", () => {
    for (const s of ["stay_purchase", "product_grant", "exchange_swap", "member_send", "gratitude_received"]) {
      expect(contributionSources()).not.toContain(s);
    }
  });

  it("counts a quest, a seat, the value pool, a stake bought with money, and a resource brought in", () => {
    for (const s of ["quest_consent", "role_cycle", "gratitude_pool", "exchange_purchase", "library_intake"]) {
      expect(contributionSources()).toContain(s);
    }
  });
});
