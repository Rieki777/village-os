/**
 * SEASON-END REMINDERS: which one is due, who hears it, and that it lands once.
 *
 * Rye, 2026-09-14: "we should give lots of warnings across the village two
 * weeks before the season ends to remind everyone to run the end of season
 * governance to record in for the next season."
 *
 * Pure. The sweep is driven through an in-memory notify that honours the
 * dedupe key the way the unique index does, so a whole fortnight of sweeps,
 * missed days included, can be played in a loop. The real index and the real
 * daily cap are proved in server/seasonReminders.db.test.ts.
 */
import { describe, expect, it } from "vitest";
import { makeGoogleLink } from "./oauthAccounts";
import { presenceTest } from "./memberPresence";
import { clearsDailyEmailCap, emailCadenceFor, resolveNotifyPrefs } from "./notify";
import {
  SEASON_REMINDER_LINKS,
  civilDaysUntil,
  dueSeasonReminder,
  formatCivilDate,
  runSeasonReminders,
  seasonReminderCopy,
  seasonReminderKey,
  seasonReminderRecipient,
} from "./seasonReminders";

const SPRING = { id: "spring-2026", name: "Spring", endsOn: "2026-10-01" };
const dueOn = (today: string, current: { id?: string; name?: string; endsOn?: string | null } | null = SPRING) =>
  dueSeasonReminder({ current, today });

/** Civil dates from `from` to `to`, inclusive. */
function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** A notify that keeps one row per dedupe key, as the unique index does. */
function memoryNotify() {
  const rows = new Map<string, { userId: string; title: string; body: string; link: string }>();
  return {
    rows,
    notify: async (n: { userId: string; title: string; body?: string | null; link?: string | null; dedupeKey: string }) => {
      if (rows.has(n.dedupeKey)) return { fresh: false };
      rows.set(n.dedupeKey, { userId: n.userId, title: n.title, body: String(n.body), link: String(n.link) });
      return { fresh: true };
    },
  };
}

const people = [
  { id: "u-ana", passwordHash: "h", role: "member" },
  { id: "u-rye", passwordHash: "h", role: "founder" },
  { id: "u-example", passwordHash: "", role: "member", isExample: true },
  { id: "u-gone", passwordHash: null, role: "member" },
];
const isAdmin = (u: Record<string, any>) => u.role === "admin" || u.role === "founder";
/** The host's bound presence predicate, as server/index.ts hands it in. */
const SECRET = "season-reminders-test-secret"; // module-review-ok: a fixture signing secret for tokens this test mints and reads back, never a real credential
const isPresent = presenceTest(SECRET);
/** The record server/routes/authGoogle.ts writes for a new Google member: no password, a signed link. */
const googleOnly = { id: "u-gina", passwordHash: "", role: "member", prefs: { googleLink: makeGoogleLink(SECRET, "u-gina", "google-sub-gina") } };

describe("which reminder is due", () => {
  it("sends none when no season is running", () => {
    expect(dueOn("2026-09-24", null)).toBeNull();
    expect(dueOn("2026-09-24", { id: "", endsOn: "2026-10-01" })).toBeNull();
  });

  it("sends none for an open-ended season, which has no end to count to", () => {
    expect(dueOn("2026-09-24", { id: "founding", endsOn: "" })).toBeNull();
    expect(dueOn("2026-09-24", { id: "founding", endsOn: null })).toBeNull();
  });

  it("sends none more than two weeks out", () => {
    expect(dueOn("2026-09-16")?.daysLeft ?? null).toBeNull();
    expect(civilDaysUntil("2026-09-16", "2026-10-01")).toBe(15);
  });

  it("sends each mark on its own day", () => {
    expect(dueOn("2026-09-17")).toMatchObject({ mark: 14, daysLeft: 14 });
    expect(dueOn("2026-09-24")).toMatchObject({ mark: 7, daysLeft: 7 });
    expect(dueOn("2026-09-28")).toMatchObject({ mark: 3, daysLeft: 3 });
    expect(dueOn("2026-09-30")).toMatchObject({ mark: 1, daysLeft: 1 });
  });

  it("between marks, answers the most recent mark to have arrived", () => {
    expect(dueOn("2026-09-20")).toMatchObject({ mark: 14, daysLeft: 11 });
    expect(dueOn("2026-09-29")).toMatchObject({ mark: 3, daysLeft: 2 });
  });

  it("sends none on the day the season turns, or after", () => {
    expect(dueOn("2026-10-01")).toBeNull();
    expect(dueOn("2026-10-03")).toBeNull();
  });

  it("sends none when either date is not a date", () => {
    expect(dueOn("soon")).toBeNull();
    expect(dueOn("2026-09-24", { id: "s", endsOn: "next spring" })).toBeNull();
  });
});

describe("CATCH-UP, when a sweep does not run on the day", () => {
  it("sends a missed 7-day reminder the next day, once, with the true count", async () => {
    const mem = memoryNotify();
    // Every day of the fortnight except the 7-day mark itself.
    for (const today of days("2026-09-17", "2026-09-30").filter((d) => d !== "2026-09-24")) {
      await runSeasonReminders({ season: { current: SPRING, today }, members: people, isPresent, isAdmin, notify: mem.notify });
      // A second sweep the same day, as the 12-hour job makes, changes nothing.
      const again = await runSeasonReminders({ season: { current: SPRING, today }, members: people, isPresent, isAdmin, notify: mem.notify });
      expect(again.told, today).toBe(0);
    }
    const ana = Array.from(mem.rows.entries()).filter(([, r]) => r.userId === "u-ana");
    expect(ana.map(([k]) => k.split(":")[3])).toEqual(["14", "7", "3", "1"]);
    const seven = ana.find(([k]) => k.split(":")[3] === "7")![1];
    expect(seven.title, "sent on the 25th, so it says six").toContain("6 days");
  });

  it("sends only the most recent mark when several were missed, never a stale one", async () => {
    const mem = memoryNotify();
    for (const today of days("2026-09-26", "2026-09-30")) {
      await runSeasonReminders({ season: { current: SPRING, today }, members: people, isPresent, isAdmin, notify: mem.notify });
    }
    const marks = Array.from(mem.rows.keys()).filter((k) => k.endsWith(":u-ana")).map((k) => k.split(":")[3]);
    expect(marks).toEqual(["7", "3", "1"]);
  });
});

describe("the key", () => {
  it("is one per season, end date, mark and person", () => {
    const due = dueOn("2026-09-24")!;
    expect(seasonReminderKey(due, "u-ana")).toBe("season-ending:spring-2026:2026-10-01:7:u-ana");
  });

  it("re-arms when an admin moves the end of the season", () => {
    const before = dueOn("2026-09-24")!;
    const moved = dueOn("2026-10-01", { ...SPRING, endsOn: "2026-10-08" })!;
    expect(moved.mark).toBe(before.mark);
    expect(seasonReminderKey(moved, "u-ana")).not.toBe(seasonReminderKey(before, "u-ana"));
  });

  it("fits the 191-character column however long the season id is", () => {
    const long = dueOn("2026-09-24", { ...SPRING, id: "s".repeat(400) })!;
    const key = seasonReminderKey(long, "u-ana");
    expect(key.length).toBeLessThanOrEqual(191);
    expect(key).toBe(seasonReminderKey(long, "u-ana"));
    expect(key.endsWith(":7:u-ana")).toBe(true);
  });
});

describe("the words and the link", () => {
  it("says when the season turns, as a date, and asks for the end-of-season governance", () => {
    const copy = seasonReminderCopy(dueOn("2026-09-25")!, "member");
    expect(copy.title).toBe("Spring turns in 6 days, on 1 October 2026");
    expect(copy.body).toContain("record what this season did");
    expect(copy.body).toContain("seat people for the next season");
    expect(copy.body).toContain("Seats end with the season by default");
    expect(copy.link).toBe(SEASON_REMINDER_LINKS.member);
  });

  it("points an admin at the season review and the season roll", () => {
    const copy = seasonReminderCopy(dueOn("2026-09-30")!, "admin");
    expect(copy.title).toContain("1 day,");
    expect(copy.body).toContain("Season Shapes");
    expect(copy.link).toBe("/admin?tab=seasons-patterns");
  });

  it("names the season generically when it has no name", () => {
    expect(seasonReminderCopy(dueOn("2026-09-24", { id: "s", endsOn: "2026-10-01" })!, "member").title).toMatch(/^This season turns/);
  });

  it("uses no dash the voice rules refuse", () => {
    for (const audience of ["member", "admin"] as const) {
      const copy = seasonReminderCopy(dueOn("2026-09-24")!, audience);
      expect(`${copy.title} ${copy.body}`).not.toMatch(/[–—]/);
    }
    expect(formatCivilDate("2026-02-01")).toBe("1 February 2026");
  });
});

describe("who hears it", () => {
  it("reaches real accounts and skips example users and departed or unclaimed accounts", () => {
    expect(people.filter((p) => seasonReminderRecipient(p, isPresent)).map((p) => p.id)).toEqual(["u-ana", "u-rye"]);
    expect(seasonReminderRecipient({ passwordHash: "h" }, isPresent)).toBe(false);
  });

  it("REACHES A MEMBER WHO SIGNS IN WITH GOOGLE AND HAS NO PASSWORD", async () => {
    expect(seasonReminderRecipient(googleOnly, isPresent)).toBe(true);
    // A forged link is nobody, exactly as at the sign-in door.
    const forged = { ...googleOnly, id: "u-forged", prefs: { googleLink: { ...googleOnly.prefs.googleLink, sig: "nope" } } };
    expect(seasonReminderRecipient(forged, isPresent)).toBe(false);
    const mem = memoryNotify();
    const r = await runSeasonReminders({ season: { current: SPRING, today: "2026-09-24" }, members: [...people, googleOnly, forged], isPresent, isAdmin, notify: mem.notify });
    expect(r).toMatchObject({ recipients: 3, told: 3 });
    expect(Array.from(mem.rows.values()).map((row) => row.userId)).toContain("u-gina");
  });

  it("gives admins the admin link and members the season calendar", async () => {
    const mem = memoryNotify();
    const r = await runSeasonReminders({ season: { current: SPRING, today: "2026-09-24" }, members: people, isPresent, isAdmin, notify: mem.notify });
    expect(r).toMatchObject({ recipients: 2, told: 2 });
    const byUser = new Map(Array.from(mem.rows.values()).map((row) => [row.userId, row.link]));
    expect(byUser.get("u-ana")).toBe("/seasonal-festivals");
    expect(byUser.get("u-rye")).toBe("/admin?tab=seasons-patterns");
  });

  it("tells nobody when the calendar could not be read", async () => {
    const mem = memoryNotify();
    const r = await runSeasonReminders({ season: undefined, members: people, isPresent, isAdmin, notify: mem.notify });
    expect(r).toEqual({ due: null, recipients: 0, told: 0 });
  });

  it("keeps telling the rest when one notify throws", async () => {
    let calls = 0;
    const r = await runSeasonReminders({
      season: { current: SPRING, today: "2026-09-24" },
      members: people,
      isPresent,
      isAdmin,
      notify: async () => {
        calls += 1;
        if (calls === 1) throw new Error("one bad row");
        return { fresh: true };
      },
    });
    expect(r.told).toBe(1);
    expect(calls).toBe(2);
  });
});

describe("the mail that carries it", () => {
  it("rides the governance preference, daily by default, and the global switch", () => {
    expect(emailCadenceFor("season_ending", resolveNotifyPrefs({}))).toBe("daily");
    expect(emailCadenceFor("season_ending", resolveNotifyPrefs({ notify: { governanceEmail: "immediate" } }))).toBe("immediate");
    expect(emailCadenceFor("season_ending", resolveNotifyPrefs({ notify: { emailsOff: true } }))).toBe("off");
  });

  it("clears the daily cap, alongside the steward window notices and nothing ordinary", () => {
    expect(clearsDailyEmailCap("season_ending")).toBe(true);
    expect(clearsDailyEmailCap("veto_window_closing")).toBe(true);
    expect(clearsDailyEmailCap("ballot_opened")).toBe(false);
    expect(clearsDailyEmailCap("season")).toBe(false);
  });
});
