/**
 * The grouping both the `?candidate=` list and the player card read: past,
 * this season, next season, and only the person's own rows.
 */
import { describe, expect, it } from "vitest";
import { applicationGroup, endedSeasons, groupApplications, PAST_SEATING_WORDS, type GroupingContext } from "./applicationGroups";

const NOW = new Date("2026-10-22T18:00:00Z");
const CTX: GroupingContext = {
  now: NOW,
  seasonId: "s2",
  seasonEndsAt: new Date("2026-12-31T06:00:00Z"),
  nextSeasonId: "s3",
  endedSeasonIds: new Set(["s1"]),
};

const row = (over: Partial<{ id: string; candidateUserId: string; termSeasonId: string | null; startsAt: string | null; termEndsAt: string | null }> = {}) => ({
  id: "sa-x",
  candidateUserId: "u-me",
  termSeasonId: "s2",
  startsAt: null,
  termEndsAt: "2026-12-31T06:00:00Z",
  ...over,
});

describe("applicationGroup", () => {
  it("a term in a season that has ended is past", () => {
    expect(applicationGroup(row({ termSeasonId: "s1", termEndsAt: "2026-09-30T06:00:00Z" }), CTX)).toBe("past");
  });

  it("a term in an ended season is past even when its end date was written later", () => {
    expect(applicationGroup(row({ termSeasonId: "s1", termEndsAt: "2027-01-01T00:00:00Z" }), CTX)).toBe("past");
  });

  it("a term with no season whose end has passed is past", () => {
    expect(applicationGroup(row({ termSeasonId: null, termEndsAt: "2026-08-01T00:00:00Z" }), CTX)).toBe("past");
  });

  it("a term in this season is this season, whatever its end", () => {
    expect(applicationGroup(row(), CTX)).toBe("thisSeason");
    expect(applicationGroup(row({ termEndsAt: "2026-10-01T00:00:00Z" }), CTX)).toBe("thisSeason");
  });

  it("a term in the next season is next season", () => {
    expect(applicationGroup(row({ termSeasonId: "s3", termEndsAt: "2027-03-31T00:00:00Z" }), CTX)).toBe("nextSeason");
  });

  it("a start on or after the day this season ends is next season", () => {
    expect(applicationGroup(row({ termSeasonId: null, startsAt: "2026-12-31T06:00:00Z", termEndsAt: "2027-03-01T00:00:00Z" }), CTX)).toBe("nextSeason");
    expect(applicationGroup(row({ termSeasonId: null, startsAt: "2026-12-30T06:00:00Z", termEndsAt: "2027-03-01T00:00:00Z" }), CTX)).toBe("thisSeason");
  });

  it("with no season set, a live term is this season", () => {
    const none = { ...CTX, seasonId: null, seasonEndsAt: null, nextSeasonId: null, endedSeasonIds: [] };
    expect(applicationGroup(row({ termSeasonId: null }), none)).toBe("thisSeason");
  });
});

describe("groupApplications", () => {
  it("keeps only the person's own rows, in the order they arrived", () => {
    const groups = groupApplications(
      [
        row({ id: "a-now" }),
        row({ id: "a-old", termSeasonId: "s1" }),
        row({ id: "a-other", candidateUserId: "u-someone" }),
        row({ id: "a-next", termSeasonId: "s3" }),
        row({ id: "a-now-2" }),
      ],
      "u-me",
      CTX,
    );
    expect(groups.past.map((a) => a.id)).toEqual(["a-old"]);
    expect(groups.thisSeason.map((a) => a.id)).toEqual(["a-now", "a-now-2"]);
    expect(groups.nextSeason.map((a) => a.id)).toEqual(["a-next"]);
  });
});

describe("endedSeasons", () => {
  it("names the seasons whose end has passed and skips open-ended ones", () => {
    const at = (d: string) => new Date(`${d}T06:00:00Z`);
    const ended = endedSeasons(
      [
        { id: "s1", endsOn: "2026-10-01" },
        { id: "s2", endsOn: "2026-12-31" },
        { id: "s0", endsOn: null },
      ],
      at,
      NOW,
    );
    expect(Array.from(ended)).toEqual(["s1"]);
  });
});

describe("past seating words", () => {
  it("say plainly that no application is on file, with no dash", () => {
    expect(PAST_SEATING_WORDS.status).toBe("Held, with no application on file");
    expect(PAST_SEATING_WORDS.held("1 March 2026", "1 June 2026")).toBe("Held from 1 March 2026 to 1 June 2026");
    expect(PAST_SEATING_WORDS.held(null, null)).toBe("Held before applications were kept");
    for (const w of [PAST_SEATING_WORDS.status, PAST_SEATING_WORDS.held("a", "b")]) expect(w).not.toMatch(/[–—]/);
  });
});
