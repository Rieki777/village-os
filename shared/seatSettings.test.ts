/**
 * A SEAT'S SETTINGS, held to their rules.
 *
 * The parser is the one judge the editor, the drawer and (from PR4) the
 * routes share, so its refusals are pinned here sentence by sentence: payment
 * details, unknown groups, the old voice and commitment fields, whole numbers.
 * Then the words: an absent group reads "Not set", never 0, and every money
 * row says it is a record. Then the fingerprint, pinned to bytes computed
 * outside this module.
 *
 * Every refusal has a control that passes, so a parser that refused
 * everything could not pass this file.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MONEY_LINE,
  NOT_SET,
  PAYMENT_DETAIL_MESSAGE,
  SETTINGS_GROUPS,
  looksLikePaymentDetails,
  parseSeatSettings,
  settingsHash,
  settingsWords,
  type SeatSettings,
} from "./seatSettings";
import { seatSheet } from "./roleSheet";
import { fromProposedSeat } from "./roleSheetInputs";
import { normaliseProposedSeat } from "./proposedSeats";

const ok = (raw: unknown) => parseSeatSettings(raw);
const refusedAt = (raw: unknown) => parseSeatSettings(raw).problems.map((p) => p.path);

const FULL: SeatSettings = {
  v: 1,
  term: { endsOn: null, noticeDays: 14, reviewOn: "2026-12-01" },
  clocks: { pay: "calendar-month", work: "moon" },
  rhythm: { gatherings: [{ label: "Weekly sync", weekday: 1, time: "09:30", every: "week" }], quietDays: [0] },
  pay: { kind: "range", currency: "EUR", minMinor: 50000, maxMinor: 90000, per: "month", note: "Reviewed at the season's turn" },
  allowance: { kind: "flat", currency: "EUR", amountMinor: 10000, per: "month" },
  bonus: { kind: "equity", capWords: "Up to a set share", ratedBy: "the funders", cadence: "Rated each month" },
  quests: { perMoonMin: 3, perMoonMax: 5, agreedHow: "by consent", doneWhenRequired: true },
  scoreboard: { measures: [{ measure: "Quests done", target: "all agreed quests", readFrom: "the quest board" }] },
  ending: { noticeDays: 14, payThroughNotice: true },
};

describe("parseSeatSettings accepts", () => {
  it("nothing at all, as terms with every group not set", () => {
    for (const raw of [undefined, null, {}, { v: 1 }]) {
      const r = ok(raw);
      expect(r.ok).toBe(true);
      expect(r.settings).toEqual({ v: 1 });
    }
  });

  it("a full set of terms, unchanged", () => {
    const r = ok(FULL);
    expect(r.problems).toEqual([]);
    expect(r.settings).toEqual(FULL);
  });

  it("keeps an unknown currency code and says so, never blocking it", () => {
    const r = ok({ pay: { kind: "fixed", currency: "QQQ", amountMinor: 100 } });
    expect(r.ok).toBe(true);
    expect(r.flags.map((f) => f.path)).toEqual(["pay.currency"]);
    // Control: a known code raises no flag.
    expect(ok({ pay: { kind: "fixed", currency: "EUR", amountMinor: 100 } }).flags).toEqual([]);
  });
});

describe("parseSeatSettings refuses payment details (economics ruling 23)", () => {
  const inNote = (note: string) => ({ pay: { kind: "fixed", note } });

  it("refuses a run of eight or more digits, spaced or not", () => {
    for (const note of ["Account 12345678", "Card 4111 1111 1111 1111", "Routing 021000021", "ref 1234-5678"]) {
      const r = ok(inNote(note));
      expect(r.ok, note).toBe(false);
      expect(r.problems[0], note).toEqual({ path: "pay.note", message: PAYMENT_DETAIL_MESSAGE });
    }
    // Control: seven digits, a date and a time are words, not account numbers.
    for (const note of ["Paid on 2026-10-09 at 10:30", "Up to 1234567 in the year", "Three moons, then review"]) {
      expect(ok(inNote(note)).ok, note).toBe(true);
    }
  });

  it("refuses an IBAN shape, in any case and with or without spaces", () => {
    for (const note of ["IBAN GB33BUKB20201555555555", "gb33 bukb 2020 1555 5555 55", "CR05 0152 0200 1026 2840 66"]) {
      expect(ok(inNote(note)).ok, note).toBe(false);
    }
    // Control: a short code next to digits is not an IBAN.
    expect(ok(inNote("Room B12 on the north side")).ok).toBe(true);
  });

  it("checks every free text field, not only the note", () => {
    const bad = "IBAN GB33BUKB20201555555555";
    const cases: unknown[] = [
      { bonus: { kind: "equity", capWords: bad } },
      { bonus: { kind: "equity", ratedBy: bad } },
      { quests: { agreedHow: bad } },
      { rhythm: { gatherings: [{ label: "12345678", weekday: 1, time: "10:00" }] } },
      { scoreboard: { measures: [{ measure: "Quests", target: bad }] } },
      { allowance: { kind: "flat", note: bad } },
    ];
    for (const raw of cases) expect(ok(raw).ok, JSON.stringify(raw)).toBe(false);
    expect(looksLikePaymentDetails("nothing here")).toBe(false);
  });
});

describe("parseSeatSettings refuses what is never a term", () => {
  it("refuses an unknown group by name", () => {
    expect(refusedAt({ perks: { kind: "none" } })).toEqual(["perks"]);
    expect(refusedAt({ pay: { kind: "fixed", tip: "x" } })).toEqual(["pay.tip"]);
  });

  it("refuses voice, and says why", () => {
    const r = ok({ voice: 3 });
    expect(r.ok).toBe(false);
    expect(r.problems[0].path).toBe("voice");
    expect(r.problems[0].message).toMatch(/Voice is never a term/);
  });

  it("refuses a commitment percentage and the rest of the old fields, wherever they sit", () => {
    for (const key of ["commitmentPct", "deferredPct", "tokenSlug", "tokenPerCycle", "commitment"]) {
      expect(refusedAt({ [key]: 40 }), key).toEqual([key]);
      expect(refusedAt({ pay: { kind: "fixed", [key]: 40 } }), key).toEqual([`pay.${key}`]);
    }
  });

  it("refuses a scoreboard that ranks people, and keeps one that measures the work", () => {
    expect(ok({ scoreboard: { measures: [{ measure: "Rank of each member" }] } }).ok).toBe(false);
    expect(ok({ scoreboard: { measures: [{ measure: "Quests", target: "Top 3 on the leaderboard" }] } }).ok).toBe(false);
    expect(ok({ scoreboard: { measures: [{ measure: "Beds made ready", target: "every bed by noon" }] } }).ok).toBe(true);
  });

  it("refuses a bonus cap as a number: words only (decision 1)", () => {
    expect(refusedAt({ bonus: { kind: "equity", capPct: 5 } })).toEqual(["bonus.capPct"]);
    expect(refusedAt({ bonus: { kind: "equity", capWords: 5 } })).toEqual(["bonus.capWords"]);
  });
});

describe("whole numbers only", () => {
  it("refuses fractions, numeric strings and negatives in every number field", () => {
    for (const raw of [
      { pay: { kind: "fixed", amountMinor: 10.5 } },
      { pay: { kind: "fixed", amountMinor: "1000" } },
      { pay: { kind: "fixed", amountMinor: -1 } },
      { term: { noticeDays: 1.5 } },
      { quests: { perMoonMin: 2.5 } },
      { ending: { noticeDays: Number.NaN } },
      { rhythm: { gatherings: [{ label: "Sync", weekday: 1.5, time: "10:00" }] } },
    ]) {
      expect(ok(raw).ok, JSON.stringify(raw)).toBe(false);
    }
    // Control: the same fields, whole.
    expect(ok({ pay: { kind: "fixed", amountMinor: 1000 }, term: { noticeDays: 2 }, quests: { perMoonMin: 2 } }).ok).toBe(true);
  });

  it("holds quests a moon to 1 through 12, fewest at or under most", () => {
    expect(ok({ quests: { perMoonMin: 0 } }).ok).toBe(false);
    expect(ok({ quests: { perMoonMax: 13 } }).ok).toBe(false);
    expect(ok({ quests: { perMoonMin: 5, perMoonMax: 3 } }).ok).toBe(false);
    expect(ok({ quests: { perMoonMin: 1, perMoonMax: 12 } }).ok).toBe(true);
  });

  it("keeps the done when on, whatever arrives", () => {
    expect(ok({ quests: { perMoonMin: 2 } }).settings?.quests?.doneWhenRequired).toBe(true);
    expect(ok({ quests: { doneWhenRequired: false } }).ok).toBe(false);
  });

  it("keeps money kinds honest about their amounts", () => {
    expect(ok({ pay: { kind: "none", amountMinor: 100 } }).ok).toBe(false);
    expect(ok({ pay: { kind: "honorary", minMinor: 100 } }).ok).toBe(false);
    expect(ok({ pay: { kind: "range", minMinor: 900, maxMinor: 100 } }).ok).toBe(false);
    expect(ok({ pay: { kind: "fixed", minMinor: 100 } }).ok).toBe(false);
    // Blank amounts are a shape, and a shape is allowed.
    expect(ok({ pay: { kind: "range", per: "month" } }).ok).toBe(true);
  });
});

describe("settingsWords", () => {
  it("reads an absent group as Not set, never as 0", () => {
    const rows = settingsWords({ v: 1 });
    expect(rows.map((r) => r.group)).toEqual([...SETTINGS_GROUPS]);
    for (const r of rows) {
      expect(r.set, r.group).toBe(false);
      expect(r.headline, r.group).toBe(NOT_SET);
      expect(r.headline, r.group).not.toMatch(/\b0\b/);
      expect(r.moneyLine, r.group).toBeNull();
    }
  });

  it("says an amount is not set where none was written, never 0", () => {
    const rows = settingsWords({ v: 1, pay: { kind: "fixed", per: "month" }, allowance: { kind: "flat", per: "month" } });
    const pay = rows.find((r) => r.group === "pay")!;
    const allowance = rows.find((r) => r.group === "allowance")!;
    expect(pay.headline).toBe("A fixed stipend a month, amount not set");
    expect(allowance.headline).toBe("A flat allowance a month, amount not set");
    expect(`${pay.headline}${allowance.headline}`).not.toMatch(/\b0\b/);
  });

  it("puts the money line on every set money row and on nothing else", () => {
    const rows = settingsWords(FULL);
    for (const r of rows) {
      expect(r.moneyLine, r.group).toBe(["pay", "allowance", "bonus"].includes(r.group) ? MONEY_LINE : null);
    }
    expect(MONEY_LINE).toBe("Recorded here. Paid outside the platform.");
  });

  it("writes the full card in plain words", () => {
    const byGroup = Object.fromEntries(settingsWords(FULL).map((r) => [r.group, r]));
    expect(byGroup.term.headline).toBe("Until the season ends");
    expect(byGroup.term.lines).toEqual(["Notice: 14 days", "Review on 1 Dec 2026"]);
    expect(byGroup.clocks.headline).toBe("Paid by the calendar month, works by the moon");
    expect(byGroup.pay.headline).toBe("Between €500 and €900 a month");
    expect(byGroup.allowance.headline).toBe("A flat allowance of €100 a month");
    expect(byGroup.quests.headline).toBe("3 to 5 quests a moon");
    expect(byGroup.quests.pips).toEqual({ filled: 3, outlined: 2 });
    expect(byGroup.scoreboard.lines).toEqual(["Quests done: all agreed quests (read from the quest board)"]);
    expect(byGroup.ending.headline).toBe("14 days notice");
  });

  it("speaks of aligning, and carries no dash anywhere", () => {
    const all = settingsWords(FULL).flatMap((r) => [r.headline, ...r.lines, r.moneyLine ?? ""]);
    for (const s of all) {
      expect(s).not.toMatch(/[–—]/);
      expect(s).not.toMatch(/\bsign(ed|ing)?\b/i);
    }
  });
});

/*
 * R55 (shared/roleSheet.test.ts) keeps pay, tenure, hours, rank and
 * scoreboards off every face of the card. The drawer prints exactly those
 * things, which is only safe because its words come from a SEPARATE model the
 * card never reads. This is that proof, with a control showing the scan would
 * catch the drawer's words if they ever reached the card.
 */
describe("the drawer's words live outside the card's view model", () => {
  const R55 = /holders to date|tenure|average|rank|hours|per week|pay|wage|salary|commitment|%|scoreboard|power level/i;

  it("is a separate module: the card's view model never imports the settings model", () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, "roleSheet.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']\.\/seatSettings["']/);
    expect(src).not.toMatch(/from\s+["']\.\/seatPresets["']/);
    // Control: the matcher sees an import of this shape when one is there.
    expect('import { x } from "./seatSettings";').toMatch(/from\s+["']\.\/seatSettings["']/);
  });

  it("the card's view model stays clean while the drawer's words would fail R55", () => {
    const card = seatSheet(fromProposedSeat(normaliseProposedSeat({ role_name: "Seed Keeper", aim: "Keep seed." }, [])), {
      now: new Date("2026-10-09T12:00:00Z"),
      season: null,
      classNames: null,
    });
    // String values only, keys excluded, exactly as the R55 scan reads a view.
    const strings = (v: unknown, out: string[] = []): string[] => {
      if (typeof v === "string") out.push(v);
      else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
      else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
      return out;
    };
    expect(strings(card).map((s) => s.replace(/Its commitments/g, "")).filter((s) => R55.test(s))).toEqual([]);
    // Control: the drawer's words, scanned the same way, are caught.
    const drawer = settingsWords(FULL).flatMap((r) => [r.label, r.headline, ...r.lines]);
    expect(drawer.some((s) => R55.test(s))).toBe(true);
  });
});

describe("settingsHash", () => {
  // Computed outside this module: node's own crypto over the canonical bytes
  // written out by hand (see shared/canonicalJson.test.ts for the rule).
  const FIXTURE: SeatSettings = {
    v: 1,
    pay: { kind: "fixed", per: "month", currency: "USD", amountMinor: 120000, note: "Recorded in words" },
    term: { endsOn: null, noticeDays: 14 },
    quests: { perMoonMin: 3, perMoonMax: 5, doneWhenRequired: true },
    presets: [{ group: "pay", presetId: "platform:fixed-monthly-stipend", presetVersion: 1 }],
  };
  const FIXTURE_HASH = "9dbe87d5a1de9d9aa6be8e592037bfde314d9555b44c2136f60df2a49b03c9be";

  it("is sha256 over the canonical bytes, pinned to the fixture", async () => {
    expect(await settingsHash(FIXTURE)).toBe(FIXTURE_HASH);
  });

  it("ignores key order and changes with any value", async () => {
    const reordered = JSON.parse(JSON.stringify({ quests: FIXTURE.quests, presets: FIXTURE.presets, term: FIXTURE.term, pay: FIXTURE.pay, v: 1 }));
    expect(await settingsHash(reordered)).toBe(FIXTURE_HASH);
    // Control: one minor unit moves the hash.
    expect(await settingsHash({ ...FIXTURE, pay: { ...FIXTURE.pay!, amountMinor: 120001 } })).not.toBe(FIXTURE_HASH);
  });
});
