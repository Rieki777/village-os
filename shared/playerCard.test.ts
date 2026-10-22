/**
 * THE PLAYER CARD'S VIEW MODEL, held to the rulings it carries.
 *
 * Reference design: https://claude.ai/artifact/49Fh3tdkSoNYTmNDFv24D1
 * (version 13). Every fixture person is invented, and they are placed exactly
 * where a careless model would copy them onto the card (a related role's
 * holder, a tension's raiser, another member's application), so the test that
 * no person but the owner is named has something to catch.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ARCHETYPES } from "./archetypes";
import {
  CARD_WORDS,
  buildPlayerCard,
  type ApplicationIn,
  type PlayerCardInput,
  type PlayerRoleIn,
  type Slot,
} from "./playerCard";
import { applicationHref } from "./seatApplications";
import type { SeatSettings } from "./seatSettings";

const TZ = "America/Costa_Rica";
const OWNER = { userId: "u-owner", displayName: "Lena Ortiz", avatar: null };
const OTHER_PEOPLE = ["Marco Diaz", "Pia Novak", "Tomas Reyes"];

const SETTINGS: SeatSettings = {
  v: 1,
  term: { endsOn: "2026-12-31", reviewOn: "2026-11-16", renewalOn: "2026-12-01", noticeDays: 14 },
  clocks: { pay: "calendar-month", work: "moon" },
  rhythm: { gatherings: [{ label: "Full team meeting", weekday: 1, time: "10:00", every: "week" }] },
  pay: { kind: "fixed", currency: "USD", amountMinor: 700000, per: "month" },
  allowance: { kind: "flat", currency: "USD", amountMinor: 22000, per: "month" },
  bonus: { kind: "equity", capWords: "set each moon", cadence: "each moon" },
  quests: { perMoonMin: 3, perMoonMax: 6, doneWhenRequired: true },
  scoreboard: {
    measures: [
      { measure: "Role applications answered within 2 business days", countedBy: "applications-answered", targetCount: 9 },
      { measure: "Gatherings held on time" },
    ],
  },
  ending: { noticeDays: 14, payThroughNotice: true },
};

function role(n: number, over: Partial<PlayerRoleIn> = {}): PlayerRoleIn {
  return {
    id: `r${n}`,
    name: n === 1 ? "Human Operations & Onboarding Lead Steward" : `Steward of Circle Work Number ${n}`,
    aim: "Everyone who comes here finds a clear way in and a role that fits.",
    whyItMatters: null,
    domain: "How a newcomer is welcomed and helped into a role.",
    accountabilities: ["The applicant pipeline, designed and run."],
    criticality: "high",
    circle: { id: "c1", name: "Community Anchor" },
    termEndsAt: "2026-12-31T06:00:00Z",
    archetypes: null,
    archetypesSuggested: false,
    bringMe: ["Someone who wants to join or help."],
    notMine: ["Binding legal or financial commitments."],
    runbook: undefined,
    worksWith: [{ roleId: "r-ops", roleName: "Operations & Platform Steward", about: "the intake agent", holderName: "Marco Diaz" } as never],
    powers: [{ key: "org.seat", label: "Places people in roles", sharedWith: ["Operations & Platform Steward"] }],
    tensions: [],
    settings: SETTINGS,
    ...over,
  };
}

const app = (id: string, over: Partial<ApplicationIn> = {}): ApplicationIn => ({
  id,
  candidate_user_id: OWNER.userId,
  seat_ids: ["r1"],
  status: "voting",
  created_at: "2026-10-05T16:00:00Z",
  decided_at: null,
  term_season_id: "s2",
  starts_at: null,
  term_ends_at: "2026-12-31T06:00:00Z",
  ...over,
});

function input(over: Partial<PlayerCardInput> = {}): PlayerCardInput {
  return {
    now: new Date("2026-10-22T18:00:00Z"),
    timeZone: TZ,
    owner: OWNER,
    viewerUserId: "u-stranger",
    villageName: "Riverbend",
    season: { id: "s2", name: "Season of Foundations", startsOn: "2026-10-01", endsOn: "2026-12-31" },
    nextSeasonId: "s3",
    archetypeNames: { builder: "The Builder", spaceholder: "The Spaceholder" },
    roles: [role(1)],
    plan: { aim: "Every role has a ratified card.", goals: [{ goal: "Clear organisation", howItHelps: "every role written down" }] },
    seasonalGoals: [{ title: "Ready to grow the team to 30", doneWhen: "the team can take in 30 people", doneBy: "2026-12-31" }],
    tasks: [
      { id: "t1", title: "Onboarding pipeline", roleId: "r1", status: "open", doneWhen: "every open role has an invitation" },
      { id: "t2", title: "Circle rhythm", roleId: "r1", status: "done" },
    ],
    signRows: {
      seat_applications: [
        { id: "a1", status: "adopted", created_at: "2026-10-12T16:00:00Z", decided_at: "2026-10-13T16:00:00Z" },
      ],
    },
    howIHold: [{ label: "When to find me", text: "Monday full team meeting." }],
    applications: [app("sa-1")],
    roleNames: { r1: "Human Operations & Onboarding Lead Steward" },
    bonusTokenName: "Seed Shares",
    ...over,
  };
}

const value = <T,>(s: Slot<T>): T => {
  if (s.kind !== "shown") throw new Error(`expected shown, got ${s.kind}`);
  return s.value;
};
/** Every string on the card except the header's own name field. */
function cardText(card: ReturnType<typeof buildPlayerCard>): string {
  const { header, ...rest } = card;
  const { name: _owner, ...headerRest } = header;
  return JSON.stringify({ headerRest, rest });
}

describe("how many roles", () => {
  it("0 roles: holds no roles yet, with doors to apply and to plan my season", () => {
    const card = buildPlayerCard(input({ roles: [] }));
    expect(card.header.rolesLine).toBe("Holds no roles yet");
    expect(card.across.heading).toBe("Holds no roles yet");
    expect(card.across.doors.map((d) => d.label)).toEqual([CARD_WORDS.applyDoor, CARD_WORDS.planDoor]);
    expect(card.tiles.items).toEqual({ kind: "empty", words: "Holds no roles yet" });
    expect(card.roles).toEqual([]);
    expect(card.across.load.words).toBe("0 roles · 1 open task this moon");
  });

  it("1 role: the heading is about my one role, and there are no doors", () => {
    const card = buildPlayerCard(input());
    expect(card.across.heading).toBe("Across my role");
    expect(card.across.doors).toEqual([]);
    expect(card.header.rolesLine).toBe("1 role: Human Operations & Onboarding Lead Steward");
  });

  it("6 roles: every one is listed, and two applications can carry them", () => {
    const six = [1, 2, 3, 4, 5, 6].map((n) => role(n));
    const card = buildPlayerCard(
      input({
        roles: six,
        roleNames: Object.fromEntries(six.map((r) => [r.id, r.name])),
        applications: [app("sa-a", { seat_ids: ["r1", "r2", "r3", "r4", "r5"] }), app("sa-b", { seat_ids: ["r6"] })],
      }),
    );
    expect(card.across.heading).toBe("Across all 6 roles");
    expect(value(card.tiles.items)).toHaveLength(6);
    expect(card.roles).toHaveLength(6);
    const apps = value(card.applications.thisSeason);
    expect(apps).toHaveLength(2);
    expect(apps[1].title).toBe(six[5].name);
    expect(card.across.load.words).toBe("6 roles · 1 open task this moon");
  });
});

describe("unread versus empty", () => {
  it("unread tasks draw nothing and leave the count out of the load; read and empty say so", () => {
    const unread = buildPlayerCard(input({ tasks: undefined }));
    expect(unread.across.tasks).toEqual({ kind: "unread" });
    expect(unread.across.load).toMatchObject({ words: "1 role", openTasks: null });
    const none = buildPlayerCard(input({ tasks: [] }));
    expect(none.across.tasks).toEqual({ kind: "empty", words: "No tasks this moon yet" });
    expect(none.across.load.words).toBe("1 role · 0 open tasks this moon");
    expect(none.across.load.openTasks).toEqual({ n: 0, source: "tasks.status" });
  });

  it("role fields that do not exist yet are unread, never an empty list", () => {
    const card = buildPlayerCard(input({ roles: [role(1, { bringMe: undefined, notMine: null, runbook: undefined })] }));
    expect(card.roles[0].bringMe.items).toEqual({ kind: "unread" });
    expect(card.roles[0].notMine.items).toEqual({ kind: "empty", words: "Not written yet" });
    expect(card.roles[0].runbook.text).toEqual({ kind: "unread" });
  });

  it("seasonal goals: unread prints nothing, empty prints its line, and at most 3 are kept", () => {
    expect(buildPlayerCard(input({ seasonalGoals: undefined })).across.seasonalGoals.items).toEqual({ kind: "unread" });
    expect(buildPlayerCard(input({ seasonalGoals: [] })).across.seasonalGoals.items).toEqual({
      kind: "empty",
      words: "No seasonal goals set yet",
    });
    const four = [1, 2, 3, 4].map((n) => ({ title: `Goal ${n}`, doneWhen: "it is done" }));
    const card = buildPlayerCard(input({ seasonalGoals: four }));
    expect(value(card.across.seasonalGoals.items)).toHaveLength(3);
    expect(card.across.seasonalGoals.heading).toBe("My seasonal goals");
    const one = buildPlayerCard(input());
    expect(one.across.seasonalGoals.heading).toBe("My seasonal goal");
    expect(value(one.across.seasonalGoals.items)[0]).toEqual({
      title: "Ready to grow the team to 30",
      doneWhen: "Done by 31 Dec when the team can take in 30 people",
    });
  });

  it("an unread season prints no day; a read season counts the day and names its source", () => {
    expect(buildPlayerCard(input({ season: undefined })).header.day).toEqual({ kind: "unread" });
    const day = value(buildPlayerCard(input()).header.day);
    expect(day.words).toBe("Day 22 of 92");
    expect(day.day.source).toBe("season.startsOn");
  });

  it("does not cap the moon's tasks", () => {
    const tasks = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: `t${n}`, title: `Task ${n}`, roleId: "r1", status: "open" as const }));
    expect(value(buildPlayerCard(input({ tasks })).across.tasks)).toHaveLength(7);
  });
});

describe("a role is its full title", () => {
  it("prints org_roles.name verbatim on the tile and the heading, with purpose straight after", () => {
    const card = buildPlayerCard(input());
    const name = "Human Operations & Onboarding Lead Steward";
    expect(value(card.tiles.items)[0].title).toBe(name);
    expect(card.roles[0].title).toBe(name);
    const keys = Object.keys(card.roles[0]);
    expect(keys.indexOf("purpose")).toBe(keys.indexOf("title") + 1);
    expect(card.roles[0].purpose.heading).toBe("Purpose");
    expect(value(card.roles[0].purpose.text)).toMatch(/^Everyone who comes here/);
    expect(cardText(card)).not.toMatch(/Role [A-F]\b/);
  });

  it("another role is named by its full title", () => {
    const card = buildPlayerCard(input());
    expect(value(card.roles[0].worksWith.items)).toEqual(["Operations & Platform Steward: the intake agent"]);
    expect(value(card.roles[0].powers.items)).toEqual(["Places people in roles, with Operations & Platform Steward"]);
    expect(card.roles[0].powers.heading).toBe("Powers, shared");
  });
});

describe("the archetype chip", () => {
  it("is absent when the role has no tags: no row and no label", () => {
    const card = buildPlayerCard(input());
    expect(card.roles[0].plays).toBeNull();
    expect(cardText(card)).not.toContain("Plays as");
  });

  it("names the class with the village's own name, so a rename shows the new name", () => {
    const card = buildPlayerCard(
      input({
        roles: [role(1, { archetypes: ["builder"] })],
        archetypeNames: { builder: "The Gardener" },
      }),
    );
    expect(card.roles[0].plays).toEqual({ label: "Plays as", chips: [{ key: "builder", name: "The Gardener" }] });
    expect(cardText(card)).not.toContain("The Builder");
  });

  it("leaves out tags the seed only suggested, and prints nothing for an unknown key", () => {
    expect(buildPlayerCard(input({ roles: [role(1, { archetypes: ["builder"], archetypesSuggested: true })] })).roles[0].plays).toBeNull();
    expect(buildPlayerCard(input({ roles: [role(1, { archetypes: ["no-such-class"] })] })).roles[0].plays).toBeNull();
    expect(buildPlayerCard(input({ roles: [role(1, { archetypes: ["builder"] })], archetypeNames: undefined })).roles[0].plays).toBeNull();
  });
});

describe("no person is named but the owner", () => {
  it("the card text carries no other display name, and the owner's only in the header", () => {
    const card = buildPlayerCard(
      input({
        viewerUserId: "u-raiser",
        roles: [
          role(1, {
            tensions: [
              { id: "x1", status: "open", raisedBy: "u-raiser", text: "Who decides intake?", raisedByName: "Pia Novak" } as never,
            ],
          }),
        ],
        applications: [app("sa-1"), app("sa-2", { candidate_user_id: "u-tomas", proposed_by: "Tomas Reyes" } as never)],
      }),
    );
    expect(card.header.name).toBe(OWNER.displayName);
    const text = cardText(card);
    for (const person of [...OTHER_PEOPLE, OWNER.displayName]) expect(text).not.toContain(person);
    // Control: the raiser's tension words did reach the card, so the names were in reach.
    expect(text).toContain("Who decides intake?");
  });

  it("the model's source imports no seed archetype names and holds no person names", () => {
    const src = ["playerCard.ts", "playerCardWords.ts", "roleSigns.ts", "businessDays.ts"]
      .map((f) => fs.readFileSync(path.resolve(import.meta.dirname, f), "utf8"))
      .join("\n");
    expect(src).not.toMatch(/from\s+["']\.\/archetypes["']/);
    expect(src).not.toMatch(/\bARCHETYPES\b/);
    for (const a of ARCHETYPES) expect(src).not.toContain(a.name);
    for (const person of [...OTHER_PEOPLE, OWNER.displayName]) expect(src).not.toContain(person);
    expect(src).not.toMatch(/holderName|raisedByName|display_name|user_name/);
  });
});

describe("tensions", () => {
  const tensions = [
    { id: "x1", status: "open" as const, raisedBy: "u-raiser", text: "Open words" },
    { id: "x2", status: "answered" as const, raisedBy: "u-raiser", text: "Kept private" },
    { id: "x3", status: "answered" as const, raisedBy: "u-raiser", text: "Brought to the circle", broughtToCircle: true },
  ];
  const read = (viewer: string | null) =>
    value(buildPlayerCard(input({ viewerUserId: viewer, roles: [role(1, { tensions })] })).roles[0].tensions);

  it("open words reach only the holder and the raiser", () => {
    expect(read("u-stranger").open).toEqual([]);
    expect(read(null).open).toEqual([]);
    expect(read("u-raiser").open).toEqual(["Open words"]);
    expect(read(OWNER.userId).open).toEqual(["Open words"]);
  });

  it("answered ones show a count, and words only once brought to the circle", () => {
    const t = read("u-stranger");
    expect(t.answered).toEqual({ n: 2, source: "tensions.status" });
    expect(t.public).toEqual(["Brought to the circle"]);
    expect(JSON.stringify(t)).not.toContain("Kept private");
  });
});

describe("signs and load", () => {
  it("a counted sign prints n of m and its source; a measure with no sign reads Not counted yet", () => {
    const signs = value(buildPlayerCard(input()).roles[0].working.items);
    expect(signs[0].value).toBe("1 of 1");
    expect(signs[0].from).toContain("Human Operations & Onboarding Lead Steward");
    expect(signs[0].target).toEqual({ n: 9, source: "settings.scoreboard.measures.targetCount" });
    expect(signs[1].value).toBe("Not counted yet");
    expect(signs[1].target).toBeNull();
  });

  it("unread sign rows never print a number", () => {
    const signs = value(buildPlayerCard(input({ signRows: undefined })).roles[0].working.items);
    expect(signs.map((s) => s.value)).toEqual(["Not counted yet", "Not counted yet"]);
  });

  it("load is facts only, never an adjective", () => {
    const words = buildPlayerCard(input()).across.load.words;
    expect(words).toBe("1 role · 1 open task this moon");
    expect(words).not.toMatch(/heavy|light|busy|full|stretched/i);
  });
});

describe("the timeline", () => {
  it("labels each moon by its dates and never by a name", () => {
    const t = buildPlayerCard(input()).timeline;
    expect(t.moons.length).toBeGreaterThanOrEqual(3);
    for (const m of t.moons) {
      expect(m.label).toMatch(/^\d{1,2} [A-Z][a-z]{2} to \d{1,2} [A-Z][a-z]{2}$/);
      expect(m.label).not.toMatch(/Moon|October|November|December/);
    }
    expect(t.moons[0].title).toBe("Getting started");
    expect(t.moons.filter((m) => m.now)).toHaveLength(1);
  });

  it("draws new and full moons and what the terms carry, and the gatherings as rhythm", () => {
    const t = buildPlayerCard(input()).timeline;
    const kinds = t.moons.flatMap((m) => m.markers.map((k) => k.kind));
    for (const k of ["new-moon", "full-moon", "review", "renewal", "ends"]) expect(kinds).toContain(k);
    expect(t.rhythm[0]).toBe(
      "Full team meeting, every week on Monday at 10:00, for Human Operations & Onboarding Lead Steward",
    );
  });

  it("draws an invoice marker only when the settings set one", () => {
    const none = buildPlayerCard(input()).timeline.moons.flatMap((m) => m.markers);
    expect(none.some((m) => m.kind === "invoice")).toBe(false);
    const some = buildPlayerCard(input({ roles: [role(1, { invoiceOn: ["2026-10-30"] })] })).timeline.moons.flatMap((m) => m.markers);
    expect(some.filter((m) => m.kind === "invoice")).toHaveLength(1);
  });
});

describe("my applications", () => {
  it("groups only my own applications into past, this season and next season", () => {
    const card = buildPlayerCard(
      input({
        applications: [
          app("sa-now"),
          app("sa-old", { term_season_id: "s1", status: "adopted" }),
          app("sa-next", { term_season_id: "s3" }),
          app("sa-other", { candidate_user_id: "u-someone" }),
        ],
      }),
    );
    expect(value(card.applications.past).map((a) => a.id)).toEqual(["sa-old"]);
    expect(value(card.applications.thisSeason).map((a) => a.id)).toEqual(["sa-now"]);
    expect(value(card.applications.nextSeason).map((a) => a.id)).toEqual(["sa-next"]);
    expect(value(card.applications.thisSeason)[0]).toMatchObject({
      href: applicationHref("sa-now"),
      starts: "Starts once adopted",
    });
  });

  it("says plainly when a group is empty", () => {
    const card = buildPlayerCard(input({ applications: [] }));
    expect(card.applications.past).toEqual({ kind: "empty", words: "No past seasons yet" });
    expect(buildPlayerCard(input({ applications: undefined })).applications.past).toEqual({ kind: "unread" });
  });
});

describe("agreements", () => {
  it("pay is words, small, at the bottom, with no figure anywhere", () => {
    const rows = value(buildPlayerCard(input()).agreements.roles[0].rows);
    const money = rows.filter((r) => r.small);
    expect(money.map((r) => r.label)).toEqual(["Pay", "Allowance", "Bonus"]);
    expect(rows.slice(-3).every((r) => r.small)).toBe(true);
    for (const r of money) expect(r.lines.join(" ")).not.toMatch(/\d/);
    expect(money[0].lines[0]).toBe("Fixed pay per month");
  });

  it("an equity bonus reads in the village's words, with the token passed in, and nothing about payout state", () => {
    const bonus = value(buildPlayerCard(input()).agreements.roles[0].rows).find((r) => r.label === "Bonus")!;
    expect(bonus.lines[0]).toBe("Paid in Riverbend as Seed Shares, then claimed off the platform.");
    expect(bonus.lines.join(" ")).not.toMatch(/not yet paid|rated in words|pending|owed/i);
  });

  it("says when no review date is set, and when no terms were written", () => {
    const noReview = buildPlayerCard(input({ roles: [role(1, { settings: { v: 1, term: { endsOn: "2026-12-31" } } })] }));
    expect(value(noReview.agreements.roles[0].rows)[0].lines).toContain("No review date set");
    expect(buildPlayerCard(input({ roles: [role(1, { settings: null })] })).agreements.roles[0].rows).toEqual({
      kind: "empty",
      words: "No terms written yet",
    });
  });
});

describe("copy rules", () => {
  it("the card's words say role and tasks, never seat or quests for role work, and no hours or dashes", () => {
    // Copy only: machinery fields (ids, hrefs, sources) keep their stored spelling.
    const machinery = new Set(["id", "roleId", "key", "href", "anchor", "source", "at", "startsAt", "endsAt", "reading"]);
    const copy = (v: unknown) => JSON.stringify(v, (k, x) => (machinery.has(k) ? undefined : x));
    const text = copy(buildPlayerCard(input())) + JSON.stringify(CARD_WORDS);
    expect(text).not.toMatch(/\bseats?\b/i);
    expect(text).not.toMatch(/48 hours|\bhours\b/);
    expect(text).not.toMatch(/[–—]/);
    expect(text).not.toMatch(/scoreboard/i);
  });
});
