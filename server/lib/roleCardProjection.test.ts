/**
 * THE FULL CARD IN THE PROJECTION (role journey PR-C). The public pay range
 * reaches a visitor, a guest and a member, and NOTHING ELSE from the terms on
 * offer reaches a visitor or a guest: pinned on exact key lists at each tier,
 * and on a planted word that sits in a group a visitor must never read.
 * Every absence carries a positive control: the same fixture at the tier that
 * does carry the key.
 */
import { describe, expect, it } from "vitest";
import { PUBLIC_PAY_KEYS } from "../../shared/rolePublicPay";
import type { OrgAssignment, OrgRole } from "./orgChart";
import { orgSeatTier, projectSeat, type SeatProjectionCtx } from "./seatProjection";
import { gateOf } from "./roleCardProjection";

const NOW = new Date("2026-10-01T12:00:00Z");
const PLANTED = "PLANTED-ALLOWANCE-NOTE";
const OFFER = {
  v: 1,
  term: { endsOn: null, noticeDays: 14 },
  clocks: { pay: "calendar-month" },
  pay: { kind: "range", currency: "USD", minMinor: 200000, maxMinor: 300000, per: "month", note: "Depends on funding" },
  allowance: { kind: "flat", currency: "USD", amountMinor: 5000, per: "month", note: PLANTED },
};

const role = (over: Partial<OrgRole> = {}): OrgRole =>
  ({
    id: "lead-financial-steward", circleId: "anchor", name: "Lead Financial Steward", aim: "Keep money true.",
    domain: "The books", accountabilities: ["Close each moon"], whyItMatters: null, seats: 1, criticality: "normal",
    active: true, recruiting: false, expiresEachSeason: null, statusOverride: null, statusOverrideExpiresAt: null,
    icon: null, color: null, order: 0, isExample: false, archetypes: [], authority: null, firstYearOutcomes: null,
    first90DayOutcomes: null, locationExpectations: null, compensationReality: null, evidenceRequired: null,
    representsCircle: false, howChosen: null, howChosenGloss: null,
    termsOffer: OFFER as unknown as string, termsOfferAt: null, termsOfferBy: null, listed: null,
    timeCommitment: "40 hours a week", track: "paid", villageGoals: ["Fund the land"], selectionCriteria: ["Careful"],
    interviewerRoles: [{ roleId: "visionary", minutes: 60 }, { roleId: "x", minutes: 20, final: true }],
    whereWorked: "both", languages: ["English"], budgetLine: "Finance", fundedFrom: "2026-12-01", reviewAfterDays: 90,
    accessBundle: ["Bank view"], bookingUrl: "https://cal.example/first",
    ...over,
  }) as OrgRole;

const ctx: SeatProjectionCtx = { route: "org", now: NOW, nameOf: () => "Mara", firstName: (s) => s, roleNames: new Map([["visionary", "Visionary Channel"]]) };
const base = { editing: false, viewPeople: false, peopleArePublic: true, mapStructure: false } as const;
const VISITOR = orgSeatTier({ ...base });
const GUEST = orgSeatTier({ ...base, mapStructure: true });
const MEMBER = orgSeatTier({ ...base, viewPeople: true, mapStructure: true, terms: true });
const EDITOR = orgSeatTier({ ...base, viewPeople: true, mapStructure: true, terms: true, editing: true });
const held: OrgAssignment[] = [];
const seat = (r: OrgRole, tier: ReturnType<typeof orgSeatTier>) => projectSeat(r, held, tier, ctx);
const card = (r: OrgRole, tier: ReturnType<typeof orgSeatTier>) => seat(r, tier).card as Record<string, any>;
const sorted = (o: object) => Object.keys(o).sort();

const PUBLIC_CARD_KEYS = [
  "complete", "missing", "written", "of", "gated", "track", "villageGoals", "selectionCriteria", "interviews",
  "whereWorked", "languages", "reviewAfterDays", "publicPay",
].sort();

describe("the public pay range", () => {
  it("is exactly the pay group's public keys, at the visitor, guest and member tiers", () => {
    for (const tier of [VISITOR, GUEST, MEMBER]) {
      const pay = card(role(), tier).publicPay;
      expect(sorted(pay)).toEqual(["currency", "kind", "maxMinor", "minMinor", "note", "per"]);
      for (const k of Object.keys(pay)) expect((PUBLIC_PAY_KEYS as readonly string[]).includes(k)).toBe(true);
      expect(pay.minMinor).toBe(200000);
    }
  });

  it("leaves every other terms key at terms.read: a visitor and a guest read none of it", () => {
    for (const tier of [VISITOR, GUEST]) {
      const s = seat(role(), tier);
      expect(s).not.toHaveProperty("termsOffer");
      expect(s).not.toHaveProperty("pay");
      expect(s).not.toHaveProperty("termsOfferAt");
      const text = JSON.stringify(s);
      expect(text).not.toContain(PLANTED);
      expect(text).not.toContain("noticeDays");
      expect(text).not.toContain("calendar-month");
      // The card carries the public keys and nothing a terms reader alone gets.
      expect(sorted(card(role(), tier))).toEqual(PUBLIC_CARD_KEYS);
    }
  });

  it("control: the member tier reads the same offer in full, planted note and all", () => {
    const s = seat(role(), MEMBER);
    expect(s).toHaveProperty("termsOffer");
    expect(JSON.stringify(s)).toContain(PLANTED);
    expect(sorted(card(role(), MEMBER))).toEqual([...PUBLIC_CARD_KEYS, "budgetLine", "fundedFrom"].sort());
  });

  it("keeps the budget line, the access bundle and the booking link above the public tiers", () => {
    expect(card(role(), VISITOR)).not.toHaveProperty("budgetLine");
    expect(card(role(), VISITOR)).not.toHaveProperty("accessBundle");
    expect(card(role(), VISITOR)).not.toHaveProperty("bookingUrl");
    const editor = card(role(), EDITOR);
    expect(editor.accessBundle).toEqual(["Bank view"]);
    expect(editor.bookingUrl).toBe("https://cal.example/first");
  });

  it("is sent for a listed open role only", () => {
    expect(card(role(), VISITOR)).toHaveProperty("publicPay");
    // A filled role invites nobody, so its range is not offered (control: the open one above carries it).
    const filled = projectSeat(role(), [{ id: "a", orgRoleId: "lead-financial-steward", holderKind: "member", userId: "u", displayName: null, holderKey: "member:u", focus: null, note: null, seasonId: null, termEndsAt: null, startedAt: NOW, endedAt: null, endedReason: null, lapsed: false, lapsedReason: null, isExample: false, isAgent: false } as OrgAssignment], VISITOR, ctx);
    expect((filled.card as object)).not.toHaveProperty("publicPay");
    // An unlisted role is hidden by the list, and sends no range even if asked directly.
    expect(card(role({ listed: false }), VISITOR)).not.toHaveProperty("publicPay");
  });

  it("is absent when the offer writes no pay", () => {
    expect(card(role({ termsOffer: { v: 1, term: { endsOn: null } } as unknown as string }), VISITOR)).not.toHaveProperty("publicPay");
  });
});

describe("the card's parameters", () => {
  it("names the interviewing roles in order, with their lengths and the final approval", () => {
    const steps = card(role(), VISITOR).interviews;
    expect(steps).toEqual([
      { roleId: "visionary", minutes: 60, roleName: "Visionary Channel" },
      { roleId: "x", minutes: 20, final: true, roleName: null },
    ]);
  });

  it("gates on the village setting only: the gate is always computed, and held back only when asked", () => {
    const incomplete = role({ aim: null });
    expect(card(incomplete, VISITOR)).toMatchObject({ complete: false, missing: ["aim"], gated: false });
    expect(gateOf(incomplete).gate.complete).toBe(false);
    expect(gateOf(role()).gate.complete).toBe(true);
    const gatedSeat = projectSeat(incomplete, held, VISITOR, { ...ctx, cardGate: true });
    expect((gatedSeat.card as any).gated).toBe(true);
  });
});
