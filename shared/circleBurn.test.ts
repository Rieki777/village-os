/**
 * THE RATE, THE CAP THAT BINDS, AND THE SENTENCES THAT MUST NEVER MATCH.
 *
 * Everything here is pure, so it needs no database and no clock. What needs
 * both is in server/lib/circleBurn.test.ts, which drives real postings through
 * `postTransfer` and reads every figure back out of `token_ledger`.
 *
 * The four sentences are asserted APART and asserted DIFFERENT, because the
 * defect this guards against is not a wrong sentence. It is four facts sharing
 * one, which a test that only checks each string in isolation would pass.
 */
import { describe, expect, it } from "vitest";
import {
  bindingCap,
  burnSentence,
  isUngoverned,
  readCap,
  type BurnWords,
  type CapReading,
  type CircleBurnReading,
  type MeteredReading,
  type UngovernedReading,
  type WindowRef,
} from "./circleBurn";

const DAY = 86_400_000;
const START = Date.UTC(2026, 8, 1);

const WINDOW: WindowRef = {
  id: "lunar-000332",
  startsAt: new Date(START).toISOString(),
  endsAt: new Date(START + 30 * DAY).toISOString(),
};

const SEASON: WindowRef = {
  id: "rooting-2026",
  startsAt: new Date(START - 30 * DAY).toISOString(),
  endsAt: new Date(START + 60 * DAY).toISOString(),
};

const WORDS: BurnWords = {
  circleName: (id) => (id === "kitchen" ? "The Kitchen Circle" : id),
  amount: (minor) => `${minor / 100} credits`,
};

function cap(over: Partial<Parameters<typeof readCap>[0]> = {}): CapReading {
  return readCap({
    scope: "cycle",
    window: WINDOW,
    capMinor: 100_000,
    spentMinor: 0,
    atMs: START + 10 * DAY,
    askMinor: 0,
    ...over,
  });
}

function metered(over: Partial<MeteredReading> = {}): MeteredReading {
  return {
    kind: "metered",
    circleId: "kitchen",
    unit: "token:credits",
    takenAt: new Date(START + 10 * DAY).toISOString(),
    askMinor: 0,
    cycle: cap(),
    season: readCap({
      scope: "season", window: SEASON, capMinor: 400_000,
      spentMinor: 0, atMs: START + 10 * DAY, askMinor: 0,
    }),
    binds: "cycle",
    fits: true,
    ...over,
  };
}

// ── The rate, and what it says when there is nothing to say ─────────────────

describe("the burn rate", () => {
  it("is taken over the window's own elapsed time, so it shares the cap's denominator", () => {
    // 20000 minor over ten elapsed days of a thirty-day window.
    const c = cap({ spentMinor: 20_000, atMs: START + 10 * DAY });
    expect(c.state).toBe("burning");
    expect(c.perDayMinor).toBeCloseTo(2000, 6);
    // The projection carries that rate to the window's end, not to some
    // trailing seven days: 2000 a day across thirty days.
    expect(c.projectedMinor).toBe(60_000);
  });

  it("names the day the room runs out, when that day falls inside the window", () => {
    const c = cap({ spentMinor: 20_000, atMs: START + 10 * DAY });
    // 100000 at 2000 a day is fifty days from the window's start, which is
    // past the thirty-day window, so there is no exhaustion date to give.
    expect(c.exhaustsAt).toBeNull();

    const faster = cap({ spentMinor: 60_000, atMs: START + 10 * DAY });
    expect(faster.perDayMinor).toBeCloseTo(6000, 6);
    // 100000 at 6000 a day is day 16.67, inside the window.
    expect(faster.exhaustsAt).not.toBeNull();
    const hit = Date.parse(faster.exhaustsAt as string) - START;
    expect(hit / DAY).toBeCloseTo(100_000 / 6000, 4);
  });

  it("NO SPEND IS NOT ZERO BURN. It is no information, and the two are different facts", () => {
    const c = cap({ spentMinor: 0, atMs: START + 10 * DAY });
    expect(c.state).toBe("unspent");
    // The defect this guards: a surface rendering 0.0 a day would be claiming
    // this circle is not spending, which nobody measured.
    expect(c.perDayMinor).toBeNull();
    expect(c.projectedMinor).toBeNull();
    expect(c.exhaustsAt).toBeNull();
    // The room, though, is exact and known.
    expect(c.remainingMinor).toBe(100_000);
  });

  it("has no rate at the very instant a window opens, even with spend in it", () => {
    // The denominator is zero here, and this is the instant a next_moon
    // landing is most likely to be asked about.
    const c = cap({ spentMinor: 5_000, atMs: START });
    expect(c.perDayMinor).toBeNull();
    expect(c.spentMinor).toBe(5_000);
  });
});

// ── The states, each one its own fact ───────────────────────────────────────

describe("a cap's five states", () => {
  it("reports no_window without inventing a zero", () => {
    const c = readCap({ scope: "season", window: null, capMinor: 400_000, spentMinor: 0, atMs: START, askMinor: 0 });
    expect(c.state).toBe("no_window");
    expect(c.capMinor).toBeNull();
    expect(c.remainingMinor).toBeNull();
    expect(c.askFits).toBeNull();
  });

  it("reports no_cap when the village set none, and constrains nothing", () => {
    const c = cap({ capMinor: null });
    expect(c.state).toBe("no_cap");
    expect(c.askFits).toBeNull();
  });

  it("reports unmeasurable for a unit whose spend lives somewhere else", () => {
    const c = cap({ capMinor: 100_000, measurable: false });
    expect(c.state).toBe("unmeasurable");
    expect(c.capMinor).toBe(100_000);
    // The ceiling is real and the spend is unknown, so neither is faked.
    expect(c.spentMinor).toBeNull();
    expect(c.perDayMinor).toBeNull();
  });

  it("A CAP OF ZERO IS EXHAUSTED AT ONCE, because caps fail closed here", () => {
    const c = cap({ capMinor: 0, spentMinor: 0 });
    expect(c.state).toBe("exhausted");
    expect(c.remainingMinor).toBe(0);
    expect(c.askFits).toBe(true); // an ask of nothing still fits nothing
    expect(cap({ capMinor: 0, spentMinor: 0, askMinor: 1 }).askFits).toBe(false);
  });

  it("is exhausted once spend reaches the cap, and remaining never goes negative", () => {
    const c = cap({ spentMinor: 140_000 });
    expect(c.state).toBe("exhausted");
    expect(c.remainingMinor).toBe(0);
  });
});

// ── Which cap binds ─────────────────────────────────────────────────────────

describe("the cap that binds first", () => {
  const at = START + 10 * DAY;
  const cycleAt = (spent: number, ask: number, capMinor = 100_000) =>
    readCap({ scope: "cycle", window: WINDOW, capMinor, spentMinor: spent, atMs: at, askMinor: ask });
  const seasonAt = (spent: number, ask: number, capMinor = 400_000) =>
    readCap({ scope: "season", window: SEASON, capMinor, spentMinor: spent, atMs: at, askMinor: ask });

  it("picks the one with the least proportional room left once the ask is counted", () => {
    // 30% of the cycle, 95% of the season. The season is what stops this circle.
    expect(bindingCap(cycleAt(20_000, 10_000), seasonAt(370_000, 10_000))).toBe("season");
    // And the other way, on the same envelopes with a different history.
    expect(bindingCap(cycleAt(95_000, 10_000), seasonAt(100_000, 10_000))).toBe("cycle");
  });

  it("names the single cap when only one exists", () => {
    const none = readCap({ scope: "season", window: SEASON, capMinor: null, spentMinor: 0, atMs: at, askMinor: 0 });
    expect(bindingCap(cycleAt(0, 0), none)).toBe("cycle");
  });

  it("names nothing when neither cap exists", () => {
    const a = readCap({ scope: "cycle", window: WINDOW, capMinor: null, spentMinor: 0, atMs: at, askMinor: 0 });
    const b = readCap({ scope: "season", window: null, capMinor: 400_000, spentMinor: 0, atMs: at, askMinor: 0 });
    expect(bindingCap(a, b)).toBeNull();
  });

  it("never lets a cap it cannot measure win the comparison on an invented figure", () => {
    const unmeasured = readCap({
      scope: "season", window: SEASON, capMinor: 400_000,
      spentMinor: 0, atMs: at, askMinor: 0, measurable: false,
    });
    expect(bindingCap(cycleAt(20_000, 0), unmeasured)).toBe("cycle");
  });
});

// ── The four sentences ──────────────────────────────────────────────────────

describe("four facts, four sentences, and no two the same", () => {
  const off: CircleBurnReading = { kind: "module_off" };
  const ungoverned: CircleBurnReading = {
    kind: "ungoverned", circleId: "kitchen", unit: "token:credits",
    takenAt: new Date(START).toISOString(),
  };
  const unspent = metered();
  const spentOut = metered({
    cycle: cap({ spentMinor: 100_000 }),
    binds: "cycle",
  });

  it("says the module is off without saying anything about a circle", () => {
    const s = burnSentence(off, WORDS);
    expect(s).toContain("not keeping circle budgets");
    expect(s).not.toContain("The Kitchen Circle");
  });

  it("SAYS UNGOVERNED, which is the opposite of the zero it would otherwise render", () => {
    const s = burnSentence(ungoverned, WORDS);
    expect(s).toContain("ungoverned");
    expect(s).toContain("Nothing caps what this circle may issue");
    // The trap this exists for: reading as reassuring when it is the reverse.
    expect(s).not.toContain("has issued nothing");
  });

  it("says a real envelope has had nothing spent against it, and no rate yet", () => {
    const s = burnSentence(unspent, WORDS);
    expect(s).toContain("has issued nothing this cycle");
    expect(s).toContain("no burn rate yet");
    expect(s).not.toContain("ungoverned");
  });

  it("says the room is used up and when it comes back", () => {
    const s = burnSentence(spentOut, WORDS);
    expect(s).toContain("has used all");
    expect(s).toContain("can issue nothing more until");
  });

  it("THE PROPERTY: no two of the four share a sentence", () => {
    const all = [off, ungoverned, unspent, spentOut].map((r) => burnSentence(r, WORDS));
    expect(new Set(all).size).toBe(4);
  });

  it("COMPILE TIME: the ballot card cannot reach a metered field off an ungoverned reading", () => {
    /*
     * The strongest form of the promise, and the one a runtime assertion
     * cannot make. `tsconfig.tests.json` typechecks this file in CI, so if
     * `CircleBurnReading` ever grows a shared `cycle` field, or the ungoverned
     * case is folded back into the metered one, these two lines stop being
     * errors and `@ts-expect-error` turns the gate red.
     */
    /*
     * ON THE UNGOVERNED TYPE ITSELF, and this is the version that bites.
     * Written against the whole union it proved nothing: `module_off` carries
     * no `cycle` either, so the directive stayed satisfied even with `cycle`
     * folded onto `UngovernedReading`. A mutation run caught that.
     */
    const noFigures = (r: UngovernedReading): string => {
      // @ts-expect-error an ungoverned reading has no cycle figure to render
      void r.cycle;
      // @ts-expect-error and no season figure either
      void r.season;
      return r.circleId;
    };
    expect(noFigures(ungoverned as UngovernedReading)).toBe("kitchen");

    /* And every kind has to be answered by name, so a new one cannot inherit
     * whichever branch happens to be last. */
    const branch = (r: CircleBurnReading): string => {
      switch (r.kind) {
        case "module_off":
          return "module_off";
        case "ungoverned":
          return "ungoverned";
        case "metered":
          return r.cycle.state;
        default: {
          const impossible: never = r;
          return impossible;
        }
      }
    };
    expect(branch(ungoverned)).toBe("ungoverned");
    expect(branch(unspent)).toBe("unspent");
  });

  it("keeps the ungoverned case apart BY TYPE, so a caller cannot render it as an absence", () => {
    expect(isUngoverned(ungoverned)).toBe(true);
    expect(isUngoverned(off)).toBe(false);
    expect(isUngoverned(unspent)).toBe(false);
    // The kinds themselves are what a renderer branches on.
    expect(new Set([off.kind, ungoverned.kind, unspent.kind]).size).toBe(3);
  });
});

describe("the sentence for an ask names the cap that binds", () => {
  const at = START + 10 * DAY;

  it("gives one cap and says it runs out before the other", () => {
    const reading = metered({
      askMinor: 10_000,
      cycle: readCap({ scope: "cycle", window: WINDOW, capMinor: 100_000, spentMinor: 20_000, atMs: at, askMinor: 10_000 }),
      season: readCap({ scope: "season", window: SEASON, capMinor: 400_000, spentMinor: 370_000, atMs: at, askMinor: 10_000 }),
      binds: "season",
      fits: false,
    });
    const s = burnSentence(reading, WORDS);
    expect(s).toContain("95% of the season's room");
    expect(s).toContain("runs out before the cycle's");
    // Two percentages side by side is exactly what this replaces.
    expect(s).not.toContain("30%");
  });
});
