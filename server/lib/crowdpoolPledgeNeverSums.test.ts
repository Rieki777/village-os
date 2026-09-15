/**
 * THE PLEDGE TOTAL AND ITS FINANCIAL SUBTOTAL ARE NEVER ADDED, AND THIS IS THE
 * ONE SPELLING OF THAT RULE.
 *
 * The hub stores a financial pledge in TWO fields: `pledgedTotal`, the
 * campaign-wide pledged value, and `pledgedFinancial`, the financial subtotal
 * INSIDE it. The Crowdpooling session measured three of their own surfaces
 * adding the two together, so a ten thousand pledge reads as twenty thousand on
 * their public gallery headline (measured against a scratch database of theirs,
 * 2026-09-04, and relayed to this lane). This bridge reads them as separate
 * fields and divides using the total alone.
 *
 * SO OUR NUMBER IS RIGHT WHERE THEIR GALLERY IS WRONG, and that is exactly the
 * shape that gets "fixed" into a defect. A later lane opens the hub's public
 * page beside `/campaign/:slug`, sees our figure at half of theirs, reads that
 * as our bug, and makes ours match. Nothing in either repository's tests would
 * have caught it: the arithmetic stays plausible, the ring still fills, and the
 * only witness was a comment.
 *
 * The pin has two halves, because either alone is weak.
 *
 *   THE BEHAVIOUR. `normalizeCampaign` is driven with the subtotal set to zero,
 *   absent, and equal to the whole pledged total, and the ring must not move.
 *   An absent field and a zero field are different facts on the wire and must
 *   reach the same ring, which is the closest a value test can get to "this
 *   number does not depend on that one".
 *
 *   THE SPELLING. Every file in the bridge that names either field is scanned
 *   for an expression that adds them. The file list is DERIVED, never typed: it
 *   is every non-test source file under `server/` and `client/src` whose text
 *   names either field, which is complete by construction, because code that
 *   sums the two has to name them both. A typed list would go stale the day a
 *   route module moved, which is how a sibling pin in this repository went from
 *   "exactly one door" to "zero doors" and stayed green. The derivation is
 *   asserted non-empty and asserted to contain the known homes, so a rename
 *   that empties it fails loudly instead of passing vacuously.
 *
 * ── WHAT THIS CANNOT SEE, STATED PLAINLY ───────────────────────────────────
 *
 * It reads text, so it catches an addition written as one. It does not catch a
 * sum assembled across a variable and a function boundary (`let t =
 * campaign.pledgedTotal; t += subtotalFrom(campaign)`), and it cannot catch a
 * sum performed on the hub before the bytes arrive. It also reads comments,
 * which is deliberate: a comment that shows the two names joined by a plus sign
 * is how the next lane learns the wrong spelling, so it fails too. The
 * behavioural half is what covers `normalizeCampaign` itself; nothing covers a
 * consumer that has not been written yet, beyond this file failing on it.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeCampaign } from "./crowdpool";

const ROOT = path.resolve(__dirname, "..", "..");

/** The two names the rule is about. */
const TOTAL = "pledgedTotal";
const SUBTOTAL = "pledgedFinancial";

// ── The behaviour: the ring does not depend on the subtotal ──────────────────

const HUB = {
  id: 79,
  title: "Harmony Valley Ecovillage",
  status: "active",
  currency: "USD",
  totalValue: 20000,
  pledgedTotal: 10000,
  financialTarget: 500000,
  pledgedFinancial: 10000,
  contributorsCount: 7,
  items: [],
};

const ring = (byId: Record<string, unknown>) =>
  normalizeCampaign(byId, [], [], [], { baseUrl: "https://hub.example.test", now: 0 });

describe("the ring divides by the pledged total alone", () => {
  /**
   * The hub's own gallery headlines this campaign at twenty thousand of twenty
   * thousand, a full ring, because it adds the subtotal to the total it is
   * already inside. Ten thousand of twenty thousand is fifty percent.
   */
  it("reads fifty percent where the hub's gallery would headline a hundred", () => {
    expect(ring(HUB).percentPledged).toBe(50);
  });

  it("gives the same ring whether the subtotal is absent, zero, or the whole of it", () => {
    const { pledgedFinancial: _drop, ...withoutTheField } = HUB;
    const absent = ring(withoutTheField);
    const zero = ring({ ...HUB, pledgedFinancial: 0 });
    const whole = ring(HUB);
    expect(absent.percentPledged).toBe(50);
    expect(zero.percentPledged).toBe(50);
    expect(whole.percentPledged).toBe(50);
    expect(absent.pledgedTotal).toBe(10000);
    expect(whole.pledgedTotal).toBe(10000);
  });

  it("carries the subtotal through as its own field, untouched", () => {
    expect(ring(HUB).pledgedFinancial).toBe(10000);
    expect(ring({ ...HUB, pledgedFinancial: 8500 }).pledgedFinancial).toBe(8500);
    // And moving the subtotal alone moves nothing about the ring.
    expect(ring({ ...HUB, pledgedFinancial: 8500 }).percentPledged).toBe(50);
  });

  it("keeps the financial TARGET off the ring's denominator the same way", () => {
    // financialTarget is 500000 on the fixture and totalValue is 20000. A ring
    // that had swallowed either into the other could not answer 50.
    expect(ring(HUB).totalValue).toBe(20000);
    expect(ring(HUB).financialTarget).toBe(500000);
    expect(ring({ ...HUB, financialTarget: 0 }).percentPledged).toBe(50);
  });
});

// ── The spelling: nothing in the bridge adds the two ─────────────────────────

/**
 * Every non-test source file under `server/` and `client/src` that names either
 * field. Complete by construction: an addition of the two has to name them.
 */
function bridgeFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        walk(child);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (entry.name.includes(".test.") || entry.name.includes(".spec.")) continue;
      const src = readFileSync(path.join(ROOT, child), "utf8");
      if (src.includes(TOTAL) || src.includes(SUBTOTAL)) out.push(child);
    }
  };
  walk("server");
  walk("client/src");
  return out.sort();
}

/** Carriage returns come off first: an anchored rule never matches past one. */
const lines = (src: string) => src.replace(/\r/g, "").split("\n");

/** Whitespace flattened, so a sum wrapped across lines is still one expression. */
const flat = (src: string) => src.replace(/\s+/g, " ");

/**
 * Every place the two names appear within reach of each other, with whatever
 * sits between them and a short TAIL past the second one.
 *
 * 120 characters between is wide enough for a wrapped expression and narrow
 * enough that two unrelated mentions in the same paragraph do not pair. The
 * 40-character tail exists because the operator is not always between the two
 * names: `[a.total, a.subtotal].reduce((x, y) => x + y, 0)` puts them side by
 * side and does the adding afterwards, and that shape was measured slipping
 * past a reader that stopped at the second name.
 */
const BETWEEN = 120;
const TAIL = 40;

function neighbourhoods(src: string): string[] {
  const text = flat(src);
  const found: string[] = [];
  const re = new RegExp(`${TOTAL}|${SUBTOTAL}`, "g");
  const hits = Array.from(text.matchAll(re)).map((m) => ({ name: m[0], at: m.index ?? 0 }));
  for (let i = 0; i < hits.length; i += 1) {
    for (let j = i + 1; j < hits.length; j += 1) {
      if (hits[j].name === hits[i].name) continue;
      const gap = hits[j].at - (hits[i].at + hits[i].name.length);
      if (gap < 0 || gap > BETWEEN) continue;
      found.push(text.slice(hits[i].at, hits[j].at + hits[j].name.length + TAIL));
    }
  }
  return found;
}

/** The operators that would make a neighbourhood a sum. */
const ADDS = /\+|\breduce\s*\(|\bsum\s*\(/;

describe("no file in the bridge adds the pledged total to its financial subtotal", () => {
  const files = bridgeFiles();

  it("derives a bridge that is not empty and holds the homes the rule is about", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain("server/lib/crowdpool.ts");
    expect(files).toContain("client/src/pages/CrowdpoolCampaign.tsx");
  });

  it("finds no line naming both fields beside a plus sign", () => {
    const offenders: string[] = [];
    for (const file of files) {
      lines(readFileSync(path.join(ROOT, file), "utf8")).forEach((line, i) => {
        if (line.includes(TOTAL) && line.includes(SUBTOTAL) && line.includes("+")) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("finds no expression joining the two, wrapped across lines or not", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const near of neighbourhoods(readFileSync(path.join(ROOT, file), "utf8"))) {
        if (ADDS.test(near)) offenders.push(`${file}: ${near}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  /**
   * The guard has to be able to fail, and a guard nobody has watched fail is a
   * guard nobody has tested. This drives the same two readers over a source
   * string carrying the hub's own mistake, in each of the three shapes the
   * readers exist for.
   */
  it("catches the hub's own mistake in each shape it could be written", () => {
    const oneLine = `const pooled = c.${TOTAL} + c.${SUBTOTAL};`;
    expect(
      lines(oneLine).some((l) => l.includes(TOTAL) && l.includes(SUBTOTAL) && l.includes("+")),
    ).toBe(true);

    const wrapped = `const pooled =\n  c.${TOTAL} +\n  c.${SUBTOTAL};`;
    expect(neighbourhoods(wrapped).some((n) => ADDS.test(n))).toBe(true);

    const folded = `[c.${TOTAL}, c.${SUBTOTAL}].reduce((a, b) => a + b, 0)`;
    expect(neighbourhoods(folded).some((n) => ADDS.test(n))).toBe(true);

    // And the shapes that are correct stay quiet.
    const apart = `${TOTAL}: num(byId.${TOTAL}),\n${SUBTOTAL}: num(byId.${SUBTOTAL}),`;
    expect(
      lines(apart).some((l) => l.includes(TOTAL) && l.includes(SUBTOTAL) && l.includes("+")),
    ).toBe(false);
    expect(neighbourhoods(apart).some((n) => ADDS.test(n))).toBe(false);
  });
});
