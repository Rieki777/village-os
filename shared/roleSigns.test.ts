/**
 * The sign catalog: each counter on rows shaped like its table, the trend
 * against the window before, and the rule that what cannot be counted never
 * reads as 0.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LUNAR_CLOCK } from "./cycleClock";
import {
  NOT_COUNTED_YET,
  SIGNS,
  SIGN_KEYS,
  TREND_FROM_NEXT_MOON,
  cycleWindows,
  isSignKey,
  readSign,
  type SignRows,
  type SignWindow,
} from "./roleSigns";

const TZ = "America/Costa_Rica";
const W: SignWindow = { from: new Date("2026-10-01T06:00:00Z"), to: new Date("2026-11-01T06:00:00Z"), timeZone: TZ };
const PREV: SignWindow = { from: new Date("2026-09-01T06:00:00Z"), to: W.from, timeZone: TZ };
const count = (key: (typeof SIGN_KEYS)[number], rows: SignRows, w = W) => SIGNS[key].count(rows, w);

describe("the catalog", () => {
  it("is closed and every key has a definition with a label, a counted-from line and a window", () => {
    expect(Object.keys(SIGNS).sort()).toEqual([...SIGN_KEYS].sort());
    for (const k of SIGN_KEYS) {
      expect(SIGNS[k].label.length).toBeGreaterThan(0);
      expect(SIGNS[k].countedFrom.startsWith("Counted from")).toBe(true);
      expect(["cycle", "state"]).toContain(SIGNS[k].window);
    }
  });

  it("has no sign-in counter, because sign-ins are not stored", () => {
    expect(SIGN_KEYS.some((k) => /sign-?in|login/i.test(k))).toBe(false);
    expect(isSignKey("sign-ins")).toBe(false);
  });

  it("every row shape names columns that exist in drizzle/", () => {
    const sql = fs
      .readdirSync(path.resolve(import.meta.dirname, "../drizzle"))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => fs.readFileSync(path.resolve(import.meta.dirname, "../drizzle", f), "utf8"))
      .join("\n");
    const cols = [
      "created_at", "decided_at", "filed_at", "superseded_at", "season_id", "joined_at", "claimed_at",
      "consented_at", "aim", "domain", "accountabilities", "started_at", "ended_at", "term_ends_at",
      "published_at", "circle_id", "member_no", "session_id", "kind", "org_role_id",
    ];
    for (const c of cols) expect(sql, c).toContain(`\`${c}\``);
  });
});

describe("applications answered within 2 business days", () => {
  const rows: SignRows = {
    seat_applications: [
      // Fri 9 Oct 10:00, answered Tue 13 Oct 09:00: in time across a weekend.
      { id: "a1", status: "adopted", created_at: "2026-10-09T16:00:00Z", decided_at: "2026-10-13T15:00:00Z" },
      // Mon 12 Oct, answered Fri 16 Oct: late.
      { id: "a2", status: "not-adopted", created_at: "2026-10-12T16:00:00Z", decided_at: "2026-10-16T16:00:00Z" },
      // Mon 19 Oct, never answered, long past its 2 days: counted against.
      { id: "a3", status: "voting", created_at: "2026-10-19T16:00:00Z", decided_at: null },
      // Fri 30 Oct, unanswered, still inside its 2 business days at the window's end: left out.
      { id: "a4", status: "awaiting-holder", created_at: "2026-10-30T16:00:00Z", decided_at: null },
      // Withdrawn: never the village's to answer.
      { id: "a5", status: "withdrawn", created_at: "2026-10-05T16:00:00Z", decided_at: null },
      // Outside the window.
      { id: "a6", status: "adopted", created_at: "2026-09-20T16:00:00Z", decided_at: "2026-09-21T16:00:00Z" },
    ],
  };
  it("counts n of the applications that are due", () => {
    expect(count("applications-answered", rows)).toMatchObject({ n: 1, of: 3 });
  });
  it("names its source columns", () => {
    expect(count("applications-answered", rows)?.source).toContain("seat_applications.decided_at");
  });
});

describe("season plans filed", () => {
  const rows: SignRows = {
    season_id: "s2",
    users: [
      { id: "u1", joined_at: "2026-01-01T00:00:00Z" },
      { id: "u2", joined_at: "2026-01-01T00:00:00Z" },
      { id: "u3", joined_at: "2026-01-01T00:00:00Z" },
    ],
    season_plans: [
      { user_id: "u1", season_id: "s2", filed_at: "2026-10-02T00:00:00Z", superseded_at: null },
      // Two versions from one member count once.
      { user_id: "u1", season_id: "s2", filed_at: "2026-10-03T00:00:00Z", superseded_at: null },
      // A draft, never filed.
      { user_id: "u2", season_id: "s2", filed_at: null, superseded_at: null },
      // Another season.
      { user_id: "u3", season_id: "s1", filed_at: "2026-07-01T00:00:00Z", superseded_at: null },
    ],
  };
  it("counts distinct members with a filed plan for the season, against every member", () => {
    expect(count("season-plans-filed", rows)).toMatchObject({ n: 1, of: 3 });
  });
});

describe("newcomers active within 7 days", () => {
  const rows: SignRows = {
    users: [
      { id: "n1", joined_at: "2026-10-02T12:00:00Z" }, // claims a quest on day 3
      { id: "n2", joined_at: "2026-10-05T12:00:00Z" }, // seated on day 10: too late
      { id: "n3", joined_at: "2026-10-08T12:00:00Z" }, // seated on day 1
      { id: "n4", joined_at: "2026-10-29T12:00:00Z" }, // inside their 7 days still: left out
      { id: "old", joined_at: "2026-08-01T12:00:00Z" }, // joined before the window
    ],
    quest_claims: [{ user_id: "n1", status: "claimed", claimed_at: "2026-10-05T12:00:00Z", consented_at: null }],
    org_role_assignments: [
      { org_role_id: "r1", user_id: "n2", started_at: "2026-10-15T12:00:00Z", ended_at: null, term_ends_at: null },
      { org_role_id: "r2", user_id: "n3", started_at: "2026-10-09T12:00:00Z", ended_at: null, term_ends_at: null },
    ],
  };
  it("counts newcomers whose first claim or role came within 7 days", () => {
    expect(count("newcomers-active", rows)).toMatchObject({ n: 2, of: 3 });
  });
});

describe("community quests finished", () => {
  it("counts consented claims in the window, with no whole", () => {
    const c = count("community-quests-finished", {
      quest_claims: [
        { user_id: "u1", status: "consented", claimed_at: "2026-09-28T00:00:00Z", consented_at: "2026-10-03T00:00:00Z" },
        { user_id: "u2", status: "consented", claimed_at: "2026-10-01T00:00:00Z", consented_at: "2026-10-20T00:00:00Z" },
        { user_id: "u3", status: "submitted", claimed_at: "2026-10-01T00:00:00Z", consented_at: null },
        { user_id: "u4", status: "consented", claimed_at: "2026-09-01T00:00:00Z", consented_at: "2026-09-10T00:00:00Z" },
      ],
    });
    expect(c).toMatchObject({ n: 2 });
    expect(c?.of).toBeUndefined();
  });
});

describe("roles with a full card and a term", () => {
  it("counts active roles with aim, domain, accountabilities and a term on a live holding", () => {
    const c = count("roles-with-card-and-term", {
      org_roles: [
        { id: "r1", active: 1, aim: "An aim", domain: "A domain", accountabilities: '["One thing"]' },
        { id: "r2", active: 1, aim: "An aim", domain: "A domain", accountabilities: ["One thing"] },
        { id: "r3", active: 1, aim: "An aim", domain: null, accountabilities: ["One thing"] },
        { id: "r4", active: 1, aim: "An aim", domain: "A domain", accountabilities: "[]" },
        { id: "r5", active: 0, aim: "An aim", domain: "A domain", accountabilities: ["One thing"] },
      ],
      org_role_assignments: [
        { org_role_id: "r1", user_id: "u1", started_at: "2026-09-01T00:00:00Z", ended_at: null, term_ends_at: "2026-12-31T00:00:00Z" },
        // r2's only holding has no term.
        { org_role_id: "r2", user_id: "u2", started_at: "2026-09-01T00:00:00Z", ended_at: null, term_ends_at: null },
        { org_role_id: "r3", user_id: "u3", started_at: "2026-09-01T00:00:00Z", ended_at: null, term_ends_at: "2026-12-31T00:00:00Z" },
      ],
    });
    expect(c).toMatchObject({ n: 1, of: 4 });
  });
});

describe("org chart drafts decided within 2 business days", () => {
  it("counts drafts published in time, leaving withdrawn ones and ones still in time out", () => {
    const c = count("org-drafts-decided", {
      org_drafts: [
        { id: "d1", status: "published", created_at: "2026-10-05T16:00:00Z", published_at: "2026-10-06T16:00:00Z" },
        { id: "d2", status: "reverted", created_at: "2026-10-05T16:00:00Z", published_at: "2026-10-07T16:00:00Z" },
        { id: "d3", status: "published", created_at: "2026-10-05T16:00:00Z", published_at: "2026-10-12T16:00:00Z" },
        { id: "d4", status: "withdrawn", created_at: "2026-10-05T16:00:00Z", published_at: null },
        { id: "d5", status: "open", created_at: "2026-10-30T16:00:00Z", published_at: null },
      ],
    });
    expect(c).toMatchObject({ n: 2, of: 3 });
  });
});

describe("circle met", () => {
  const rows: SignRows = {
    live_sessions: [
      { id: 1, circle_id: "c1", created_at: "2026-10-05T16:00:00Z" },
      { id: 2, circle_id: "c1", created_at: "2026-10-12T16:00:00Z" },
      { id: 3, circle_id: "c2", created_at: "2026-10-12T16:00:00Z" },
      { id: 4, circle_id: "c1", created_at: "2026-09-12T16:00:00Z" },
    ],
    live_session_people: [
      { session_id: 1, member_no: 1 },
      { session_id: 1, member_no: 2 },
      { session_id: 2, member_no: 1 }, // one person is not a meeting
      { session_id: 2, member_no: 1 },
      { session_id: 3, member_no: 3 },
      { session_id: 3, member_no: 4 },
      { session_id: 4, member_no: 1 },
      { session_id: 4, member_no: 2 },
    ],
  };
  it("counts sessions two or more people joined, narrowed to a circle when given", () => {
    expect(count("circle-met", rows)).toMatchObject({ n: 2 });
    expect(count("circle-met", { ...rows, circle_id: "c1" })).toMatchObject({ n: 1 });
  });
});

describe("decisions recorded", () => {
  it("counts decision entries in the window", () => {
    expect(
      count("decisions-recorded", {
        live_session_entries: [
          { session_id: 1, kind: "decision", status: "done", created_at: "2026-10-05T16:00:00Z" },
          { session_id: 1, kind: "decision", status: "done", created_at: "2026-10-06T16:00:00Z" },
          { session_id: 1, kind: "action", status: "done", created_at: "2026-10-06T16:00:00Z" },
          { session_id: 1, kind: "decision", status: "done", created_at: "2026-09-06T16:00:00Z" },
        ],
      }),
    ).toMatchObject({ n: 2 });
  });

  it("counts only what the room consented to: a proposal still open and one set aside are not decisions", () => {
    expect(
      count("decisions-recorded", {
        live_session_entries: [
          { session_id: 1, kind: "decision", status: "done", created_at: "2026-10-05T16:00:00Z" },
          { session_id: 1, kind: "decision", status: "open", created_at: "2026-10-05T17:00:00Z" },
          { session_id: 1, kind: "decision", status: "parked", created_at: "2026-10-06T16:00:00Z" },
        ],
      }),
    ).toMatchObject({ n: 1 });
  });
});

describe("readSign", () => {
  const entries: SignRows = {
    live_session_entries: [
      { session_id: 1, kind: "decision", status: "done", created_at: "2026-10-05T16:00:00Z" },
      { session_id: 1, kind: "decision", status: "done", created_at: "2026-10-06T16:00:00Z" },
      { session_id: 1, kind: "decision", status: "done", created_at: "2026-09-06T16:00:00Z" },
    ],
  };

  it("compares a cycle sign with the window before", () => {
    const r = readSign("decisions-recorded", entries, { current: W, previous: PREV });
    expect(r.kind).toBe("counted");
    if (r.kind !== "counted") return;
    expect(r.now.n).toBe(2);
    expect(r.trend).toMatchObject({ kind: "compare", before: { n: 1 }, direction: "up" });
  });

  it("reads down and same", () => {
    const fewer: SignRows = { live_session_entries: entries.live_session_entries!.slice(1) };
    const r1 = readSign("decisions-recorded", fewer, { current: W, previous: PREV });
    expect(r1.kind === "counted" && r1.trend).toMatchObject({ direction: "same" });
    const r2 = readSign("decisions-recorded", { live_session_entries: entries.live_session_entries!.slice(2) }, { current: W, previous: PREV });
    expect(r2.kind === "counted" && r2.trend).toMatchObject({ direction: "down" });
  });

  it("a state sign says the trend starts next moon and invents no past value", () => {
    const r = readSign(
      "season-plans-filed",
      { season_id: "s", users: [{ id: "u", joined_at: "2026-01-01T00:00:00Z" }], season_plans: [] },
      { current: W, previous: PREV },
    );
    expect(r.kind === "counted" && r.trend).toEqual({ kind: "later", words: TREND_FROM_NEXT_MOON });
  });

  it("an unknown sign is never 0", () => {
    for (const key of ["sign-ins", "", null, undefined]) {
      const r = readSign(key, entries, { current: W, previous: PREV });
      expect(r).toMatchObject({ kind: "not-counted", words: NOT_COUNTED_YET });
      expect(JSON.stringify(r)).not.toMatch(/"n":/);
    }
  });

  it("an unread table is never 0, and a read empty table is", () => {
    expect(readSign("decisions-recorded", {}, { current: W, previous: PREV })).toMatchObject({ kind: "not-counted" });
    const r = readSign("decisions-recorded", { live_session_entries: [] }, { current: W, previous: PREV });
    expect(r.kind === "counted" && r.now.n).toBe(0);
  });

  it("cycleWindows gives this moon so far and the whole moon before", () => {
    const now = new Date("2026-10-21T12:00:00Z");
    const w = cycleWindows(now, LUNAR_CLOCK, TZ);
    expect(w.current.to.toISOString()).toBe(now.toISOString());
    expect(w.previous.to.toISOString()).toBe(w.current.from.toISOString());
    expect(w.previous.from.getTime()).toBeLessThan(w.current.from.getTime());
  });
});
