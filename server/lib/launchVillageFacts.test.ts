/**
 * THE TWO FACTS ONLY A VILLAGE CAN STATE, resolved from what it stored.
 *
 * These moved out of `server/index.ts` deliberately: that file sits at exactly
 * its line baseline, and the gate's own message is that the one big file may
 * only ever get smaller. The checks read two stored documents and need none of
 * that file's caches, which is the same reasoning the `decide:` branch beside
 * them already records.
 *
 * No database. The resolver takes a pool, so a stub that answers one row is
 * enough to see which document it read and what it made of it.
 */
import { describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";
import { villageFactFor } from "./launch";

/** A pool that answers `app_config` reads from a map, and records the keys. */
const poolWith = (docs: Record<string, unknown>) => {
  const asked: string[] = [];
  const pool = {
    query: async (_sql: string, args: unknown[]) => {
      const key = String(args?.[0]);
      asked.push(key);
      return key in docs ? [[{ value: JSON.stringify(docs[key]) }], []] : [[], []];
    },
  } as unknown as Pool;
  return { pool, asked };
};

describe("villageFactFor", () => {
  it("reads the timezone from the season document, and says which zone", async () => {
    const { pool, asked } = poolWith({ season: { timezone: "Pacific/Auckland", seasons: [] } });
    const answer = await villageFactFor(pool, "timezone");
    expect(asked).toEqual(["season"]);
    expect(answer.state).toBe("missing");
    expect(answer.detail).toContain("Pacific/Auckland");
  });

  it("counts a stored zone as unanswered, because the tab writes it back on any save", async () => {
    // The Season tab is handed the NORMALISED document, so the platform's zone
    // is in the form before anybody looks at it. Only the answer says a human
    // did, which is the whole reason that field exists.
    const { pool } = poolWith({ season: { timezone: "America/Costa_Rica", seasons: [] } });
    expect((await villageFactFor(pool, "timezone")).state).toBe("missing");
  });

  it("counts the zone as answered once somebody has confirmed it", async () => {
    const { pool } = poolWith({
      season: { timezone: "America/Costa_Rica", seasons: [], timezoneAnswer: { at: "2026-09-24T00:00:00.000Z", by: "founder-1" } },
    });
    const answer = await villageFactFor(pool, "timezone");
    expect(answer.state).toBe("ok");
    expect(answer.detail).toContain("America/Costa_Rica");
  });

  it("reads the currency from the brand document, and a stored code is the answer", async () => {
    const { pool, asked } = poolWith({ brand: { project: { fiatCurrency: "CRC" } } });
    const answer = await villageFactFor(pool, "currency");
    expect(asked).toEqual(["brand"]);
    expect(answer.state).toBe("ok");
    // CRC has no daily rate, and that is not this question: Rye's ruling is
    // flagged, never blocked, so an unconvertible currency is still an answer.
    expect(answer.detail).toContain("CRC");
  });

  it("counts blank and whitespace as unanswered, because blank means inherit", async () => {
    for (const fiatCurrency of ["", "   "]) {
      const { pool } = poolWith({ brand: { project: { fiatCurrency } } });
      expect((await villageFactFor(pool, "currency")).state).toBe("missing");
    }
  });

  it("reads a village that has stored nothing at all as unanswered, not as an error", async () => {
    // A fresh fork has no row for either document. That is the normal case on
    // day one and it must not throw on the launch page.
    const { pool } = poolWith({});
    expect((await villageFactFor(pool, "timezone")).state).toBe("missing");
    expect((await villageFactFor(pool, "currency")).state).toBe("missing");
  });

  it("says a missing resolver is a platform bug rather than answering for it", async () => {
    const { pool } = poolWith({});
    const answer = await villageFactFor(pool, "elevation");
    expect(answer.state).toBe("missing");
    expect(answer.detail).toContain("platform bug");
  });
});
