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
import { LUNAR_CLOCK } from "./cycleClock";
import { accomplishmentsFor } from "./taskAccomplishments";
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
    expect(card.roles[0].powers.heading).toBe("Powers handed to this role, shared");
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

describe("tensions in plain words (PR 9)", () => {
  const NOW = new Date("2026-10-22T18:00:00Z");
  const moonFrom = LUNAR_CLOCK.boundsFor(NOW).startsAt;
  const inMoon = new Date(moonFrom.getTime() + 60_000).toISOString();
  const before = new Date(moonFrom.getTime() - 86_400_000).toISOString();
  // As the server sends them to a member who neither raised nor holds: the open words blank.
  const blanked = [
    { id: "o1", status: "open" as const, raisedBy: "", text: "" },
    { id: "a1", status: "answered" as const, raisedBy: "", text: "", answeredAt: inMoon },
    { id: "a2", status: "answered" as const, raisedBy: "", text: "", answeredAt: inMoon },
    { id: "a3", status: "answered" as const, raisedBy: "", text: "Brought words", broughtToCircle: true, answeredAt: before },
  ];
  const card = (over: Partial<PlayerCardInput>, r: Partial<PlayerRoleIn>) => buildPlayerCard(input({ viewerMember: true, ...over, roles: [role(1, r)] })).roles[0];

  it("a member whose words are withheld reads the count, never No tensions raised", () => {
    const r = card({}, { tensions: [{ id: "o1", status: "open", raisedBy: "", text: "" }] });
    const t = value(r.tensions);
    expect(t.counts).toEqual(["1 open tension, private to the role's holders"]);
    expect(t.open).toEqual([]);
    expect(JSON.stringify(r.tensions)).not.toContain("No tensions raised");
  });

  it("counts open and answered this moon, and shows the words brought to the circle", () => {
    const t = value(card({}, { tensions: blanked }).tensions);
    expect(t.counts).toEqual(["1 open tension, private to the role's holders", "2 answered this moon"]);
    expect(t.public).toEqual(["Brought words"]);
    expect(t.answered.n).toBe(3);
  });

  it("the raiser reads their own open words, and the rest still counts as private", () => {
    const t = value(
      card({ viewerUserId: "u-raiser" }, {
        tensions: [
          { id: "o1", status: "open", raisedBy: "u-raiser", text: "My words" },
          { id: "o2", status: "open", raisedBy: "", text: "" },
        ],
      }).tensions,
    );
    expect(t.open).toEqual(["My words"]);
    expect(t.counts).toEqual(["2 open tensions, 1 private to the role's holders"]);
  });

  it("a co-holder reads the open words on another holder's card, with no privacy line", () => {
    const t = value(card({ viewerUserId: "u-co" }, { viewerHolds: true, tensions: [{ id: "o1", status: "open", raisedBy: "", text: "Held words" }] }).tensions);
    expect(t.open).toEqual(["Held words"]);
    expect(t.counts).toEqual(["1 open tension"]);
  });

  it("only older answered ones: No open tensions; none at all: No tensions raised", () => {
    expect(value(card({}, { tensions: [blanked[3]] }).tensions).counts).toEqual(["No open tensions"]);
    expect(card({}, { tensions: [] }).tensions).toEqual({ kind: "empty", words: "No tensions raised" });
  });

  it("the door: raise for a member who does not hold it, Waiting on you on the holder's own card, nothing for a guest", () => {
    expect(card({}, { tensions: [] }).tensionDoor).toBe("raise");
    expect(card({ viewerUserId: OWNER.userId }, { tensions: [] }).tensionDoor).toBe("waiting");
    expect(card({ viewerUserId: "u-co" }, { viewerHolds: true, tensions: [] }).tensionDoor).toBeNull();
    expect(card({ viewerMember: false }, { tensions: [] }).tensionDoor).toBeNull();
    expect(card({ viewerUserId: null }, { tensions: [] }).tensionDoor).toBeNull();
    expect(card({}, { tensions: undefined }).tensionDoor).toBeNull();
  });

  it("proposal mode: Starts once adopted and no door", () => {
    const r = card({ mode: "proposal" }, { tensions: [] });
    expect(r.tensions).toEqual({ kind: "empty", words: "Starts once adopted" });
    expect(r.tensionDoor).toBeNull();
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
  it("labels each moon by its dates, and titles it by the month its new moon falls in (the approved design)", () => {
    const t = buildPlayerCard(input()).timeline;
    expect(t.moons.length).toBeGreaterThanOrEqual(3);
    for (const m of t.moons) {
      expect(m.label).toMatch(/^\d{1,2} [A-Z][a-z]{2} to \d{1,2} [A-Z][a-z]{2}$/);
      expect(m.label).not.toMatch(/Moon|October|November|December/);
    }
    expect(t.moons[0].title).toBe("Getting started");
    expect(t.moons.slice(1).every((m) => / Moon$/.test(m.title ?? ""))).toBe(true);
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
        // Past is a season that has ended (PR 3): s1 ended before s2 began.
        endedSeasonIds: ["s1"],
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

describe("accomplished", () => {
  const moons = accomplishmentsFor([
    { entryId: 9, kind: "done", byNo: 4, ownerNo: 4, ownerSeatId: "r1", note: null, at: "2026-10-12T16:00:00Z", text: "Write the welcome guide" },
    { entryId: 9, kind: "accepted", byNo: 5, ownerNo: 4, ownerSeatId: "r1", note: "Clear and kind", at: "2026-10-14T16:00:00Z", text: "Write the welcome guide" },
    { entryId: 8, kind: "done", byNo: 4, ownerNo: 4, ownerSeatId: null, note: null, at: "2026-10-13T16:00:00Z", text: "Reopened task" },
    { entryId: 8, kind: "accepted", byNo: 5, ownerNo: 4, ownerSeatId: null, note: null, at: "2026-10-14T17:00:00Z", text: "Reopened task" },
    { entryId: 8, kind: "reopened", byNo: 4, ownerNo: 4, ownerSeatId: null, note: null, at: "2026-10-15T17:00:00Z", text: "Reopened task" },
  ]);

  it("is unread when the host left it out, and draws nothing", () => {
    expect(buildPlayerCard(input()).accomplished).toEqual({ heading: CARD_WORDS.accomplished, moons: { kind: "unread" } });
  });

  it("says so when nothing was accepted yet", () => {
    expect(buildPlayerCard(input({ accomplished: [] })).accomplished.moons).toEqual({ kind: "empty", words: CARD_WORDS.noAccomplished });
  });

  it("is fed straight from accomplishmentsFor: dated moons, the role by its full title, the accept's date and note", () => {
    const out = value(buildPlayerCard(input({ accomplished: moons })).accomplished.moons);
    expect(out).toHaveLength(1);
    expect(out[0].label).toContain(" to ");
    // The reopened task is out of the list; the accepted one stays.
    expect(out[0].items.map((i) => i.id)).toEqual(["9"]);
    expect(out[0].items[0]).toMatchObject({ title: "Write the welcome guide", roleTitle: "Human Operations & Onboarding Lead Steward", note: "Clear and kind" });
    expect(out[0].items[0].accepted).toBe("Accepted on 14 Oct");
    expect(out[0].items[0].accepted).not.toMatch(/2026-10-14/);
  });
});

describe("proposal mode (PR 3): the card a role application asks for", () => {
  const roles5 = [1, 2, 3, 4, 5].map((n) => role(n, { termEndsAt: "2027-03-31T06:00:00Z" }));
  const proposal = () => buildPlayerCard(input({ roles: roles5, mode: "proposal", viewerUserId: "u-reader" }));

  it("one person applying for five roles is one card naming all five", () => {
    const card = proposal();
    expect(card.roles).toHaveLength(5);
    expect(card.header.rolesLine.startsWith("Applies for ")).toBe(true);
    for (const r of roles5) expect(card.header.rolesLine).toContain(r.name);
    expect(card.tiles.heading).toBe(CARD_WORDS.proposedRoles);
  });

  it("every live section reads Starts once adopted", () => {
    const card = proposal();
    expect(card.across.tasks).toEqual({ kind: "empty", words: "Starts once adopted" });
    expect(card.across.signs).toEqual({ kind: "empty", words: "Starts once adopted" });
    for (const r of card.roles) {
      expect(r.working.items).toEqual({ kind: "empty", words: "Starts once adopted" });
      expect(r.tensions).toEqual({ kind: "empty", words: "Starts once adopted" });
    }
    expect(card.across.load.openTasks).toBeNull();
  });

  it("a proposal holds nothing yet, so no tile reads a health dot", () => {
    for (const t of value(proposal().tiles.items)) expect(t.health).toBeNull();
  });

  it("the terms are the application's own, money small and last", () => {
    const rows = value(proposal().agreements.roles[0].rows);
    expect(rows[0].label).toBe("Term");
    expect(rows.slice(-3).every((r) => r.small)).toBe(true);
  });

  it("a live card is unchanged by the mode it does not ask for", () => {
    const live = buildPlayerCard(input());
    expect(live.across.tasks.kind).toBe("shown");
    expect(live.tiles.heading).toBe(CARD_WORDS.myRoles);
  });
});

describe("old seatings with no application join Past", () => {
  it("in plain words, linked to the role, never to an application", () => {
    const card = buildPlayerCard(
      input({
        applications: [],
        roleNames: { r1: "Human Operations & Onboarding Lead Steward" },
        pastSeatings: [{ roleId: "r1", startedAt: "2026-03-01T18:00:00Z", endedAt: "2026-06-01T18:00:00Z" }],
      }),
    );
    const past = value(card.applications.past);
    expect(past).toHaveLength(1);
    expect(past[0]).toMatchObject({
      title: "Human Operations & Onboarding Lead Steward",
      status: "Held, with no application on file",
      href: "/roles?seat=r1",
    });
    expect(past[0].filed).toMatch(/^Held from .+ to .+$/);
  });
});

/*
 * A10 (2026-10-31): every role card lists the powers that role holds.
 *
 * A role holds a power only when the village has handed it over
 * (capability_holding), and on a village that has handed none over every card
 * said "No powers held". The card now names what IS true: the powers handed to
 * the role, marked as such, and when there are none, the powers its classes
 * suit by the village's own affinity map, worded as information. It changes no
 * permission and never prompts anyone to hand anything over.
 */
describe("a role's powers", () => {
  const SEAT = { key: "org.seat", label: "Places people in roles" };
  const MODERATE = { key: "intake.moderate", label: "Moderates the intake" };

  it("marks a handed-over power as handed to this role", () => {
    const card = buildPlayerCard(input({ roles: [role(1, { powers: [SEAT] })] }));
    expect(card.roles[0].powers.heading).toBe("Powers handed to this role");
    expect(value(card.roles[0].powers.items)).toEqual(["Places people in roles"]);
    expect(card.roles[0].powers.note).toBeNull();
  });

  it("names what a role with nothing handed over is suited to, as information", () => {
    const card = buildPlayerCard(input({ roles: [role(1, { powers: [], suited: [SEAT, MODERATE] })] }));
    expect(card.roles[0].powers.heading).toBe("Suited to");
    expect(value(card.roles[0].powers.items)).toEqual(["Places people in roles", "Moderates the intake"]);
    expect(card.roles[0].powers.note).toBe("The village has not handed these over.");
    // Information, never a prompt to act.
    expect(cardText(card)).not.toMatch(/hand (it|them|these) over now|ask the village|request/i);
  });

  it("control: a role with nothing handed over and nothing suited still says so", () => {
    const card = buildPlayerCard(input({ roles: [role(1, { powers: [], suited: [] })] }));
    expect(card.roles[0].powers.items).toEqual({ kind: "empty", words: "No powers held" });
    expect(card.roles[0].powers.note).toBeNull();
  });

  it("a host that does not read suited powers behaves exactly as before", () => {
    const card = buildPlayerCard(input({ roles: [role(1, { powers: [] })] }));
    expect(card.roles[0].powers.items).toEqual({ kind: "empty", words: "No powers held" });
  });

  it("a power handed over is never also listed as suited, and two sources show it once", () => {
    const card = buildPlayerCard(input({ roles: [role(1, { powers: [SEAT], suited: [SEAT, MODERATE] })] }));
    expect(card.roles[0].powers.heading).toBe("Powers handed to this role");
    expect(value(card.roles[0].powers.items)).toEqual(["Places people in roles"]);
  });

  it("a power suited through two classes is listed once", () => {
    const card = buildPlayerCard(input({ roles: [role(1, { powers: [], suited: [SEAT, MODERATE, SEAT] })] }));
    expect(value(card.roles[0].powers.items)).toEqual(["Places people in roles", "Moderates the intake"]);
  });
});
