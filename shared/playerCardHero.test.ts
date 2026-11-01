/**
 * THE HERO, THE MOON NAMES AND THE TRACK, from the approved design
 * (https://claude.ai/artifact/XGP6VP5WFU1T6ti7RD482P): "October Moon · Day 22
 * of 92" under the portrait, "Riverbend · Season of Foundations" over the
 * name, "Three roles in the Community Anchor · Full-time" under it, and the
 * term's span; the moons titled by the month their new moon falls in; and
 * the track's new and full moons and today.
 */
import { describe, expect, it } from "vitest";
import { buildPlayerCard, type ApplicationIn, type PlayerCardInput, type PlayerRoleIn } from "./playerCard";
import { countWord, moonNameOf, personTime, spanWords } from "./playerCardHero";

const TZ = "America/Costa_Rica";

function role(n: number, over: Partial<PlayerRoleIn> = {}): PlayerRoleIn {
  return {
    id: `r${n}`,
    name: `Steward Number ${n}`,
    aim: "A clear way in.",
    whyItMatters: null,
    domain: null,
    accountabilities: ["One thing."],
    criticality: "normal",
    circle: { id: "c1", name: "Community Anchor" },
    termEndsAt: "2026-12-31T06:00:00Z",
    archetypes: null,
    archetypesSuggested: false,
    bringMe: null,
    notMine: null,
    runbook: null,
    worksWith: [],
    powers: [],
    tensions: [],
    settings: null,
    ...over,
  };
}

const app = (over: Partial<ApplicationIn> = {}): ApplicationIn => ({
  id: "sa-1",
  candidate_user_id: "u-owner",
  seat_ids: ["r1"],
  status: "adopted",
  created_at: "2026-09-20T16:00:00Z",
  decided_at: "2026-09-25T16:00:00Z",
  term_season_id: "s2",
  starts_at: "2026-10-01",
  term_ends_at: "2026-12-31",
  ...over,
});

function input(over: Partial<PlayerCardInput> = {}): PlayerCardInput {
  return {
    now: new Date("2026-10-22T18:00:00Z"),
    timeZone: TZ,
    owner: { userId: "u-owner", displayName: "Lena Ortiz", avatar: "/api/uploads/portrait-1.webp" },
    viewerUserId: "u-owner",
    villageName: "Riverbend",
    season: { id: "s2", name: "Season of Foundations", startsOn: "2026-10-01", endsOn: "2027-01-01" }, // endsOn is the next season's first day
    nextSeasonId: null,
    archetypeNames: {},
    roles: [1, 2, 3].map((n) => role(n, { timeCommitment: "Part of a full-time season" })),
    plan: null,
    seasonalGoals: null,
    tasks: [],
    signRows: {},
    howIHold: null,
    applications: [],
    roleNames: {},
    bonusTokenName: null,
    ...over,
  };
}

describe("the hero", () => {
  it("reads as the design: the moon pill, the eyebrow, the tagline and the span", () => {
    const h = buildPlayerCard(input()).header;
    expect(h.moon.words).toBe("October Moon · Day 22 of 92");
    expect(h.eyebrow).toBe("Riverbend · Season of Foundations");
    expect(h.tagline).toBe("Three roles in the Community Anchor · Full-time");
    expect(h.span).toBe("1 October to 31 December 2026");
    expect(h.portrait).toEqual({ kind: "photo", src: "/api/uploads/portrait-1.webp" });
  });

  it("counts the day over the owner's adopted term when one covers today, and over the season otherwise", () => {
    const termed = buildPlayerCard(input({ applications: [app({ starts_at: "2026-10-15", term_ends_at: "2027-01-31" })] })).header;
    expect(termed.moon.words).toBe("October Moon · Day 8 of 109");
    expect(termed.moon.over).toBe("term");
    expect(termed.span).toBe("15 October 2026 to 31 January 2027");
    // A term not yet adopted, or somebody else's, is not the owner's term.
    const voting = buildPlayerCard(input({ applications: [app({ status: "voting", starts_at: "2026-10-15" })] })).header;
    expect(voting.moon).toMatchObject({ over: "season", words: "October Moon · Day 22 of 92" });
    const theirs = buildPlayerCard(input({ applications: [app({ candidate_user_id: "u-else", starts_at: "2026-10-15" })] })).header;
    expect(theirs.moon.over).toBe("season");
  });

  it("names the moon alone when there is no term and no season", () => {
    const h = buildPlayerCard(input({ season: null })).header;
    expect(h.moon).toMatchObject({ words: "October Moon", day: null, of: null, over: null });
    expect(h.span).toBeNull();
    expect(h.eyebrow).toBe("Riverbend");
  });

  it("E9: a proposal card is drawn in the season it is for, and counts no day of a season not running", () => {
    const next = { id: "s3", name: "Second Season", startsOn: "2027-01-01", endsOn: "2027-03-21" };
    const card = buildPlayerCard(input({ mode: "proposal", proposalSeason: next }));
    expect(card.header.eyebrow).toBe("Riverbend · Second Season");
    expect(card.header.span).toBe("1 January to 20 March 2027");
    expect(card.header.moon).toMatchObject({ words: "October Moon", day: null, of: null, over: null });
    // My moon cycle runs over that season.
    expect(card.timeline.moons[0].startsAt.slice(0, 10)).toBe("2027-01-01");
    // A season that has already ended: named, with no day counted.
    const past = buildPlayerCard(input({ mode: "proposal", proposalSeason: { id: "s1", name: "First Season", startsOn: "2026-03-01", endsOn: "2026-06-01" } })).header;
    expect(past.eyebrow).toBe("Riverbend · First Season");
    expect(past.moon.day).toBeNull();
    // No season for the proposal: none drawn, never the running one.
    const none = buildPlayerCard(input({ mode: "proposal", proposalSeason: null })).header;
    expect(none.eyebrow).toBe("Riverbend");
    expect(none.span).toBeNull();
    // Control: the live card, and a proposal card with no season named, keep the running season.
    expect(buildPlayerCard(input({ proposalSeason: next })).header.eyebrow).toBe("Riverbend · Season of Foundations");
    expect(buildPlayerCard(input({ mode: "proposal" })).header.moon.words).toBe("October Moon · Day 22 of 92");
  });

  it("names the moon by the month its new moon falls in, in the village's zone", () => {
    // The lunation that holds 22 October 2026 began with the new moon of 10 October.
    expect(moonNameOf(new Date("2026-10-10T15:50:00Z"), TZ)).toBe("October Moon");
    expect(moonNameOf(new Date("2026-11-01T03:00:00Z"), "UTC")).toBe("November Moon");
    expect(moonNameOf(new Date("2026-11-01T03:00:00Z"), TZ)).toBe("October Moon");
  });

  it("says the count in words up to twelve, and every circle once", () => {
    expect(countWord(1)).toBe("One");
    expect(countWord(12)).toBe("Twelve");
    expect(countWord(13)).toBe("13");
    const one = buildPlayerCard(input({ roles: [role(1)] })).header;
    expect(one.tagline).toBe("One role in the Community Anchor");
    const two = buildPlayerCard(input({ roles: [role(1), role(2, { circle: { id: "c2", name: "Land" } }), role(3, { circle: null })] })).header;
    expect(two.tagline).toBe("Three roles in the Community Anchor and the Land");
    expect(buildPlayerCard(input({ roles: [] })).header.tagline).toBe("Holds no roles yet");
    expect(buildPlayerCard(input({ roles: undefined })).header.tagline).toBe("");
    const proposal = buildPlayerCard(input({ mode: "proposal" })).header;
    expect(proposal.tagline).toBe("Applying for three roles in the Community Anchor · Full-time");
  });

  it("reads the time from the roles' own time chips, and guesses nothing", () => {
    const r = (t: string | null) => role(1, { timeCommitment: t });
    expect(personTime([r("Part of a full-time season")])).toBe("Full-time");
    expect(personTime([r("8 hours a week"), r("2 days a week")])).toBe("About 24 hours a week");
    expect(personTime([r("20 hours a week"), r("20 hours a week")])).toBe("Full-time");
    expect(personTime([r("Half time"), r("Half time")])).toBe("Full-time");
    expect(personTime([r("Mornings"), r("Mornings")])).toBe("Mornings");
    expect(personTime([r("Mornings"), r(null)])).toBeNull();
    expect(personTime([r(null)])).toBeNull();
  });

  it("writes the span's year once when both ends share it", () => {
    expect(spanWords(new Date("2026-10-01T12:00:00Z"), new Date("2026-12-31T12:00:00Z"), "UTC")).toBe("1 October to 31 December 2026");
    expect(spanWords(new Date("2026-11-01T12:00:00Z"), new Date("2027-03-31T12:00:00Z"), "UTC")).toBe("1 November 2026 to 31 March 2027");
  });
});

describe("the moons and the track", () => {
  it("titles each moon by its month and keeps its dates as its label", () => {
    const t = buildPlayerCard(input()).timeline;
    expect(t.moons.map((m) => m.title)).toEqual(["Getting started", "October Moon", "November Moon", "December Moon"]);
    expect(t.moons[1].label).toBe("10 Oct to 9 Nov");
  });

  it("draws the track from the first day to the last moon's last day, with today on it", () => {
    const track = buildPlayerCard(input()).timeline.track!;
    expect(track.startLabel).toBe("1 Oct");
    expect(track.endLabel).toBe("7 Jan");
    const news = track.marks.filter((m) => m.kind === "new");
    const fulls = track.marks.filter((m) => m.kind === "full");
    expect(news.length).toBeGreaterThanOrEqual(3);
    expect(fulls).toHaveLength(3);
    expect(track.today).toBeGreaterThan(20);
    expect(track.today).toBeLessThan(25);
    for (const m of track.marks) {
      expect(m.pct).toBeGreaterThanOrEqual(0);
      expect(m.pct).toBeLessThanOrEqual(100);
    }
    // The legend names only what the track draws: no invoice is set, so none is named.
    expect(track.kinds).toEqual(["new", "full"]);
  });

  it("puts an invoice on the track only where the terms set one", () => {
    const track = buildPlayerCard(input({ roles: [role(1, { settings: { v: 1 }, invoiceOn: ["2026-10-30"] })] })).timeline.track!;
    expect(track.marks.filter((m) => m.kind === "invoice")).toHaveLength(1);
    expect(track.kinds).toContain("invoice");
  });

  it("dates this moon's tasks by the moon they belong to", () => {
    expect(buildPlayerCard(input()).across.moonLine).toBe("October Moon, 10 Oct to 9 Nov");
  });
});

describe("the role tiles", () => {
  it("give each role the design's icon, from its name and then its domain", () => {
    const card = buildPlayerCard(
      input({
        roles: [
          role(1, { name: "Human Operations & Onboarding Lead Steward" }),
          role(2, { name: "Front-End & Game Platform Steward" }),
          role(3, { name: "Organizational Design & Governance Facilitator" }),
          role(4, { name: "Steward of the Fourth Thing", domain: "The food forest and the soil." }),
          role(5, { name: "Keeper", domain: null }),
        ],
      }),
    );
    if (card.tiles.items.kind !== "shown") throw new Error("tiles");
    expect(card.tiles.items.value.map((t) => t.icon)).toEqual(["door", "screen", "circles", "sprout", "star"]);
  });
});

describe("the season's end", () => {
  it("is the day before `endsOn`, because a season runs while today is before it", () => {
    const h = buildPlayerCard(input({ season: { id: "s2", name: "Autumn", startsOn: "2026-09-22", endsOn: "2026-12-21" } })).header;
    expect(h.span).toBe("22 September to 20 December 2026");
    expect(h.moon.words).toBe("October Moon · Day 31 of 90");
  });
});
