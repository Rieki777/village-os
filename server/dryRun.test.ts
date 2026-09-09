/**
 * THE TEST RUN'S OWN ARITHMETIC (R86).
 *
 * The e2e sibling (`server/dryRun.routes.e2e.test.ts`) proves the property that
 * matters most: a run leaves every append-only table exactly as it found it.
 * This file proves the thing the founder actually reads, which is what the run
 * SAYS, and it drives the misconfigurations that are expensive to reach over
 * HTTP: a rule that pays nothing, a token with no faucet, a queued change
 * landing in a named moon, a stage that cannot give.
 *
 * There is no pool here and there is no database, because `server/lib/dryRun.ts`
 * takes neither. That is the isolation argument in its shortest form: a
 * function that is handed no connection cannot write a row.
 *
 * `loadVariables` is never called, so every dial reads its platform default
 * from `shared/gameVariables.ts`. That is deliberate: the assertions below are
 * about a village that has changed nothing, which is the village a founder
 * runs this on first.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { cycleBoundsFor } from "../shared/lunar";
import { loadTokenRegistry } from "./lib/ledger";
import { setVariable } from "./lib/variables";
import { dryRun, MAX_MOONS, type DryRunRule, type DryRunSnapshot } from "./lib/dryRun";

/** A fixed instant so every cycle number in this file is stable. */
const FROM = new Date("2026-08-29T12:00:00.000Z");
const C0 = cycleBoundsFor(FROM).cycleNumber;

const seatRule = (over: Partial<DryRunRule> = {}): DryRunRule => ({
  id: "rule-role.cycle-gratitude",
  trigger: "role.cycle",
  tokenSlug: "gratitude",
  amount: 20,
  ceiling: 100,
  enabled: true,
  effectiveFromCycle: 0,
  pending: null,
  ...over,
});

const snapshot = (over: Partial<DryRunSnapshot> = {}): DryRunSnapshot => ({
  gameStarted: false,
  startedAt: null,
  seatCount: 2,
  rules: [seatRule()],
  jobs: [{ name: "moon-settlement", everyMs: 60 * 60 * 1000 }],
  modulesOff: [] as Array<{ id: string; name: string }>,
  ...over,
});

const sentences = (r: ReturnType<typeof dryRun>): string =>
  JSON.stringify([...r.runFindings, ...r.turns.flatMap((t) => t.findings)]);

beforeAll(async () => {
  /*
   * The token registry is an in-memory map that `loadTokenRegistry` fills at
   * boot from the `tokens` table. Without it every rule here would read as
   * paying an unregistered token, and this file would assert the wrong refusal
   * for the right reason. These three rows are what `0006` and
   * `ensureVoiceToken` between them put in a real village: the recognition
   * token, the voice that ACCRUES here, the Hypha mirror that does not, and
   * the credits `gratitude.pool_token` names by default.
   */
  const rows = [
    { slug: "gratitude", name: "Gratitude", kind: "recognition", governance: "platform", transferable: 0, decimals: 0, active: 1, is_example: 0 },
    { slug: "village-voice", name: "Village Voice", kind: "voice", governance: "platform", transferable: 0, decimals: 3, active: 1, is_example: 0 },
    { slug: "voice", name: "Voice", kind: "voice", governance: "hypha", transferable: 0, decimals: 3, active: 1, is_example: 0 },
    { slug: "credits", name: "Village Credits", kind: "credit", governance: "platform", transferable: 0, decimals: 4, active: 1, is_example: 0 },
  ];
  await loadTokenRegistry({ query: async () => [rows, []] } as any);
});

describe("the test run walks the moons forward", () => {
  it("gives one turn per lunation, in order, with no gaps", () => {
    const r = dryRun(snapshot(), { moons: 6, from: FROM });
    expect(r.turns).toHaveLength(6);
    expect(r.firstCycle).toBe(C0);
    expect(r.lastCycle).toBe(C0 + 5);
    r.turns.forEach((t, i) => {
      expect(t.cycleNumber).toBe(C0 + i);
      expect(t.cycleKey).toBe(`lunar-${String(C0 + i).padStart(6, "0")}`);
      expect(new Date(t.endsAt).getTime()).toBeGreaterThan(new Date(t.startsAt).getTime());
    });
    // Each turn picks up where the last one ended, which is what makes the
    // span a real span and not a set of overlapping months.
    for (let i = 1; i < r.turns.length; i++) {
      expect(r.turns[i].startsAt).toBe(r.turns[i - 1].endsAt);
    }
    // Roughly one synodic month a turn.
    expect(r.spanDays).toBeGreaterThan(6 * 29);
    expect(r.spanDays).toBeLessThan(6 * 30);
  });

  it("clamps a run to the length the page offers", () => {
    expect(dryRun(snapshot(), { moons: 9999, from: FROM }).moons).toBe(MAX_MOONS);
    expect(dryRun(snapshot(), { moons: -3, from: FROM }).moons).toBe(1);
  });

  it("says what it wrote, which is nothing", () => {
    const r = dryRun(snapshot(), { moons: 3, from: FROM });
    expect(r.isolation).toMatch(/wrote nothing/i);
    expect(r.notCovered.length).toBeGreaterThan(0);
    expect(r.covered.length).toBeGreaterThan(0);
  });
});

describe("what a settlement would pay", () => {
  it("thanks every seat holder at the rule's amount", () => {
    const r = dryRun(snapshot({ seatCount: 3 }), { moons: 2, from: FROM });
    const paid = r.turns[0].findings.filter((f) => f.area === "settlement" && f.outcome === "issued");
    expect(paid).toHaveLength(1);
    expect(paid[0].sentence).toContain("3 seat holders");
    expect(paid[0].sentence).toContain("20 Gratitude");
    expect(paid[0].sentence).toContain("60 for the moon");
  });

  it("calls an empty village young, never broken (R55)", () => {
    const r = dryRun(snapshot({ seatCount: 0 }), { moons: 2, from: FROM });
    const f = r.turns[0].findings.find((x) => x.area === "settlement")!;
    expect(f.outcome).toBe("idle");
    expect(f.sentence).toMatch(/has a rule ready when somebody does/i);
    expect(r.refusals.filter((x) => x.area === "settlement")).toHaveLength(0);
  });

  it("names a seat rule whose amount is read from the work, which a seat has none of", () => {
    const r = dryRun(snapshot({ rules: [seatRule({ amount: null })] }), { moons: 2, from: FROM });
    expect(sentences(r)).toMatch(/reads its amount from the work/i);
    expect(r.refusals.length).toBeGreaterThan(0);
  });

  it("names a seat rule set to zero", () => {
    const r = dryRun(snapshot({ rules: [seatRule({ amount: 0 })] }), { moons: 2, from: FROM });
    expect(sentences(r)).toMatch(/is set to 0, so it pays nothing/i);
  });

  it("names a token the ledger has no faucet for", () => {
    const r = dryRun(snapshot({ rules: [seatRule({ tokenSlug: "voice" })] }), { moons: 2, from: FROM });
    expect(sentences(r)).toMatch(/has no faucet/i);
  });

  it("names a village with no seat rule at all", () => {
    const r = dryRun(
      snapshot({ rules: [seatRule({ trigger: "quest.completed" })] }),
      { moons: 2, from: FROM },
    );
    expect(sentences(r)).toMatch(/No rule is set for holding a seat/i);
  });

  it("names a village with no enabled rule at all", () => {
    const r = dryRun(snapshot({ rules: [seatRule({ enabled: false })] }), { moons: 2, from: FROM });
    expect(sentences(r)).toMatch(/No mint rule is switched on/i);
  });

  it("holds a rule back until the moon it becomes effective, and says which emptiness it is", () => {
    const r = dryRun(
      snapshot({ rules: [seatRule({ effectiveFromCycle: C0 + 3 })] }),
      { moons: 5, from: FROM },
    );
    const paidIn = r.turns.map((t) => t.findings.some((f) => f.area === "settlement" && f.outcome === "issued"));
    expect(paidIn).toEqual([false, false, false, true, true]);

    /*
     * THE FALLBACK THAT LIED. The first draft filtered to what is enabled AND
     * in force, then read an empty list as "no mint rule is switched on". A
     * founder whose rules start next moon would have been told their rules
     * were off while they sat in the table waiting.
     */
    const early = r.turns[0].findings.find((f) => f.area === "settlement")!;
    expect(early.outcome).toBe("idle");
    expect(early.sentence).toMatch(/starts from a later moon/i);
    expect(early.sentence).not.toMatch(/switched on/i);
    expect(r.refusals.filter((f) => f.area === "settlement")).toHaveLength(0);
  });
});

describe("queued dial changes", () => {
  it("lands a pending change in its own moon, and pays the new amount from there", () => {
    const rules = [seatRule({ amount: 20, pending: { amount: 45, ceiling: 100, enabled: true, fromCycle: C0 + 2 } })];
    const r = dryRun(snapshot({ rules, seatCount: 1 }), { moons: 4, from: FROM });

    const landing = r.turns[2].findings.find((f) => f.area === "rules")!;
    expect(landing.sentence).toContain("20 becomes 45");
    expect(r.turns[0].findings.some((f) => f.area === "rules")).toBe(false);
    expect(r.turns[3].findings.some((f) => f.area === "rules")).toBe(false);

    // The settlement follows the promotion, moon for moon. This is the shape
    // `runSettlement` uses: promote first, then read the rules, so the moon a
    // change lands in settles under the new number.
    const amountIn = (i: number) =>
      r.turns[i].findings.find((f) => f.area === "settlement" && f.outcome === "issued")!.sentence;
    expect(amountIn(1)).toContain("20 Gratitude");
    expect(amountIn(2)).toContain("45 Gratitude");
  });
});

describe("the allowance a member actually has", () => {
  it("gives a row per stage, with the share cap and how far it spreads", () => {
    const r = dryRun(snapshot(), { moons: 1, from: FROM });
    const guest = r.allowances.find((a) => a.stageId === "guest")!;
    // Platform defaults: base 105, Guest multiplier 1, 7 full sends. 105
    // divides by 7 exactly, which is why the default is 105 and not 100.
    expect(guest.allowance).toBe(105);
    expect(guest.shareCap).toBe(15);
    expect(guest.spreadsAcross).toBe(7);
    expect(guest.heartsSendable).toBe(true);
  });

  it("says plainly when a stage can give nothing", () => {
    const r = dryRun(snapshot(), { moons: 1, from: FROM });
    const visitor = r.allowances.find((a) => a.stageId === "visitor")!;
    expect(visitor.allowance).toBe(0);
    expect(visitor.note).toMatch(/can give nothing/i);
    expect(visitor.heartsSendable).toBe(false);
  });
});

describe("the run-level facts", () => {
  it("puts them in their own section, never on the first moon", () => {
    const r = dryRun(snapshot(), { moons: 3, from: FROM });
    expect(r.runFindings.length).toBeGreaterThan(0);
    const areas = new Set(r.turns.flatMap((t) => t.findings).map((f) => f.area));
    expect(areas.has("pool")).toBe(false);
    expect(areas.has("issuance")).toBe(false);
    // And moon one carries no more than the moons after it.
    expect(r.turns[0].findings.length).toBe(r.turns[1].findings.length);
  });

  it("says nothing was issued, and why", () => {
    const r = dryRun(snapshot(), { moons: 2, from: FROM });
    const f = r.runFindings.find((x) => x.area === "issuance")!;
    expect(f.sentence).toMatch(/has not started its Game/i);
    expect(f.sentence).toMatch(/nothing above was issued/i);
  });

  it("says so differently for a village that has already started", () => {
    const r = dryRun(
      snapshot({ gameStarted: true, startedAt: "2026-05-04T00:00:00.000Z" }),
      { moons: 2, from: FROM },
    );
    const f = r.runFindings.find((x) => x.area === "issuance")!;
    expect(f.sentence).toContain("2026-05-04");
    expect(f.sentence).toMatch(/still wrote nothing/i);
  });

  it("names the modules that are off, and counts them the way a person would", () => {
    const r = dryRun(
      snapshot({ modulesOff: [{ id: "stays", name: "Stays" }, { id: "library", name: "Library" }] }),
      { moons: 1, from: FROM },
    );
    const jobs = r.runFindings.find((f) => f.area === "jobs")!;
    expect(jobs.sentence).toContain("Stays, Library");
    expect(jobs.sentence).toContain("2 modules are off");
    expect(jobs.sentence).not.toContain("module(s)");
    // The feed is on, so nothing says otherwise.
    expect(r.runFindings.some((f) => f.area === "gratitude")).toBe(false);
  });

  it("counts how often each job would ask, and runs none of them", () => {
    const r = dryRun(snapshot(), { moons: 2, from: FROM });
    const job = r.jobs.find((j) => j.name === "moon-settlement")!;
    expect(job.cadence).toBe("every hour");
    // Two lunations is about 1416 hours, said at the precision it deserves.
    expect(job.runsInSpan).toBe("1.4 thousand");
    expect(r.notCovered.join(" ")).toMatch(/none of them was run/i);
  });
});

describe("refusals reach the founder", () => {
  it("gathers every refusal once, from the turns and the run alike", () => {
    const r = dryRun(snapshot({ rules: [seatRule({ amount: null })] }), { moons: 8, from: FROM });
    const seatRefusals = r.refusals.filter((f) => f.area === "settlement");
    // Eight moons of the same broken rule, said once.
    expect(seatRefusals).toHaveLength(1);
    expect(r.refusals.some((f) => f.area === "claims")).toBe(true);
  });

  it("refuses the claim threshold when no rule issues voice", () => {
    const r = dryRun(snapshot(), { moons: 3, from: FROM });
    const f = r.runFindings.find((x) => x.area === "claims" && /claim threshold/.test(x.sentence))!;
    expect(f.outcome).toBe("refused");
    expect(f.sentence).toMatch(/never reaches the claim threshold/i);
  });

  it("does the threshold arithmetic when a voice rule exists", () => {
    const rules = [seatRule(), seatRule({ id: "v", tokenSlug: "village-voice", amount: 50 })];
    const short = dryRun(snapshot({ rules }), { moons: 1, from: FROM });
    const long = dryRun(snapshot({ rules }), { moons: 6, from: FROM });
    // 50 voice a moon against a threshold of 100 is two moons.
    expect(short.runFindings.find((f) => /claim threshold/.test(f.sentence))!.outcome).toBe("refused");
    const reached = long.runFindings.find((f) => /claim threshold/.test(f.sentence))!;
    expect(reached.outcome).toBe("issued");
    expect(reached.sentence).toContain("after 2 moons");
  });
});

/**
 * A dial change with no database behind it.
 *
 * `setVariable` validates against the registry, writes one row, and updates the
 * in-memory cache the readers use. The fake pool swallows the write and the
 * cache update still happens, so a case can set a dial the way a founder would
 * and the run reads it the way production would.
 */
const NO_DB = { query: async () => [[], []] } as any;
const setDial = (key: string, value: string) => setVariable(NO_DB, key, value);

describe("dials that each read as a sane number and disagree with each other", () => {
  it("says when the full sends dial rounds below one Gratitude and the floor takes over", async () => {
    await setDial("gratitude.base_budget", "3");
    await setDial("gratitude.full_sends_per_cycle", "10");
    try {
      const r = dryRun(snapshot(), { moons: 1, from: FROM });
      const guest = r.allowances.find((a) => a.stageId === "guest")!;
      // 3 split 10 ways is 0, and shareCapFor floors at 1.
      expect(guest.allowance).toBe(3);
      expect(guest.shareCap).toBe(1);
      expect(guest.note).toMatch(/full sends dial is doing nothing here/i);
    } finally {
      await setDial("gratitude.base_budget", "105");
      await setDial("gratitude.full_sends_per_cycle", "7");
    }
  });

  it("says when a heart is worth more than the whole per-person share", async () => {
    await setDial("gratitude.base_budget", "8");
    await setDial("feed.heart_amount", "5");
    try {
      const r = dryRun(snapshot(), { moons: 1, from: FROM });
      const guest = r.allowances.find((a) => a.stageId === "guest")!;
      // 8 split 7 ways is 1, and a heart is 5.
      expect(guest.shareCap).toBe(1);
      expect(guest.heartsSendable).toBe(false);
      expect(guest.note).toMatch(/every tap on the feed would be refused/i);
    } finally {
      await setDial("gratitude.base_budget", "105");
      await setDial("feed.heart_amount", "1");
    }
  });

  it("says which of the two heart dials a member actually meets", async () => {
    await setDial("feed.heart_amount", "5");
    await setDial("feed.max_hearts_per_recipient_per_cycle", "20");
    try {
      const r = dryRun(snapshot(), { moons: 1, from: FROM });
      const guest = r.allowances.find((a) => a.stageId === "guest")!;
      // Allowance 105 across 7 full sends, so 15 to one person: three hearts
      // of 5, and the feed dial claims twenty.
      expect(guest.shareCap).toBe(15);
      expect(guest.note).toMatch(/3 hearts to one person, and the feed dial says 20/i);
      expect(guest.note).toMatch(/the ceiling is the one they meet/i);
    } finally {
      await setDial("feed.heart_amount", "1");
      await setDial("feed.max_hearts_per_recipient_per_cycle", "3");
    }
  });
});

describe("the isolation is structural, and stays that way", () => {
  /*
   * THE ARGUMENT IN §4 OF THIS LANE'S BRIEF, held by a test instead of a
   * comment. `dryRun` is handed no pool and no connection, so it cannot write.
   * That is only true while nobody adds one, and the edit that adds one would
   * pass every other gate in this repo. This is the gate that would not.
   *
   * It reads the module's own source. That is a blunt instrument and it is the
   * right one here: the property being defended is about the whole file rather
   * than about any function's behaviour.
   */
  const SOURCE = fs.readFileSync(path.join(__dirname, "lib", "dryRun.ts"), "utf8");

  it("has no write in it", () => {
    expect(SOURCE.length).toBeGreaterThan(1000);
    for (const forbidden of ["INSERT ", "UPDATE ", "DELETE ", "REPLACE INTO", ".query(", "getPool"]) {
      expect(SOURCE.includes(forbidden), `dryRun.ts must not contain "${forbidden}"`).toBe(false);
    }
  });

  it("names no pool type and no database driver", () => {
    for (const forbidden of ["mysql2", "PoolConnection", "RowDataPacket"]) {
      expect(SOURCE.includes(forbidden), `dryRun.ts must not name "${forbidden}"`).toBe(false);
    }
    // `Pool` on its own would match the word inside "cycle pool", so the type
    // is checked as an import instead.
    expect(SOURCE).not.toMatch(/import type \{[^}]*\bPool\b/);
  });
});

describe("a channel nobody can reach", () => {
  it("says the feed is off, and stops describing hearts", () => {
    const off = dryRun(
      snapshot({ modulesOff: [{ id: "feed", name: "The Feed" }] }),
      { moons: 1, from: FROM },
    );
    expect(off.runFindings.find((f) => f.area === "gratitude")!.sentence).toMatch(/feed is off/i);
    const guest = off.allowances.find((a) => a.stageId === "guest")!;
    expect(guest.heartsSendable).toBe(false);
    expect(guest.note).not.toMatch(/heart/i);
    // With the feed on, the same village describes hearts again.
    const on = dryRun(snapshot(), { moons: 1, from: FROM });
    expect(on.allowances.find((a) => a.stageId === "guest")!.heartsSendable).toBe(true);
  });
});


describe("a queued change is four columns, never one", () => {
  it("names a change that switches a rule off, and calls it a refusal", () => {
    const rules = [seatRule({ pending: { amount: 20, ceiling: 100, enabled: false, fromCycle: C0 + 1 } })];
    const r = dryRun(snapshot({ rules }), { moons: 3, from: FROM });
    const f = r.turns[1].findings.find((x) => x.area === "rules")!;
    // The first draft rendered this as "20 becomes 20" and called it issued,
    // while the payments stopped from that moon on.
    expect(f.sentence).toMatch(/it switches off/i);
    expect(f.sentence).not.toMatch(/20 becomes 20/);
    expect(f.outcome).toBe("refused");
    expect(r.refusals.some((x) => x.area === "rules")).toBe(true);
    // And the settlement stops paying from the moon it lands in.
    const paid = r.turns.map((t) => t.findings.some((x) => x.area === "settlement" && x.outcome === "issued"));
    expect(paid).toEqual([true, false, false]);
  });

  it("names a ceiling change on its own", () => {
    const rules = [seatRule({ pending: { amount: 20, ceiling: 250, enabled: true, fromCycle: C0 + 1 } })];
    const r = dryRun(snapshot({ rules }), { moons: 2, from: FROM });
    expect(r.turns[1].findings.find((f) => f.area === "rules")!.sentence)
      .toMatch(/its ceiling goes from 100 to 250/i);
  });

  it("announces a change that was already due before the run began", () => {
    // Queued for a moon that has passed with no settlement to promote it. The
    // first draft matched on equality alone, so this went unmentioned while
    // the settlement quietly paid the new number from turn one.
    const rules = [seatRule({ pending: { amount: 45, ceiling: 100, enabled: true, fromCycle: C0 - 4 } })];
    const r = dryRun(snapshot({ rules, seatCount: 1 }), { moons: 3, from: FROM });
    const f = r.turns[0].findings.find((x) => x.area === "rules")!;
    expect(f.sentence).toMatch(/already due/i);
    expect(f.sentence).toContain("20 becomes 45");
    expect(r.turns[0].findings.find((x) => x.area === "settlement" && x.outcome === "issued")!.sentence)
      .toContain("45 Gratitude");
    // Said once, on the first moon, and never again.
    expect(r.turns.filter((t) => t.findings.some((x) => x.area === "rules"))).toHaveLength(1);
  });
});

describe("numbers said the way a person would say them", () => {
  it("names a five minute job in minutes, never in tenths of an hour", () => {
    const r = dryRun(
      snapshot({
        jobs: [
          { name: "agent-inbox-drain", everyMs: 5 * 60 * 1000 },
          { name: "seat-fee-settle", everyMs: 6 * 60 * 60 * 1000 },
          { name: "retention-sweep", everyMs: 24 * 60 * 60 * 1000 },
        ],
      }),
      { moons: 12, from: FROM },
    );
    const by = (n: string) => r.jobs.find((j) => j.name === n)!;
    expect(by("agent-inbox-drain").cadence).toBe("every 5 minutes");
    expect(by("seat-fee-settle").cadence).toBe("every 6 hours");
    expect(by("retention-sweep").cadence).toBe("once a day");
    // A lunar year of five minute ticks is about 102,000, and the last four
    // digits of that are noise dressed as measurement.
    expect(by("agent-inbox-drain").runsInSpan).toMatch(/thousand$/);
    expect(by("retention-sweep").runsInSpan).toBe("354");
  });
});

describe("a window that never arrives", () => {
  it("names a Claims Week nobody will ever reach", async () => {
    // A full ISO date is the single most likely thing to paste into a field
    // labelled with dates, and `claimsWindow` refuses it and shuts the window
    // rather than reading a typo as permission. Every turn then says something
    // reassuring about voice gathering, forever.
    await setDial("economy.claims_week_starts", "2026-06-21");
    try {
      const r = dryRun(snapshot(), { moons: 12, from: FROM });
      const f = r.runFindings.find((x) => x.area === "claims" && /No Claims Week opens/.test(x.sentence))!;
      expect(f.outcome).toBe("refused");
      expect(f.sentence).toContain("2026-06-21");
      expect(f.sentence).toMatch(/a month and a day like 06-21/i);
    } finally {
      await setDial("economy.claims_week_starts", "03-21,06-21,09-23,12-21");
    }
  });

  it("says nothing about it when the windows do open", () => {
    const r = dryRun(snapshot(), { moons: 12, from: FROM });
    expect(r.runFindings.some((f) => /No Claims Week opens/.test(f.sentence))).toBe(false);
  });

  it("survives a moon count that is not a number", () => {
    const r = dryRun(snapshot(), { moons: Number.NaN, from: FROM });
    expect(r.moons).toBe(1);
    expect(r.turns).toHaveLength(1);
  });
});
