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
 * It reads every string literal written on the right of a `source:` key in
 * server code, including both arms of a ternary, and treats a snake_case word
 * with an underscore as a ledger source. Every ledger source in the tree has
 * that shape except `reversal`, which is named explicitly; every other
 * `source:` field in the server ("uploaded", "admin", "hub") is a single word.
 * A future ledger source written as a single word, or computed at runtime,
 * slips past, and fails closed. The first case below exists so an empty or
 * broken scan cannot pass as a clean one.
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

/** Every string literal on the right of a `source:` key, as written. */
function sourceLiterals(body: string): string[] {
  const found: string[] = [];
  const key = /\bsource:\s*([^,\n}]+)/g;
  let m: RegExpExecArray | null;
  while ((m = key.exec(body)) !== null) {
    const literal = /["'`]([a-z][a-z0-9_]*)["'`]/g;
    let l: RegExpExecArray | null;
    while ((l = literal.exec(m[1])) !== null) found.push(l[1]);
  }
  return found;
}

const looksLikeALedgerSource = (s: string) => /^[a-z]+(_[a-z0-9]+)+$/.test(s) || s === "reversal";

const files = serverFiles(SERVER);
const seen = new Map<string, string>();
for (const file of files) {
  for (const s of sourceLiterals(fs.readFileSync(file, "utf8"))) {
    if (looksLikeALedgerSource(s) && !seen.has(s)) seen.set(s, path.relative(SERVER, file).split(path.sep).join("/"));
  }
}

describe("every ledger source the server writes has an answer", () => {
  it("finds the sources it is meant to find, so an empty scan cannot pass", () => {
    // One of each shape: a plain literal, an argument to a wrapper, and both
    // arms of a ternary.
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
