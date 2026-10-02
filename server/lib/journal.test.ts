/**
 * The journal's pure rules: what a save may carry, which week an instant is
 * in, when a feedback batch lands, what the floor withholds, and what a
 * signal says. No database: each of these is a decision about inputs.
 *
 * THE CLOCK CASES PIN INSTANTS, NOT DESCRIPTIONS. A batch that lands "on a
 * Monday morning" is easy to assert and easy to get wrong across a daylight
 * change, so each case names the UTC instant it expects, and one property
 * sweep walks every hour of six weeks in four zones and asserts the promise
 * itself: a Monday, at nine on the village's own clock, after the hold, and
 * within a week of it.
 */
import { describe, expect, it } from "vitest";
import {
  aggregatePulse,
  aggregateSinceWeekId,
  cleanEntryInput,
  cleanEntryPatch,
  cleanFeedbackDraft,
  cleanPrefs,
  entryMarkdown,
  feedbackDeliverAfter,
  entryCursor,
  feedbackMessageProblem,
  isoWeekId,
  parseEntryCursor,
  isoWeekStart,
  pulseFloor,
  pulseSignals,
  type PulseTally,
} from "./journal";
import { civilParts } from "../../shared/lunar";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";
import { MODULES_BY_ID } from "../../shared/modules";
import {
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_MIN_HOLD_HOURS,
  JOURNAL_ANSWER_MAX,
  JOURNAL_ANSWERS_MAX,
  PULSE_FLOOR_DEFAULT,
  PULSE_METRICS,
  type JournalEntry,
} from "../../shared/journal";

const NOW = new Date("2026-10-02T12:00:00Z");
const at = (iso: string) => new Date(iso);

describe("the week an instant belongs to, on the village's clock", () => {
  it("spells the ISO week, zero padded", () => {
    expect(isoWeekId(at("2026-10-02T12:00:00Z"), "UTC")).toBe("2026-W40");
    expect(isoWeekId(at("2026-01-05T00:00:00Z"), "UTC")).toBe("2026-W02");
  });

  it("gives 1 January to the previous year's week when its Thursday says so", () => {
    expect(isoWeekId(at("2021-01-01T12:00:00Z"), "UTC")).toBe("2020-W53");
    expect(isoWeekId(at("2024-12-30T12:00:00Z"), "UTC")).toBe("2025-W01");
  });

  it("reads the village's date, so a late Sunday is still Sunday's week", () => {
    // 23:30 on Sunday 4 October in Los Angeles is Monday morning in UTC.
    const lateSunday = at("2026-10-05T06:30:00Z");
    expect(isoWeekId(lateSunday, "America/Los_Angeles")).toBe("2026-W40");
    expect(isoWeekId(lateSunday, "UTC")).toBe("2026-W41");
  });

  it("starts the week at Monday midnight, village time", () => {
    expect(isoWeekStart(at("2026-10-02T12:00:00Z"), "UTC").toISOString()).toBe("2026-09-28T00:00:00.000Z");
    // Monday 28 September, 00:00 in Costa Rica (UTC-6, no daylight change).
    expect(isoWeekStart(at("2026-10-02T12:00:00Z"), "America/Costa_Rica").toISOString()).toBe(
      "2026-09-28T06:00:00.000Z",
    );
  });

  it("week ids sort in time order across a year end, which the aggregate's filter relies on", () => {
    expect("2025-W52" < "2026-W01").toBe(true);
    // Eight weeks including this one: 2026-W02, W01, then 2025-W52 down to W47.
    expect(aggregateSinceWeekId(at("2026-01-07T12:00:00Z"), "UTC", 8)).toBe("2025-W47");
  });
});

describe("when a queued message becomes visible", () => {
  it("is the next Monday at nine when that is two days away or more", () => {
    // Wednesday noon plus 48 hours is Friday noon; the next Monday is the 5th.
    expect(feedbackDeliverAfter(at("2026-09-30T12:00:00Z"), "UTC").toISOString()).toBe("2026-10-05T09:00:00.000Z");
  });

  it("waits a further week when Monday nine falls inside the hold", () => {
    // Saturday 10:00 plus 48 hours is Monday 10:00, past nine, so the 12th.
    expect(feedbackDeliverAfter(at("2026-10-03T10:00:00Z"), "UTC").toISOString()).toBe("2026-10-12T09:00:00.000Z");
    // Saturday 08:00 plus 48 hours is Monday 08:00, before nine, so the 5th.
    expect(feedbackDeliverAfter(at("2026-10-03T08:00:00Z"), "UTC").toISOString()).toBe("2026-10-05T09:00:00.000Z");
  });

  it("is nine on the village's clock, whatever its offset", () => {
    // Costa Rica is UTC-6, so nine there is 15:00 UTC.
    expect(feedbackDeliverAfter(at("2026-10-02T12:00:00Z"), "America/Costa_Rica").toISOString()).toBe(
      "2026-10-05T15:00:00.000Z",
    );
    // Auckland is UTC+13 in October, so Monday nine there is Sunday 20:00 UTC.
    expect(feedbackDeliverAfter(at("2026-10-01T00:00:00Z"), "Pacific/Auckland").toISOString()).toBe(
      "2026-10-04T20:00:00.000Z",
    );
  });

  it("moves its UTC instant by the hour the clocks moved, across a daylight change", () => {
    // Berlin goes from CET (UTC+1) to CEST (UTC+2) on Sunday 29 March 2026.
    const winter = feedbackDeliverAfter(at("2026-03-20T10:00:00Z"), "Europe/Berlin");
    const summer = feedbackDeliverAfter(at("2026-03-27T10:00:00Z"), "Europe/Berlin");
    expect(winter.toISOString()).toBe("2026-03-23T08:00:00.000Z");
    expect(summer.toISOString()).toBe("2026-03-30T07:00:00.000Z");
    // Los Angeles leaves daylight time on Sunday 1 November 2026.
    expect(feedbackDeliverAfter(at("2026-10-30T20:00:00Z"), "America/Los_Angeles").toISOString()).toBe(
      "2026-11-02T17:00:00.000Z",
    );
  });

  it("keeps its promise for every hour of six weeks in four zones", () => {
    const zones = ["UTC", "Europe/Berlin", "America/Los_Angeles", "Pacific/Auckland"];
    const hold = FEEDBACK_MIN_HOLD_HOURS * 60 * 60 * 1000;
    const start = at("2026-03-01T00:00:00Z").getTime();
    let checked = 0;
    for (const tz of zones) {
      for (let h = 0; h < 24 * 7 * 6; h += 1) {
        const queued = new Date(start + h * 60 * 60 * 1000);
        const out = feedbackDeliverAfter(queued, tz);
        const c = civilParts(out, tz);
        expect(c.weekday, `${tz} ${queued.toISOString()}`).toBe(1);
        expect(c.hour).toBe(9);
        expect(c.minute).toBe(0);
        expect(out.getTime()).toBeGreaterThanOrEqual(queued.getTime() + hold);
        expect(out.getTime()).toBeLessThan(queued.getTime() + hold + 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000);
        checked += 1;
      }
    }
    expect(checked).toBe(4 * 24 * 7 * 6);
  });
});

describe("the floor", () => {
  it("defaults to the contract's 1, and the registry and the contract agree", () => {
    expect(PULSE_FLOOR_DEFAULT).toBe(1);
    expect(VARIABLES_BY_KEY["journal.pulse_floor"].default).toBe(String(PULSE_FLOOR_DEFAULT));
    expect(pulseFloor()).toBe(PULSE_FLOOR_DEFAULT);
    expect(MODULES_BY_ID.journal.variableKeys).toContain("journal.pulse_floor");
  });

  const week = (weekId: string, cells: Array<[string, number, number]>): PulseTally[] =>
    cells.map(([metric, n, mean]) => ({ weekId, metric, n, mean }));

  it("withholds both numbers below a raised floor and shows them at it", () => {
    const tallies = [...week("2026-W40", [["load", 3, 4.333]]), ...week("2026-W41", [["load", 4, 4.25]])];
    const [w41, w40] = aggregatePulse(tallies, 4);
    expect(w41.weekId).toBe("2026-W41");
    expect(w41.cells.find((c) => c.metric === "load")).toEqual({ metric: "load", n: 4, mean: 4.3, suppressed: false });
    expect(w40.cells.find((c) => c.metric === "load")).toEqual({ metric: "load", n: null, mean: null, suppressed: true });
  });

  it("shows a single member's week at the default floor", () => {
    const [w] = aggregatePulse(week("2026-W40", [["confidence", 1, 3]]), PULSE_FLOOR_DEFAULT);
    expect(w.cells.find((c) => c.metric === "confidence")).toEqual({
      metric: "confidence",
      n: 1,
      mean: 3,
      suppressed: false,
    });
  });

  it("keeps a cell for every metric, suppressed where nobody answered", () => {
    const [w] = aggregatePulse(week("2026-W40", [["energy", 5, -1]]), 1);
    expect(w.cells.map((c) => c.metric)).toEqual(PULSE_METRICS.map((m) => m.key));
    expect(w.cells.filter((c) => c.suppressed).map((c) => c.metric)).toEqual(
      PULSE_METRICS.map((m) => m.key).filter((k) => k !== "energy"),
    );
  });
});

describe("the signals", () => {
  const cellsFor = (means: Record<string, number | null>) =>
    aggregatePulse(
      Object.entries(means)
        .filter(([, v]) => v !== null)
        .map(([metric, mean]) => ({ weekId: "2026-W40", metric, n: 5, mean: mean as number })),
      4,
    );

  it("names burnout only when energy runs out AND the load is heavy", () => {
    expect(pulseSignals(cellsFor({ energy: -1, load: 4 }), "Riverbend").map((s) => s.key)).toEqual(["burnout"]);
    expect(pulseSignals(cellsFor({ energy: -1, load: 3.9 }), "Riverbend")).toEqual([]);
    expect(pulseSignals(cellsFor({ energy: 0, load: 5 }), "Riverbend")).toEqual([]);
  });

  it("names a low confidence, coherence or space at 2.5 and under, and fills the village's name", () => {
    const out = pulseSignals(cellsFor({ confidence: 2.5, coherence: 2.4, space: 2.6 }), "Riverbend");
    expect(out.map((s) => s.key)).toEqual(["confidence", "coherence"]);
    expect(out[0].text).toContain("Riverbend");
    expect(out[0].text).not.toContain("{village}");
  });

  it("reads nothing from a suppressed cell", () => {
    const weeks = aggregatePulse([{ weekId: "2026-W40", metric: "confidence", n: 2, mean: 1 }], 4);
    expect(pulseSignals(weeks, "Riverbend")).toEqual([]);
  });

  it("reads the latest week with anything above the floor", () => {
    const weeks = aggregatePulse(
      [
        { weekId: "2026-W41", metric: "confidence", n: 1, mean: 1 },
        { weekId: "2026-W40", metric: "confidence", n: 6, mean: 4 },
      ],
      4,
    );
    expect(pulseSignals(weeks, "Riverbend")).toEqual([]);
  });

  it("speaks gently and never names anybody", () => {
    const out = pulseSignals(cellsFor({ energy: -2, load: 5, confidence: 1, coherence: 1, space: 1 }), "Riverbend");
    expect(out).toHaveLength(4);
    for (const s of out) {
      expect(s.text).not.toMatch(/[–—]/);
      expect(s.text.length).toBeLessThan(220);
    }
  });
});

describe("what a save may carry", () => {
  const base = {
    clientId: "c-1",
    practice: "evening",
    depth: "light",
    writtenAt: "2026-10-02T21:00:00Z",
    answers: [{ questionKey: "went-well", prompt: "What went well today?", text: "the bread rose" }],
  };

  it("accepts an ordinary evening entry and defaults privacy to private", () => {
    const r = cleanEntryInput(base, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.privacy).toBe("private");
      expect(r.value.answers[0].text).toBe("the bread rose");
    }
  });

  it.each([
    [{ clientId: "" }, "no id"],
    [{ clientId: "x".repeat(65) }, "at most 64"],
    [{ practice: "midday" }, "morning, evening"],
    [{ depth: "abyss" }, "light or deep"],
    [{ scores: { load: 3 } }, "Only the weekly pulse"],
    [{ answers: [{ questionKey: "x", text: "   " }] }, "Write something"],
    [{ writtenAt: "not a date" }, "could not be read"],
    [{ writtenAt: "2026-10-04T12:00:01Z" }, "more than a day ahead"],
    [{ localHour: 24 }, "0 to 23"],
    [{ privacy: "public" }, "private, internal or clear"],
    [{ answers: Array.from({ length: JOURNAL_ANSWERS_MAX + 1 }, (_, i) => ({ questionKey: `q${i}`, text: "a" })) }, "at most"],
  ])("refuses %j with a sentence", (patch, words) => {
    const r = cleanEntryInput({ ...base, ...patch }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain(words);
  });

  it("checks every pulse number against the contract's own range", () => {
    const pulse = { ...base, practice: "pulse", answers: [] };
    expect(cleanEntryInput({ ...pulse, scores: { energy: -2, load: 5 } }, NOW).ok).toBe(true);
    const out = cleanEntryInput({ ...pulse, scores: { energy: -3 } }, NOW);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.problem).toContain("-2 to 2");
    const unknown = cleanEntryInput({ ...pulse, scores: { mood: 3 } }, NOW);
    expect(unknown.ok).toBe(false);
  });

  it("clips a long answer to the contract's width and keeps the start of it", () => {
    const long = "a".repeat(JOURNAL_ANSWER_MAX + 50);
    const r = cleanEntryInput({ ...base, answers: [{ questionKey: "free", text: long }] }, NOW);
    expect(r.ok && r.value.answers[0].text.length).toBe(JOURNAL_ANSWER_MAX);
  });

  it("keeps a debrief's call, seats, quests and portability, and drops the rest", () => {
    const r = cleanEntryInput(
      { ...base, practice: "debrief", meta: { call: " weekly ", seats: ["water", ""], portable: true, junk: 1 } },
      NOW,
    );
    expect(r.ok && r.value.meta).toEqual({ call: "weekly", seats: ["water"], portable: true });
  });

  it("asks an edit to say what it changes, and a string reflection is a confirmation", () => {
    expect(cleanEntryPatch({}).ok).toBe(false);
    const r = cleanEntryPatch({ reflection: "  I protected my morning.  " });
    expect(r.ok && r.value.reflection).toBe("I protected my morning.");
    const back = cleanEntryPatch({ reflection: null });
    expect(back.ok && back.value.reflection).toBeNull();
  });
});

describe("the page marker", () => {
  it("is the last entry's instant and id, and reads back to both", () => {
    const marker = entryCursor({ writtenAt: "2026-10-02T21:00:00.000Z", id: "je-b" });
    expect(marker).toBe("2026-10-02T21:00:00.000Z|je-b");
    const r = parseEntryCursor(marker);
    expect(r.ok && r.value).toEqual({ at: new Date("2026-10-02T21:00:00.000Z"), id: "je-b" });
  });

  it("still takes a bare instant, and nothing at all", () => {
    const bare = parseEntryCursor("2026-10-02T21:00:00Z");
    expect(bare.ok && bare.value).toEqual({ at: new Date("2026-10-02T21:00:00Z"), id: null });
    expect(parseEntryCursor(undefined)).toEqual({ ok: true, value: null });
    expect(parseEntryCursor("yesterday|je-1").ok).toBe(false);
  });
});

describe("what feedback may carry", () => {
  const draft = { recipientId: "m-2", observation: "o", feeling: "f", need: "n", request: "r" };

  it("asks for all four parts and a recipient", () => {
    expect(cleanFeedbackDraft(draft).ok).toBe(true);
    for (const key of ["recipientId", "observation", "feeling", "need", "request"]) {
      expect(cleanFeedbackDraft({ ...draft, [key]: "  " }).ok, key).toBe(false);
    }
  });

  it("refuses an approved message past the width, and never clips it", () => {
    expect(feedbackMessageProblem("Thank you for the care in the kitchen.")).toBeNull();
    expect(feedbackMessageProblem("")).toContain("Approve");
    expect(feedbackMessageProblem("a".repeat(FEEDBACK_MESSAGE_MAX + 1))).toContain("Shorten");
  });

  it("asks a member to say yes or no, and knows only the three styles", () => {
    expect(cleanPrefs({ open: "yes" }).ok).toBe(false);
    expect(cleanPrefs({ open: true, style: "brutal" }).ok).toBe(false);
    const r = cleanPrefs({ open: true, style: "with-examples", note: "x".repeat(900) });
    expect(r.ok && r.value.note.length).toBe(500);
  });
});

describe("the markdown export", () => {
  const entry: JournalEntry = {
    id: "je-1",
    clientId: "c-1",
    practice: "debrief",
    depth: "light",
    answers: [
      { questionKey: "decided", prompt: "What got decided?", text: "We open the kitchen on Sundays." },
      { questionKey: "why", prompt: "Why that, and what else was on the table?", text: "" },
      { questionKey: "new-player", prompt: "What would {village} tell a new player?", text: "Ask the kitchen seat." },
    ],
    scores: null,
    writtenAt: "2026-10-02T23:30:00.000Z",
    localHour: 17,
    privacy: "internal",
    meta: { call: "Weekly \"kitchen\" call", seats: ["kitchen"], quests: ["sunday-bread"], portable: false },
    reflection: "The kitchen opens on Sundays because people asked.",
    confirmed: true,
    createdAt: "2026-10-02T23:30:00.000Z",
    updatedAt: "2026-10-02T23:30:00.000Z",
  };

  it("writes frontmatter, one section per answered question, then the confirmed reflection", () => {
    const md = entryMarkdown(entry, "America/Costa_Rica", "Riverbend");
    expect(md).toBe(
      [
        "---",
        // 23:30 UTC is 17:30 the same day in Costa Rica.
        "date: 2026-10-02",
        "practice: debrief",
        "depth: light",
        'call: "Weekly \\"kitchen\\" call"',
        'seats: ["kitchen"]',
        'quests: ["sunday-bread"]',
        "portable: false",
        "privacy: internal",
        "confirmed_by_author: true",
        "tags: [journal, debrief]",
        "---",
        "",
        "## What got decided?",
        "",
        "We open the kitchen on Sundays.",
        "",
        "## What would Riverbend tell a new player?",
        "",
        "Ask the kitchen seat.",
        "",
        "## Reflection",
        "",
        "The kitchen opens on Sundays because people asked.",
        "",
      ].join("\n"),
    );
  });

  it("leaves an unconfirmed reflection out, because it is the guide's guess", () => {
    const md = entryMarkdown({ ...entry, confirmed: false }, "UTC", "Riverbend");
    expect(md).not.toContain("## Reflection");
    expect(md).toContain("confirmed_by_author: false");
  });
});
