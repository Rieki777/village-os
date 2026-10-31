/**
 * THE GRATITUDE NUDGE: when it is due, who hears it, that it lands once per
 * cycle per member, what it says, and how the suggestions are ranked.
 *
 * Pure. The sweep is driven through an in-memory notify that honours the
 * dedupe key the way the unique index does, so a whole lead window of runs can
 * be played in a loop. The joins the suggestions are read from are proved
 * against a real schema in server/gratitudeSuggestions.db.test.ts.
 */
import { describe, expect, it } from "vitest";
import { cycleWindow } from "./economy";
import { emailCadenceFor, resolveNotifyPrefs } from "./notify";
import { presenceTest } from "./memberPresence";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";
import {
  GRATITUDE_NUDGE_LINK,
  GRATITUDE_NUDGE_TYPE,
  dueNudge,
  gratitudeNudgeCopy,
  gratitudeNudgeKey,
  rankWorkedWith,
  runGratitudeNudge,
  type GratitudeNudgeDeps,
  type GratitudeSuggestion,
} from "./gratitudeNudge";

const DAY = 86_400_000;
const isPresent = presenceTest("gratitude-nudge-test-secret");

/** An instant `msBefore` the end of the cycle open now. */
function beforeClose(msBefore: number): Date {
  const { endsAt } = cycleWindow(new Date());
  return new Date(endsAt.getTime() - msBefore);
}

/** A notify that keeps one row per dedupe key, as the unique index does. */
function memoryNotify() {
  const rows = new Map<string, { userId: string; type: string; title: string; body: string; link: string }>();
  return {
    rows,
    notify: async (n: { userId: string; type: string; title: string; body?: string | null; link?: string | null; dedupeKey: string }) => {
      if (rows.has(n.dedupeKey)) return { fresh: false };
      rows.set(n.dedupeKey, { userId: n.userId, type: n.type, title: n.title, body: String(n.body), link: String(n.link) });
      return { fresh: true };
    },
  };
}

const people = [
  { id: "u-ana", passwordHash: "h" },
  { id: "u-ben", passwordHash: "h" },
  { id: "u-spent", passwordHash: "h" },
  { id: "u-quiet", passwordHash: "h", prefs: { notify: { gratitudeNudge: "off" } } },
  { id: "u-example", passwordHash: "h", isExample: true },
  { id: "u-unclaimed", passwordHash: "" },
];
const remaining: Record<string, number> = { "u-ana": 40, "u-ben": 5, "u-spent": 0, "u-quiet": 100, "u-example": 100, "u-unclaimed": 100 };
const three: GratitudeSuggestion[] = ["a", "b", "c"].map((h) => ({ userId: `u-${h}`, name: h, handle: h, sources: ["quest"] }));

function deps(at: Date, notify: GratitudeNudgeDeps["notify"], extra: Partial<GratitudeNudgeDeps> = {}): GratitudeNudgeDeps {
  return {
    at,
    leadDays: 3,
    timeZone: "UTC",
    currency: "Gratitude",
    members: people,
    isPresent,
    remainingFor: async (m) => remaining[String(m.id)] ?? 0,
    suggestionsFor: async () => three,
    notify,
    ...extra,
  };
}

describe("when the nudge is due", () => {
  it("is due inside the lead window and not before it", () => {
    expect(dueNudge(beforeClose(4 * DAY), 3)).toBeNull();
    expect(dueNudge(beforeClose(3 * DAY + 60_000), 3)).toBeNull();
    const due = dueNudge(beforeClose(3 * DAY - 60_000), 3);
    expect(due?.daysLeft).toBe(3);
    expect(due?.cycleId).toBe(cycleWindow(new Date()).key);
    expect(dueNudge(beforeClose(2 * 3_600_000), 3)?.daysLeft).toBe(1);
  });

  it("0 days switches it off for the village", () => {
    expect(dueNudge(beforeClose(60_000), 0)).toBeNull();
  });

  it("the lead is a registered dial, 3 days by default", () => {
    const def = VARIABLES_BY_KEY["gratitude.nudge_days_before_close"];
    expect(def?.default).toBe("3");
    expect(def?.min).toBe(0);
  });
});

describe("the sweep", () => {
  it("tells each present member with gratitude left exactly once per cycle, however often it runs", async () => {
    const mem = memoryNotify();
    // Every six hours across the whole window, as the job is registered.
    for (let ms = 3 * DAY - 60_000; ms > 0; ms -= 6 * 3_600_000) {
      await runGratitudeNudge(deps(beforeClose(ms), mem.notify));
    }
    const told = Array.from(mem.rows.values()).map((r) => r.userId).sort();
    expect(told).toEqual(["u-ana", "u-ben"]);
    const cycleId = cycleWindow(new Date()).key;
    expect(Array.from(mem.rows.keys()).sort()).toEqual([gratitudeNudgeKey(cycleId, "u-ana"), gratitudeNudgeKey(cycleId, "u-ben")]);
    for (const r of mem.rows.values()) {
      expect(r.type).toBe(GRATITUDE_NUDGE_TYPE);
      expect(r.link).toBe(GRATITUDE_NUDGE_LINK);
    }
  });

  it("CONTROL: the same sweep outside the window tells nobody", async () => {
    const mem = memoryNotify();
    const r = await runGratitudeNudge(deps(beforeClose(5 * DAY), mem.notify));
    expect(r.due).toBeNull();
    expect(mem.rows.size).toBe(0);
  });

  it("leaves out a member who turned it off, one with nothing left, an example and an unclaimed account", async () => {
    const mem = memoryNotify();
    const r = await runGratitudeNudge(deps(beforeClose(DAY), mem.notify));
    expect(r.eligible).toBe(2);
    const told = new Set(Array.from(mem.rows.values()).map((x) => x.userId));
    for (const id of ["u-spent", "u-quiet", "u-example", "u-unclaimed"]) expect(told.has(id)).toBe(false);
  });

  it("the next cycle is a new key, so the member hears it again then", async () => {
    const mem = memoryNotify();
    await runGratitudeNudge(deps(beforeClose(DAY), mem.notify));
    const { endsAt } = cycleWindow(new Date());
    const next = cycleWindow(new Date(endsAt.getTime() + DAY));
    await runGratitudeNudge(deps(new Date(next.endsAt.getTime() - DAY), mem.notify));
    expect(mem.rows.size).toBe(4);
  });

  it("one member's failure never stops the rest hearing", async () => {
    const mem = memoryNotify();
    const r = await runGratitudeNudge(
      deps(beforeClose(DAY), mem.notify, {
        remainingFor: async (m) => {
          if (m.id === "u-ana") throw new Error("boom");
          return remaining[String(m.id)] ?? 0;
        },
      }),
    );
    expect(r.told).toBe(1);
    expect(Array.from(mem.rows.values())[0]?.userId).toBe("u-ben");
  });

  it("has no way to send gratitude: its only write is the notice", () => {
    const keys = Object.keys(deps(new Date(), memoryNotify().notify)).sort();
    expect(keys).toEqual(["at", "currency", "isPresent", "leadDays", "members", "notify", "remainingFor", "suggestionsFor", "timeZone"]);
  });
});

describe("the words", () => {
  const due = { cycleId: "lunar-000330", endsAt: new Date("2026-11-02T10:00:00Z"), daysLeft: 3 };

  it("says how much is left and when it closes, with the people one tap away", () => {
    const c = gratitudeNudgeCopy({ remaining: 40, currency: "Gratitude", due, timeZone: "UTC", suggestions: 4 });
    expect(c.title).toBe("You have 40 Gratitude left to send this cycle");
    expect(c.body).toContain("closes in 3 days, on Monday 2 November");
    expect(c.body).toContain("4 people you worked with this cycle are one tap away");
  });

  it("names nobody, and carries no guilt", () => {
    const c = gratitudeNudgeCopy({ remaining: 1, currency: "Gratitude", due: { ...due, daysLeft: 1 }, timeZone: "UTC", suggestions: 0 });
    expect(c.body).toContain("closes tomorrow");
    expect(c.body).not.toContain("one tap away");
    expect(c.body).toContain("refills when the new cycle begins");
    for (const word of [/\bforget/i, /\bmiss/i, /\blose\b/i, /\blost\b/i, /\bwaste/i, /\bshould\b/i, /\bmust\b/i, /—/, /–/]) {
      expect(`${c.title} ${c.body}`).not.toMatch(word);
    }
  });

  it("is dated in the village's own timezone", () => {
    const late = { ...due, endsAt: new Date("2026-11-02T23:30:00Z") };
    expect(gratitudeNudgeCopy({ remaining: 5, currency: "G", due: late, timeZone: "Pacific/Auckland", suggestions: 0 }).body).toContain("Tuesday 3 November");
  });
});

describe("the member's preferences", () => {
  it("the nudge is on unless turned off", () => {
    expect(resolveNotifyPrefs({}).gratitudeNudge).toBe("on");
    expect(resolveNotifyPrefs({ notify: { gratitudeNudge: "off" } }).gratitudeNudge).toBe("off");
    expect(resolveNotifyPrefs({ notify: { gratitudeNudge: "junk" } }).gratitudeNudge).toBe("on");
  });

  it("its email rides the gratitude preference and the global switch", () => {
    expect(emailCadenceFor(GRATITUDE_NUDGE_TYPE, resolveNotifyPrefs({}))).toBe("daily");
    expect(emailCadenceFor(GRATITUDE_NUDGE_TYPE, resolveNotifyPrefs({ notify: { gratitudeEmail: "off" } }))).toBe("off");
    expect(emailCadenceFor(GRATITUDE_NUDGE_TYPE, resolveNotifyPrefs({ notify: { emailsOff: true } }))).toBe("off");
  });
});

describe("ranking who a member worked with", () => {
  it("weighs a shared quest above a shared room above a shared circle, and sums across sources", () => {
    const ranked = rankWorkedWith(
      [
        { userId: "u-circle", source: "circle", times: 1 },
        { userId: "u-room", source: "session", times: 1 },
        { userId: "u-quest", source: "quest", times: 1 },
        { userId: "u-both", source: "circle", times: 1 },
        { userId: "u-both", source: "session", times: 1 },
      ],
      { selfId: "u-me" },
    );
    expect(ranked.map((r) => r.userId)).toEqual(["u-both", "u-quest", "u-room", "u-circle"]);
    expect(ranked[0]?.sources).toEqual(["session", "circle"]);
  });

  it("leaves out the member themself and anybody already thanked this cycle", () => {
    const ranked = rankWorkedWith(
      [
        { userId: "u-me", source: "quest", times: 3 },
        { userId: "u-thanked", source: "quest", times: 3 },
        { userId: "u-next", source: "circle", times: 1 },
      ],
      { selfId: "u-me", alreadyThanked: new Set(["u-thanked"]) },
    );
    expect(ranked.map((r) => r.userId)).toEqual(["u-next"]);
  });

  it("orders ties the same way every time", () => {
    const rows = [
      { userId: "u-b", source: "session" as const, times: 1 },
      { userId: "u-a", source: "session" as const, times: 1 },
    ];
    expect(rankWorkedWith(rows, { selfId: "x" }).map((r) => r.userId)).toEqual(["u-a", "u-b"]);
  });
});
