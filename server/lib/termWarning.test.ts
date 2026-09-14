/**
 * THE TERM WARNING ARRIVES ONE CYCLE AHEAD, measured on the village's clock.
 *
 * Rye, 2026-09-14: warn a holder one lunar cycle before their term ends. The
 * job used to warn 14 days out on both planes, a literal nobody could tune and
 * half the time a village needs to run a seat vote.
 *
 * No database: the watch reads holdings through a pool, and a pool that
 * returns rows is all it needs. The rows it returns deliberately include ones
 * the horizon would have excluded, so the assertion is about the due check
 * and not about the query happening to be narrow.
 */
import { describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";
import { CALENDAR_CLOCK, LUNAR_CLOCK, type CycleClock } from "../../shared/cycleClock";
import {
  runTermWatch,
  termEndsAtFromCycles,
  termWarningDue,
  termWarningOpensAt,
  termWatchHorizon,
  termWatchLookaheadDays,
} from "./stewardship";

const DAY = 86_400_000;
const at = (iso: string) => new Date(iso);

describe("when the warning opens, on the lunar clock", () => {
  it("opens at the new moon before a term that ends on a new moon", () => {
    const ends = termEndsAtFromCycles(3, at("2026-09-14T12:00:00Z"));
    const opens = termWarningOpensAt(ends, LUNAR_CLOCK);
    const previous = LUNAR_CLOCK.startOf(LUNAR_CLOCK.cycleNumberAt(ends) - 1);
    expect(Math.abs(opens.getTime() - previous.getTime())).toBeLessThanOrEqual(1);
    // One lunation, whatever its length that month. Never a flat 14 or 30.
    const lead = (ends.getTime() - opens.getTime()) / DAY;
    expect(lead).toBeGreaterThan(29.2);
    expect(lead).toBeLessThan(29.9);
  });

  it("is due from that instant and not a minute before", () => {
    const ends = termEndsAtFromCycles(2, at("2026-10-02T00:00:00Z"));
    const opens = termWarningOpensAt(ends, LUNAR_CLOCK);
    expect(termWarningDue(ends, new Date(opens.getTime() - 60_000), LUNAR_CLOCK)).toBe(false);
    expect(termWarningDue(ends, new Date(opens.getTime() + 60_000), LUNAR_CLOCK)).toBe(true);
  });

  it("warns a term 20 days out, which the old 14-day window stayed silent on", () => {
    const ends = termEndsAtFromCycles(3, at("2026-09-14T12:00:00Z"));
    expect(termWarningDue(ends, new Date(ends.getTime() - 20 * DAY), LUNAR_CLOCK)).toBe(true);
    expect(termWarningDue(ends, new Date(ends.getTime() - 35 * DAY), LUNAR_CLOCK)).toBe(false);
  });
});

describe("when the warning opens, on the calendar clock", () => {
  it("opens on the first of the month before a term that ends on the first", () => {
    expect(termWarningOpensAt(at("2026-03-01T00:00:00Z"), CALENDAR_CLOCK).toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("keeps a typed date's place in its month", () => {
    expect(termWarningOpensAt(at("2026-03-15T12:00:00Z"), CALENDAR_CLOCK).toISOString()).toBe("2026-02-15T12:00:00.000Z");
  });

  it("opens at the start of the term's own month when the month before is too short", () => {
    // There is no 31st of February. The start of March is still more than a
    // whole February before the 31st of March.
    expect(termWarningOpensAt(at("2026-03-31T00:00:00Z"), CALENDAR_CLOCK).toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("the horizon the watch queries", () => {
  it("never leaves out a term whose warning is due, on either clock", () => {
    const clocks: CycleClock[] = [LUNAR_CLOCK, CALENDAR_CLOCK];
    let dueSeen = 0;
    for (const clock of clocks) {
      for (let d = 0; d < 400; d += 1) {
        const now = new Date(Date.UTC(2026, 0, 1) + d * DAY + 7 * 3_600_000);
        const horizon = termWatchHorizon(now, clock);
        const c = clock.cycleNumberAt(now);
        // Terms on the next four boundaries, and a typed date inside each.
        for (let k = 1; k <= 4; k += 1) {
          const boundary = clock.startOf(c + k);
          for (const ends of [new Date(Math.ceil(boundary.getTime())), new Date(boundary.getTime() + 10 * DAY)]) {
            if (!termWarningDue(ends, now, clock)) continue;
            dueSeen += 1;
            expect(ends.getTime(), `${clock.mode} ${now.toISOString()} ${ends.toISOString()}`).toBeLessThanOrEqual(horizon.getTime());
          }
        }
      }
    }
    // A control: a property that held over zero cases would prove nothing.
    expect(dueSeen).toBeGreaterThan(300);
  });

  it("gives the seatings query a day count at least as long as the horizon", () => {
    const now = at("2026-09-14T12:00:00Z");
    const days = termWatchLookaheadDays(now, LUNAR_CLOCK);
    expect(now.getTime() + days * DAY).toBeGreaterThanOrEqual(termWatchHorizon(now, LUNAR_CLOCK).getTime());
    expect(days).toBeGreaterThan(14);
  });
});

describe("the watch itself, both planes", () => {
  const now = at("2026-09-14T00:00:00Z");
  const holdingRow = (id: string, ends: string) => ({
    id,
    role_id: "steward",
    user_id: `u-${id}`,
    term_ends_at: at(ends),
    role_name: "Steward",
  });

  it("tells a holder one cycle ahead, once per holding, and names the renewal", async () => {
    const cutoffs: unknown[] = [];
    const pool = {
      query: async (_sql: string, params: unknown[]) => {
        cutoffs.push(params[0]);
        return [[
          holdingRow("soon", "2026-10-01T00:00:00Z"), // 17 days out, warning opened 1 September
          holdingRow("later", "2026-11-01T00:00:00Z"), // warning opens 1 October
          holdingRow("gone", "2026-09-12T00:00:00Z"), // already ended
        ]];
      },
    } as unknown as Pool;
    const told: Array<{ userId: string; key: string; title: string; body: string; link: string }> = [];

    const r = await runTermWatch({
      pool,
      clock: CALENDAR_CLOCK,
      now,
      season: { current: { id: "s-1" } },
      seatings: [
        { id: "as-soon", holderKind: "member", userId: "m-soon", roleName: "Host", daysLeft: 17, termEndsAt: at("2026-10-01T00:00:00Z") },
        { id: "as-later", holderKind: "member", userId: "m-later", roleName: "Host", daysLeft: 48, termEndsAt: at("2026-11-01T00:00:00Z") },
        { id: "as-lapsed", holderKind: "member", userId: "m-lapsed", roleName: "Host", daysLeft: null, lapsed: true },
        { id: "as-undated", holderKind: "member", userId: "m-undated", roleName: "Host", daysLeft: null },
        { id: "as-agent", holderKind: "agent", userId: null, roleName: "Host", daysLeft: 17, termEndsAt: at("2026-10-01T00:00:00Z") },
      ],
      notify: async (n) => {
        told.push({ userId: n.userId, key: n.dedupeKey, title: n.title, body: String(n.body), link: String(n.link) });
        return { fresh: true };
      },
      notifyAdmins: async () => {
        throw new Error("a running season is not loud");
      },
    });

    expect(cutoffs[0], "the query is bounded by the clock's horizon").toEqual(termWatchHorizon(now, CALENDAR_CLOCK));
    expect(told.map((t) => t.key).sort()).toEqual([
      "perm-term-ended:gone",
      "perm-term-soon:soon",
      "term-ended:as-lapsed",
      "term-soon:as-soon",
    ]);
    expect(r.holdersTold).toBe(4);
    expect(r.lapsed).toBe(1);

    const perm = told.find((t) => t.key === "perm-term-soon:soon")!;
    expect(perm.title).toContain("17 day(s)");
    // Never extended automatically, and no limit on repeat terms: both said.
    expect(perm.body).toContain("Nothing renews on its own");
    expect(perm.body).toContain("no limit on terms");
    expect(told.find((t) => t.key === "term-soon:as-soon")!.body).toContain("no limit on terms");
    // No client screen opens a seat vote yet, so the link stays on the roles page.
    expect(told.every((t) => t.link === "/roles")).toBe(true);
  });

  it("points the stopped-calendar notice at an admin tab that exists", async () => {
    const links: string[] = [];
    await runTermWatch({
      pool: { query: async () => [[]] } as unknown as Pool,
      clock: LUNAR_CLOCK,
      now,
      season: { current: null },
      seatings: [],
      notify: async () => ({ fresh: true }),
      notifyAdmins: async (_type, _title, _key, link) => {
        links.push(String(link));
      },
    });
    expect(links).toEqual(["/admin?tab=season"]);
  });
});
