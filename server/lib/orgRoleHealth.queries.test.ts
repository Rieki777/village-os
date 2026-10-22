/**
 * `/api/org`'s HEALTH COSTS THE SAME FOR 40 HOLDERS AS FOR ONE.
 *
 * A stub pool answers each read by the table it names and records every
 * query. `orgRoleExtras` must send one IN-list read per table however many
 * holders and roles the page carries, so /roles never pays per holder, and
 * it never asks the card's own reads (`readCardRows`) at all.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { OrgAssignment, OrgRole } from "./orgChart";
import { clearSignMemo } from "./playerCardData";
import { orgRoleExtras } from "./orgRoleHealth";
import type { SeatTier } from "./seatProjection";

const NOW = new Date("2026-10-22T18:00:00Z");
const OFFER = {
  v: 1,
  term: { reviewOn: "2026-11-16" },
  scoreboard: { measures: [{ measure: "Applications answered", countedBy: "applications-answered", targetCount: 3 }] },
};

const role = (i: number): OrgRole =>
  ({
    id: `r${i}`,
    name: `Role number ${i}`,
    circleId: "c1",
    active: true,
    seats: 2,
    termsOffer: OFFER,
  }) as unknown as OrgRole;

const seating = (i: number, roleCount: number): OrgAssignment =>
  ({
    id: `as${i}`,
    orgRoleId: `r${(i % roleCount) + 1}`,
    holderKind: "member",
    userId: `u${i}`,
    displayName: null,
    holderKey: `member:u${i}`,
    termEndsAt: new Date("2026-12-31T06:00:00Z"),
    startedAt: new Date("2026-10-01T00:00:00Z"),
    endedAt: null,
    isExample: false,
    applicationId: `sa-${i}`,
  }) as unknown as OrgAssignment;

function stubPool() {
  const queries: string[] = [];
  const pool = {
    query: async (sql: string, args: unknown[] = []) => {
      queries.push(sql);
      if (/^SELECT id, handle FROM users/.test(sql)) return [(args as string[]).map((id) => ({ id, handle: `h-${id}` })), []];
      if (/FROM live_session_entries WHERE kind = 'tension'/.test(sql)) return [[{ owner_seat_id: "r1", n: 2 }], []];
      return [[], []];
    },
  };
  return { pool: pool as any, queries };
}

const MEMBER: SeatTier = { structure: true, people: "member", editing: false, terms: true };
const CTX = { now: NOW, timeZone: "UTC", seasonId: "s1" };

async function run(holders: number, roles: number, tier = MEMBER) {
  clearSignMemo();
  const { pool, queries } = stubPool();
  const out = await orgRoleExtras(
    pool,
    Array.from({ length: roles }, (_, i) => role(i + 1)),
    Array.from({ length: holders }, (_, i) => seating(i, roles)),
    tier,
    CTX,
  );
  return { out, queries };
}

beforeEach(() => clearSignMemo());

describe("orgRoleExtras reads each table once", () => {
  it("40 holders across 40 roles cost the same queries as one holder on one role", async () => {
    const one = await run(1, 1);
    const forty = await run(40, 40);
    expect(forty.queries.length).toBe(one.queries.length);
    // One IN-list read per table: never two against the same one. (The sign
    // counters' village-wide reads are separate statements, memoised per cycle.)
    const inLists = forty.queries.filter((q) => / IN \(\?/.test(q)).map((q) => /FROM (\w+)/.exec(q)?.[1]);
    expect(inLists.sort()).toEqual(["live_session_entries", "seat_applications", "users"]);
    expect(new Set(forty.queries).size).toBe(forty.queries.length);
    // And never the card's own per-person reads.
    expect(forty.queries.some((q) => /season_plans|org_draft_changes|live_session_task_state/.test(q))).toBe(false);
    expect(forty.out.health?.size).toBe(40);
  });

  it("forty holders on two roles still cost the same", async () => {
    const one = await run(1, 1);
    const crowded = await run(40, 2);
    expect(crowded.queries.length).toBe(one.queries.length);
  });

  it("gives every role three facts, a dot and its open tensions, and every member holder a handle", async () => {
    const { out } = await run(4, 2);
    const h = out.health!.get("r1")!;
    expect(h.facts.map((f) => f.key)).toEqual(["term", "review", "signs"]);
    expect(h.dotWords).toBeTruthy();
    expect(h.openTensions).toBe(2);
    expect(out.health!.get("r2")!.openTensions).toBe(0);
    expect(out.handleOf!("u1")).toBe("h-u1");
  });

  it("below terms.read: the term fact only, no tension count, and no handles below the member tier", async () => {
    const { out, queries } = await run(4, 2, { structure: true, people: "public", editing: false, terms: false });
    const h = out.health!.get("r1")!;
    expect(h.facts.map((f) => f.key)).toEqual(["term"]);
    expect(h).not.toHaveProperty("openTensions");
    expect(out.handleOf).toBeUndefined();
    expect(queries.some((q) => /handle|settings_json|tension/.test(q))).toBe(false);
  });

  it("a stranger the map shows no structure to gets no health at all", async () => {
    const { out } = await run(4, 2, { structure: false, people: "none", editing: false, terms: false });
    expect(out.health).toBeUndefined();
  });

  it("a role nobody holds has no health", async () => {
    const { out } = await run(1, 3);
    expect(out.health!.get("r2")).toBeNull();
  });
});
