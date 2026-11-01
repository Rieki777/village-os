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
    // 0274: the CCOS words ride the same row, so they cost no read of their own.
    exists_while: "people are still arriving", authorities: JSON.stringify(["Invite to a role"]),
    responsibilities: JSON.stringify(["Run onboarding calls"]), signs_stretched: "Applications waiting",
    flows_back: null, step_back: "Name it on Friday.", time_commitment: "Part of a full-time season",
  };
}

function seatingRow(i: number) {
  return {
    id: `as${i}`, org_role_id: `r${i}`, holder_kind: "member", user_id: "u-owner", display_name: null, holder_key: "member:u-owner",
    focus: null, note: null, season_id: null, term_ends_at: new Date("2026-12-31T06:00:00Z"), started_at: new Date("2026-10-01T00:00:00Z"),
    ended_at: null, ended_reason: null, is_example: 0, is_agent: 0, application_id: null,
  };
}

/** Every person the batch test asks about. */
const PEOPLE = ["u-owner", "u-two", "u-three"];

function stubPool(roles: number) {
  const queries: string[] = [];
  const answer = (sql: string): any[] => {
    if (/^SELECT id, name FROM users WHERE id IN/.test(sql)) return PEOPLE.map((id) => ({ id, name: id === "u-owner" ? "Lena Ortiz" : "Sam Reed" }));
    // Member numbers, accepted tasks and their events: what accomplishments read.
    if (/FROM `live_session_members` WHERE `user_id` IN/.test(sql)) return [...PEOPLE, "u-reader"].map((user_id, i) => ({ user_id, no: i + 1 }));
    if (/`t`.`latest_kind` = 'accepted'/.test(sql)) {
      return PEOPLE.map((_, i) => ({ entry_id: 100 + i, session_id: 9, circle_id: "c1", status: "done", latest_kind: "accepted", owner_no: i + 1, owner_seat_id: null, text: "A task" }));
    }
    if (/FROM `live_session_task_events` WHERE `entry_id` IN/.test(sql)) {
      return PEOPLE.flatMap((_, i) => [
        { id: 2 * i + 1, entry_id: 100 + i, kind: "done", by_no: i + 1, owner_no: i + 1, owner_seat_id: null, note: null, created_at: new Date("2026-10-15T12:00:00Z") },
        { id: 2 * i + 2, entry_id: 100 + i, kind: "accepted", by_no: 9, owner_no: i + 1, owner_seat_id: null, note: "Good work.", created_at: new Date("2026-10-16T12:00:00Z") },
      ]);
    }
    if (/FROM season_plans WHERE user_id IN \(\?\) AND card_words_json/.test(sql)) return [{ user_id: "u-owner", card_words_json: JSON.stringify({ growingEdge: "Saying no." }) }];
    if (/FROM player_moon_load WHERE user_id IN/.test(sql)) return [{ user_id: "u-owner", cycle_id: "m1", level: 4, set_at: new Date("2026-10-20T12:00:00Z") }];
    if (/FROM org_role_assignments WHERE ended_at IS NULL AND org_role_id IN/.test(sql)) return Array.from({ length: roles }, (_, i) => seatingRow(i + 1));
    if (/FROM org_roles WHERE id IN \(SELECT org_role_id/.test(sql) && /terms_offer/.test(sql)) return Array.from({ length: roles }, (_, i) => roleRow(i + 1));
    if (/^SELECT id, name FROM org_roles$/.test(sql)) return Array.from({ length: roles }, (_, i) => ({ id: `r${i + 1}`, name: `Role number ${i + 1}` }));
    if (/FROM circles/.test(sql)) return [{ id: "c1", name: "Land" }];
    // role_tensions (0269): one open tension with every role, raised by somebody else.
    if (/FROM `role_tensions` WHERE `org_role_id` IN/.test(sql)) {
      return Array.from({ length: roles }, (_, i) => ({
        id: `rt-${i + 1}`, org_role_id: `r${i + 1}`, raised_by: "u-raiser", text: "Private words", status: "open",
        answer_note: null, answered_by: null, circle_entry_id: null, created_s: 1760000000, answered_s: null,
      }));
    }
    if (/SELECT DISTINCT `org_role_id`, `user_id` FROM `org_role_assignments`/.test(sql)) {
      return Array.from({ length: roles }, (_, i) => ({ org_role_id: `r${i + 1}`, user_id: "u-owner" }));
    }
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
  moonId: "m1",
  viewerMember: true,
};

const TENSION_SQL = /FROM `role_tensions`/;
const HOLDINGS_SQL = /SELECT DISTINCT `org_role_id`, `user_id` FROM `org_role_assignments`/;

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

  it("carries the CCOS words (0274) off the one role read, for one role or six", async () => {
    const one = stubPool(1);
    const six = stubPool(6);
    const a = await buildPlayerCards(one.pool, [{ userId: "u-owner", tier: MEMBER }], CTX);
    clearSignMemo();
    const b = await buildPlayerCards(six.pool, [{ userId: "u-owner", tier: MEMBER }], CTX);
    for (const r of b.get("u-owner")!.card.roles) {
      expect(r.existsWhile.text).toEqual({ kind: "shown", value: "people are still arriving" });
      expect(r.authorities.items).toEqual({ kind: "shown", value: ["Invite to a role"] });
      expect(r.holdingWell.written).toBe(true);
      expect(r.time.text).toEqual({ kind: "shown", value: "Part of a full-time season" });
      expect(r.chips).toContain("Review week of 16 Nov");
    }
    expect(a.get("u-owner")!.card.roles[0].responsibilities.items.kind).toBe("shown");
    expect(six.queries.length).toBe(one.queries.length);
    // The CCOS columns arrive on the role reads that already ran (ROLE_COLS),
    // never on a read of their own: as many of those for six roles as for one,
    // and each one a whole role read.
    const ccosReads = (qs: string[]) => qs.filter((q) => /exists_while/.test(q));
    expect(ccosReads(six.queries).length).toBe(ccosReads(one.queries).length);
    expect(ccosReads(six.queries).every((q) => /terms_offer/.test(q) && /FROM org_roles/.test(q))).toBe(true);
    expect(new Set(ccosReads(six.queries)).size).toBe(ccosReads(six.queries).length);
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

  it("is the same for one person and for three: accomplishments, card words and the load are read once for the batch", async () => {
    const one = stubPool(2);
    const three = stubPool(2);
    const a = await buildPlayerCards(one.pool, [{ userId: "u-owner", tier: MEMBER }], CTX);
    clearSignMemo();
    const b = await buildPlayerCards(three.pool, PEOPLE.map((userId) => ({ userId, tier: MEMBER })), CTX);
    expect(b.size).toBe(3);
    expect(three.queries.length).toBe(one.queries.length);
    const once = (re: RegExp) => three.queries.filter((q) => re.test(q)).length;
    expect(once(/FROM `live_session_members` WHERE `user_id` IN/)).toBe(1);
    expect(once(/`latest_kind` = 'accepted'/)).toBe(1);
    expect(once(/FROM `live_session_task_events` WHERE `entry_id` IN/)).toBe(1);
    expect(once(/card_words_json IS NOT NULL/)).toBe(1);
    expect(once(/FROM player_moon_load/)).toBe(1);
    expect(once(/WHERE e.kind = 'decision' AND e.status = 'done' AND e.created_at >= \?/)).toBe(1);
    // And the rows reached the card.
    const card = a.get("u-owner")!.card;
    expect(card.accomplished.moons.kind).not.toBe("unread");
    // An admin reads every one, by accomplishmentsOf's rule.
    clearSignMemo();
    const asAdmin = await buildPlayerCards(stubPool(2).pool, [{ userId: "u-owner", tier: MEMBER }], { ...CTX, viewerAdmin: true });
    const moons = asAdmin.get("u-owner")!.card.accomplished.moons;
    expect(moons.kind === "shown" && moons.value.flatMap((m) => m.items.map((i) => [i.title, i.note]))).toEqual([["A task", "Good work."]]);
    expect(card.across.growingEdge.text).toEqual({ kind: "shown", value: "Saying no." });
    expect(card.across.load.own).toEqual({ kind: "shown", value: { step: 4, words: "Leaning heavy" } });
  });

  it("reads the tensions once for the batch, for one role, six roles or three people (PR 9)", async () => {
    const one = stubPool(1);
    const six = stubPool(6);
    await buildPlayerCards(one.pool, [{ userId: "u-owner", tier: MEMBER }], CTX);
    clearSignMemo();
    const b = await buildPlayerCards(six.pool, [{ userId: "u-owner", tier: MEMBER }], CTX);
    for (const s of [one, six]) {
      expect(s.queries.filter((q) => TENSION_SQL.test(q))).toHaveLength(1);
      expect(s.queries.filter((q) => HOLDINGS_SQL.test(q))).toHaveLength(1);
    }
    clearSignMemo();
    const three = stubPool(2);
    await buildPlayerCards(three.pool, PEOPLE.map((userId) => ({ userId, tier: MEMBER })), CTX);
    expect(three.queries.filter((q) => TENSION_SQL.test(q))).toHaveLength(1);
    // The rows reached every role, as a count with the words withheld from this reader.
    const roles = b.get("u-owner")!.card.roles;
    expect(roles).toHaveLength(6);
    for (const r of roles) {
      expect(r.tensions).toMatchObject({ kind: "shown", value: { counts: ["1 open tension, private to the role's holders"], open: [] } });
      expect(r.tensionDoor).toBe("raise");
    }
    expect(JSON.stringify(roles)).not.toContain("Private words");
    // The old session-entry tension read is gone.
    expect(six.queries.some((q) => /e.kind = 'tension'/.test(q))).toBe(false);
  });

  it("a reader who is not a member reads no tensions: no query, and every role unread", async () => {
    const s = stubPool(3);
    const out = await buildPlayerCards(s.pool, [{ userId: "u-owner", tier: MEMBER }], { ...CTX, viewerMember: false });
    expect(s.queries.filter((q) => TENSION_SQL.test(q))).toEqual([]);
    for (const r of out.get("u-owner")!.card.roles) {
      expect(r.tensions).toEqual({ kind: "unread" });
      expect(r.tensionDoor).toBeNull();
    }
  });

  it("reads no sign table for a stranger, who sees no signs", async () => {
    const s = stubPool(3);
    const stranger: CardTier = { level: "stranger", seat: { structure: true, people: "public", editing: false, terms: false } };
    const out = await buildPlayerCards(s.pool, [{ userId: "u-owner", tier: stranger }], { ...CTX, viewerUserId: null });
    expect(s.queries.filter((q) => SIGN_SQL.test(q))).toEqual([]);
    expect(out.get("u-owner")?.sheets).toEqual({});
  });
});
