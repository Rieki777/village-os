/**
 * A fresh village's seasons.
 *
 * The property under test is the one whose absence made every seat
 * unremovable: on ANY date, a village that has written no season list still
 * has a current season, so a term that expires each season can come due.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import {
  defaultSeasonsFor,
  isTimeZone,
  normalizeSeasonConfig,
  seasonDocumentToStore,
  seasonRunningProblem,
  suggestNextSeasonDates,
} from "./seasonCalendar";
import { GAME_CONFIG } from "../../shared/gameConfig";
import { LUNAR_CLOCK } from "../../shared/cycleClock";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { dbDocument } from "../repos/store-db";

// ── D2-8 and D2-9: the stored season document ─────────────────────────────

const SAVED_AT = new Date("2026-09-14T12:00:00Z");
const UNKNOWN_ZONE =
  '"Bogus/Zone" is not a timezone this server knows. Use a name from the IANA list, like UTC or Europe/Lisbon.';

describe("a stored empty list with a zone nobody can format (D2-8)", () => {
  it("derives in the default zone instead of throwing, for every unformattable zone", () => {
    expect(isTimeZone("Bogus/Zone")).toBe(false);
    expect(isTimeZone(GAME_CONFIG.season.timezone)).toBe(true);
    for (const bad of ["", "   ", "Bogus/Zone"]) {
      const cfg = normalizeSeasonConfig({ seasons: [], cadence: "quarterly", timezone: bad }, SAVED_AT);
      expect(cfg.timezone, JSON.stringify(bad)).toBe(GAME_CONFIG.season.timezone);
      expect(cfg.seasons.length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });

  it("the save refuses an unknown or empty zone in words, and names it", () => {
    expect(seasonDocumentToStore({ seasons: [], cadence: "quarterly", timezone: "Bogus/Zone" }, SAVED_AT)).toEqual({
      ok: false,
      error: UNKNOWN_ZONE,
    });
    const empty = seasonDocumentToStore({ seasons: [], timezone: "" }, SAVED_AT);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toContain("The timezone is empty");
  });
});

describe("saving the list the Season tab was shown (D2-9)", () => {
  const shownTo = (cadence: string, timezone: string) => normalizeSeasonConfig({ cadence, timezone }, SAVED_AT);

  it("stores an empty list when the list sent back is exactly the derived one", () => {
    const shown = shownTo("quarterly", "UTC");
    expect(shown.seasons.length).toBe(8);
    const saving = seasonDocumentToStore({ seasons: shown.seasons, cadence: "quarterly", timezone: "UTC" }, SAVED_AT);
    // `timezoneAnswer` is part of the document's shape now, and null here is
    // the honest reading: this save changed no zone and confirmed none, so it
    // is not an answer. Asserted whole rather than loosened, because the
    // document a save stores is exactly what this describe block is about.
    expect(saving).toEqual({
      ok: true,
      doc: { seasons: [], cadence: "quarterly", timezone: "UTC", timezoneAnswer: null },
    });
  });

  it("stores an empty list when the list sent is empty", () => {
    const saving = seasonDocumentToStore({ seasons: [], cadence: "lunar", timezone: "UTC" }, SAVED_AT);
    expect(saving.ok && saving.doc.seasons).toEqual([]);
  });

  it("stores a list the village edited, and a legacy single season, as written", () => {
    const shown = shownTo("quarterly", "UTC");
    const renamed = shown.seasons.map((s, i) => (i === 0 ? { ...s, name: "The Planting" } : s));
    const saving = seasonDocumentToStore({ seasons: renamed, cadence: "quarterly", timezone: "UTC" }, SAVED_AT);
    expect(saving.ok && saving.doc.seasons.length).toBe(8);
    expect(saving.ok && saving.doc.seasons[0].name).toBe("The Planting");
    const legacy = seasonDocumentToStore({ name: "Founding", startsOn: "2026-01-01", endsOn: "" }, SAVED_AT);
    expect(legacy.ok && legacy.doc.seasons.map((s) => s.name)).toEqual(["Founding"]);
  });
});

describe.skipIf(!testDbConfigured())("the season document as it is actually stored", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  const rowValue = async (): Promise<any> => {
    const [rows] = await pool.query<any[]>("SELECT value FROM app_config WHERE config_key = 'season'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const v = rows[0]?.value;
    return typeof v === "string" ? JSON.parse(v) : v;
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 2 }); // module-review-ok: the S5 scratch-schema harness pool
  }, 300000);
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("a first save of the shown list stores [], and the village keeps deriving afterwards", async () => {
    const repo = dbDocument(pool, "season", GAME_CONFIG.season as any);
    await repo.load();
    const shown = normalizeSeasonConfig(repo.get(), SAVED_AT);
    const saving = seasonDocumentToStore({ seasons: shown.seasons, cadence: shown.cadence, timezone: shown.timezone }, SAVED_AT);
    expect(saving.ok).toBe(true);
    if (!saving.ok) return;
    await repo.put(saving.doc);

    const stored = await rowValue();
    expect(stored.seasons).toEqual([]);
    // A reader a year later, from a fresh load, gets a list derived for THAT day.
    const later = dbDocument(pool, "season", GAME_CONFIG.season as any);
    await later.load();
    const yearOn = normalizeSeasonConfig(later.get(), new Date("2027-09-14T12:00:00Z"));
    expect(yearOn.seasons[0].startsOn > shown.seasons[0].startsOn).toBe(true);
  });

  it("a stored empty list with a broken zone still reads, from a fresh load", async () => {
    const repo = dbDocument(pool, "season", GAME_CONFIG.season as any);
    await repo.put({ seasons: [], cadence: "quarterly", timezone: "Bogus/Zone" } as any);
    const fresh = dbDocument(pool, "season", GAME_CONFIG.season as any);
    await fresh.load();
    expect((await rowValue()).timezone).toBe("Bogus/Zone");
    const read = normalizeSeasonConfig(fresh.get(), SAVED_AT);
    expect(read.seasons.length).toBeGreaterThan(0);
    expect(read.timezone).toBe(GAME_CONFIG.season.timezone);
  });
});

/** The seasonState rule, in miniature: latest season begun and not ended. */
function currentOn(seasons: ReturnType<typeof defaultSeasonsFor>, today: string) {
  const running = seasons.filter((s) => s.startsOn <= today && (!s.endsOn || today < s.endsOn));
  return running.length ? running[running.length - 1] : null;
}

const DATES = [
  "2020-01-01", "2024-02-29", "2026-09-03", "2026-12-21", "2026-12-22",
  "2027-06-30", "2030-03-20", "2044-11-11", "2051-01-15",
];

describe("the platform no longer ships one village's expired dates", () => {
  it("seeds an empty list, so the derivation is what a fork gets", () => {
    expect(GAME_CONFIG.season.seasons).toEqual([]);
  });
});

describe("a fresh village has a current season on any date", () => {
  for (const cadence of ["solstice-equinox", "quarterly", "lunar", "custom"]) {
    for (const tz of ["UTC", "America/Costa_Rica", "Pacific/Auckland"]) {
      it(`${cadence} in ${tz}`, () => {
        for (const iso of DATES) {
          const at = new Date(`${iso}T12:00:00Z`);
          const seasons = defaultSeasonsFor(cadence, tz, at);
          expect(seasons.length).toBeGreaterThan(0);
          const today = new Intl.DateTimeFormat("en-CA", {
            timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
          }).format(at);
          const current = currentOn(seasons, today);
          expect(current, `${cadence}/${tz} on ${today}`).not.toBeNull();
          expect(current!.name).toBeTruthy();
        }
      });
    }
  }

  it("lays the seasons end to end with no gap and no overlap", () => {
    const seasons = defaultSeasonsFor("solstice-equinox", "UTC", new Date("2026-09-03T12:00:00Z"));
    for (let i = 0; i + 1 < seasons.length; i++) {
      expect(seasons[i].endsOn).toBe(seasons[i + 1].startsOn);
      expect(seasons[i].startsOn < seasons[i].endsOn).toBe(true);
    }
  });

  it("gives every entry a distinct id and an end date", () => {
    const seasons = defaultSeasonsFor("quarterly", "UTC", new Date("2026-09-03T12:00:00Z"));
    expect(new Set(seasons.map((s) => s.id)).size).toBe(seasons.length);
    expect(seasons.every((s) => !!s.endsOn)).toBe(true);
  });

  it("carries no village's name, theme or goals", () => {
    for (const s of defaultSeasonsFor("solstice-equinox", "UTC", new Date())) {
      expect(s.theme).toBe("");
      expect(s.focus).toBe("");
      expect(s.goals).toEqual([]);
    }
  });
});

describe("the next-season suggestion reads the clock", () => {
  it("puts a lunar cadence on real cycle boundaries, never 30 civil days", () => {
    const { startsOn, endsOn } = suggestNextSeasonDates("lunar", "2026-09-03", "UTC");
    expect(startsOn).toBe("2026-09-03");
    const from = new Date("2026-09-03T00:00:00Z");
    const expected = LUNAR_CLOCK.startOf(LUNAR_CLOCK.cycleNumberAt(from) + 3);
    expect(endsOn).toBe(expected.toISOString().slice(0, 10));
    // Three lunations is about 88.6 days, so the old "+30 days" answer is
    // nowhere near it and the two can never be confused.
    expect(endsOn).not.toBe("2026-10-03");
  });

  it("runs a solstice cadence to the next turning, never to a one-day season", () => {
    const { endsOn } = suggestNextSeasonDates("solstice-equinox", "2026-09-20", "UTC");
    expect(endsOn > "2026-11-01").toBe(true);
  });

  it("falls back to a quarter for quarterly and custom", () => {
    expect(suggestNextSeasonDates("quarterly", "2026-09-03", "UTC").endsOn).toBe("2026-12-03");
    expect(suggestNextSeasonDates("custom", "2026-09-03", "UTC").endsOn).toBe("2026-12-03");
  });
});

describe("no season running is a loud condition", () => {
  it("says nothing while a season runs", () => {
    expect(seasonRunningProblem({ currentId: "s1", configuredCount: 2, allEnded: false })).toBeNull();
  });

  it("names the seat consequence when nothing is configured", () => {
    const p = seasonRunningProblem({ currentId: null, configuredCount: 0, allEnded: false });
    expect(p).toContain("cannot come due");
    expect(p).toContain("none is configured");
  });

  it("distinguishes all-ended from a gap in the dates", () => {
    const ended = seasonRunningProblem({ currentId: null, configuredCount: 2, allEnded: true });
    const gap = seasonRunningProblem({ currentId: null, configuredCount: 2, allEnded: false });
    expect(ended).toContain("have ended");
    expect(gap).toContain("gap in the season dates");
    expect(ended).not.toBe(gap);
  });
});

/**
 * HAS THIS VILLAGE SAID WHICH CLOCK IT KEEPS?
 *
 * The platform ships `America/Costa_Rica`, and every fork inherits it in
 * silence: seasons derive dated entries whatever the zone, so the launch
 * checklist's season item goes green without anybody opening the tab, and the
 * zone decides when a day, a season, the claims window and every time on the
 * calendar turn.
 *
 * A STORED ZONE PROVES NOTHING, which is the whole reason for a separate
 * field. `GET /api/admin/seasons` hands the tab the NORMALISED document, so a
 * fresh village's form already holds Costa Rica's zone and any save writes it
 * back. Renaming a season would otherwise count as confirming a clock.
 */
describe("the timezone answer", () => {
  const AT = new Date("2026-09-23T10:00:00Z");
  const standing = (over: Record<string, unknown> = {}) => ({
    timezone: "America/Costa_Rica",
    timezoneAnswer: null,
    ...over,
  });

  it("is absent on a document nobody has answered, which is every old one", () => {
    const cfg = normalizeSeasonConfig({ cadence: "solstice-equinox", timezone: "Europe/Lisbon" });
    expect(cfg.timezoneAnswer ?? null).toBeNull();
  });

  it("is not written by an ordinary save that leaves the zone alone", () => {
    // The tab sends back what it was given. This is the case that would
    // otherwise have every village silently confirming Costa Rica.
    const saved = seasonDocumentToStore(
      { seasons: [], cadence: "solstice-equinox", timezone: "America/Costa_Rica" },
      AT,
      standing(),
      "founder-1",
    );
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.doc.timezoneAnswer ?? null).toBeNull();
  });

  it("is written when the zone genuinely changes, because choosing is answering", () => {
    const saved = seasonDocumentToStore(
      { seasons: [], cadence: "solstice-equinox", timezone: "Pacific/Auckland" },
      AT,
      standing(),
      "founder-1",
    );
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.doc.timezoneAnswer).toEqual({ at: AT.toISOString(), by: "founder-1" });
  });

  it("is written when somebody confirms the zone already showing", () => {
    // The only way to agree with an inherited value, and the reason the
    // button exists: a village really in Costa Rica has nothing to change.
    const saved = seasonDocumentToStore(
      { seasons: [], cadence: "solstice-equinox", timezone: "America/Costa_Rica", confirmTimezone: true },
      AT,
      standing(),
      "founder-1",
    );
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.doc.timezoneAnswer).toEqual({ at: AT.toISOString(), by: "founder-1" });
  });

  it("carries an existing answer through later saves", () => {
    const answer = { at: "2026-09-01T00:00:00.000Z", by: "founder-1" };
    const saved = seasonDocumentToStore(
      { seasons: [], cadence: "lunar", timezone: "America/Costa_Rica" },
      AT,
      standing({ timezoneAnswer: answer }),
      "founder-2",
    );
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.doc.timezoneAnswer).toEqual(answer);
  });

  /**
   * THE DROP-ON-READ TRAP, which this file has seen before.
   *
   * `normalizeSeasonConfig` rebuilds the document from a FIXED field list, on
   * read as well as on write, in three branches. That is how `patternId` was
   * silently discarded on every save AND every load (0050), leaving the whole
   * season-pattern system resolving to "no pattern running". An answer lost
   * the same way would ask a village the same question forever.
   */
  it("survives a read in every branch the normaliser rebuilds", () => {
    const answer = { at: "2026-09-01T00:00:00.000Z", by: "founder-1" };
    const withList = normalizeSeasonConfig({
      seasons: [{ id: "s1", name: "First", startsOn: "2026-01-01", endsOn: "2026-04-01" }],
      cadence: "custom",
      timezone: "Europe/Lisbon",
      timezoneAnswer: answer,
    });
    expect(withList.timezoneAnswer).toEqual(answer);

    const derived = normalizeSeasonConfig({
      seasons: [],
      cadence: "solstice-equinox",
      timezone: "Europe/Lisbon",
      timezoneAnswer: answer,
    });
    expect(derived.timezoneAnswer).toEqual(answer);

    // The legacy single-season document, lifted into a list.
    const legacy = normalizeSeasonConfig({
      name: "Founding", startsOn: "2026-01-01", endsOn: "", timezoneAnswer: answer,
    });
    expect(legacy.timezoneAnswer).toEqual(answer);
  });

  it("keeps only the shape it writes, so a hand-edited document cannot smuggle one in", () => {
    expect(normalizeSeasonConfig({ seasons: [], timezoneAnswer: "yes" }).timezoneAnswer).toBeNull();
    expect(normalizeSeasonConfig({ seasons: [], timezoneAnswer: { by: "x" } }).timezoneAnswer).toBeNull();
    expect(
      normalizeSeasonConfig({ seasons: [], timezoneAnswer: { at: "2026-09-01T00:00:00.000Z" } }).timezoneAnswer,
    ).toEqual({ at: "2026-09-01T00:00:00.000Z", by: null });
  });

  it("still refuses a zone this runtime cannot format, answer or no answer", () => {
    const bad = seasonDocumentToStore(
      { seasons: [], timezone: "Bogus/Zone", confirmTimezone: true },
      AT,
      standing(),
      "founder-1",
    );
    expect(bad.ok).toBe(false);
  });
});
