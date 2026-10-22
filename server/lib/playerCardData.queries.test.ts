/**
 * THE PLAYER CARD READS EVERY TABLE ONCE, HOWEVER MANY ROLES A PERSON HOLDS.
 *
 * A stub pool answers each read by the table it names and records every
 * query. A card for someone holding one role and a card for someone holding
 * six must cost the same number of queries, and the signs those roles share
 * must be counted once per cycle, never once per role.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildPlayerCards, clearSignMemo, type CardContext, type CardTier } from "./playerCardData";

const NOW = new Date("2026-10-22T18:00:00Z");

const OFFER = {
  v: 1,
  term: { reviewOn: "2026-11-16" },
  scoreboard: {
    measures: [
      { measure: "Answered within 2 business days", countedBy: "applications-answered", targetCount: 5 },
      { measure: "Times the circle met", countedBy: "circle-met", targetCount: 2 },
    ],
  },
};

function roleRow(i: number) {
  return {
    id: `r${i}`, circle_id: "c1", name: `Role number ${i}`, aim: "An aim.", domain: "A domain.", accountabilities: JSON.stringify(["One thing"]),
    why_it_matters: null, seats: 1, criticality: "normal", active: 1, recruiting: 0, expires_each_season: null, status_override: null,
    status_override_expires_at: null, icon: null, color: null, sort_order: i, is_example: 0, archetypes: null, archetypes_suggested: 0,
    authority: null, first_year_outcomes: null, first_90_day_outcomes: null, location_expectations: null, compensation_reality: null,
    evidence_required: null, represents_circle: 0, how_chosen: null, how_chosen_gloss: null, terms_offer: JSON.stringify(OFFER),
    terms_offer_at: null, terms_offer_by: null, value_minor: null, value_currency: null, value_tokens: null,
  };
}

function seatingRow(i: number) {
  return {
    id: `as${i}`, org_role_id: `r${i}`, holder_kind: "member", user_id: "u-owner", display_name: null, holder_key: "member:u-owner",
    focus: null, note: null, season_id: null, term_ends_at: new Date("2026-12-31T06:00:00Z"), started_at: new Date("2026-10-01T00:00:00Z"),
    ended_at: null, ended_reason: null, is_example: 0, is_agent: 0, application_id: null,
  };
}

function stubPool(roles: number) {
  const queries: string[] = [];
  const answer = (sql: string): any[] => {
    if (/^SELECT id, name FROM users WHERE id IN/.test(sql)) return [{ id: "u-owner", name: "Lena Ortiz" }];
    if (/FROM org_role_assignments WHERE ended_at IS NULL AND org_role_id IN/.test(sql)) return Array.from({ length: roles }, (_, i) => seatingRow(i + 1));
    if (/FROM org_roles WHERE id IN \(SELECT org_role_id/.test(sql) && /terms_offer/.test(sql)) return Array.from({ length: roles }, (_, i) => roleRow(i + 1));
    if (/^SELECT id, name FROM org_roles$/.test(sql)) return Array.from({ length: roles }, (_, i) => ({ id: `r${i + 1}`, name: `Role number ${i + 1}` }));
    if (/FROM circles/.test(sql)) return [{ id: "c1", name: "Land" }];
    if (/FROM users WHERE is_example = 0/.test(sql)) return [{ id: "u-owner", name: "Lena Ortiz", joined_at: new Date("2026-01-01T00:00:00Z") }];
    return [];
  };
  const pool = {
    query: async (sql: string) => {
      queries.push(sql);
      return [answer(sql.trim()), []];
    },
  };
  return { pool: pool as any, queries };
}

/** The statements only the sign counters send. */
const SIGN_SQL =
  /^SELECT (id, status, created_at, decided_at, candidate_user_id FROM seat_applications|id, circle_id, created_at FROM live_sessions|session_id, member_no FROM live_session_people|id, name, joined_at FROM users)/;

const MEMBER: CardTier = { level: "member", seat: { structure: true, people: "member", editing: false, terms: true } };
const CTX: CardContext = {
  now: NOW,
  timeZone: "UTC",
  viewerUserId: "u-reader",
  season: { id: "s1", name: "Season", startsOn: "2026-10-01", endsOn: "2026-12-31" },
  nextSeasonId: null,
  villageName: "Riverbend",
  lapse: { currentSeasonId: "s1", cadence: "never" },
  archetypeNames: {},
  firstName: (n) => n.split(" ")[0] ?? "",
};

beforeEach(() => clearSignMemo());

describe("the player card's query count", () => {
  it("is the same for one role and for six", async () => {
    const one = stubPool(1);
    const six = stubPool(6);
    const a = await buildPlayerCards(one.pool, [{ userId: "u-owner", tier: MEMBER }], CTX);
    clearSignMemo();
    const b = await buildPlayerCards(six.pool, [{ userId: "u-owner", tier: MEMBER }], CTX);
    expect(a.get("u-owner")?.card.roles).toHaveLength(1);
    expect(b.get("u-owner")?.card.roles).toHaveLength(6);
    expect(six.queries.length).toBe(one.queries.length);
    // Each statement once: no read is repeated per role.
    expect(new Set(six.queries).size).toBe(six.queries.length);
  });

  it("counts a sign once per cycle: a second card inside the memo's window reads no sign table", async () => {
    const first = stubPool(6);
    await buildPlayerCards(first.pool, [{ userId: "u-owner", tier: MEMBER }], CTX);
    // The two signs six roles name read three tables and the names, once each.
    expect(first.queries.filter((q) => SIGN_SQL.test(q))).toHaveLength(4);
    const second = stubPool(6);
    await buildPlayerCards(second.pool, [{ userId: "u-owner", tier: MEMBER }], CTX);
    expect(second.queries.filter((q) => SIGN_SQL.test(q))).toEqual([]);
    expect(second.queries.length).toBeLessThan(first.queries.length);
  });

  it("reads no sign table for a stranger, who sees no signs", async () => {
    const s = stubPool(3);
    const stranger: CardTier = { level: "stranger", seat: { structure: true, people: "public", editing: false, terms: false } };
    const out = await buildPlayerCards(s.pool, [{ userId: "u-owner", tier: stranger }], { ...CTX, viewerUserId: null });
    expect(s.queries.filter((q) => SIGN_SQL.test(q))).toEqual([]);
    expect(out.get("u-owner")?.sheets).toEqual({});
  });
});
