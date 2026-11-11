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
    conversations: [{ roleId: "human-ops", minutes: 60 }, { roleId: "visionary", minutes: 20, final: true }],
    whereWorked: "both", languages: ["English"], budgetLine: "Finance", fundedFrom: "2026-12-01", reviewAfterDays: 90,
    accessBundle: ["Bank view"], bookingUrl: "https://cal.example/first",
    ...over,
  }) as OrgRole;

const ctx: SeatProjectionCtx = { route: "org", now: NOW, nameOf: () => "Mara", firstName: (s) => s, roleNames: new Map([["visionary", "Visionary Channel"]]), cardWords: { firstConversationRole: "Human Operations & Onboarding Lead Steward", paidConsentCircle: "Anchor Circle", showPayRanges: true } };
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
  "complete", "missing", "written", "of", "gated", "track", "villageGoals", "selectionCriteria", "conversations", "conversationMode", "firstConversation",
  "whereWorked", "languages", "reviewAfterDays", "publicPay", "alwaysChecked", "commitmentPct",
  // 0374: who may hold it, public at every tier like the rest of the card.
  "heldBy", "agentMayHold",
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
      // The consenting circle is named for a paid role, in the village's setting words.
      expect(sorted(card(role(), tier))).toEqual([...PUBLIC_CARD_KEYS, "consentCircle"].sort());
    }
  });

  it("control: the member tier reads the same offer in full, planted note and all", () => {
    const s = seat(role(), MEMBER);
    expect(s).toHaveProperty("termsOffer");
    expect(JSON.stringify(s)).toContain(PLANTED);
    expect(sorted(card(role(), MEMBER))).toEqual([...PUBLIC_CARD_KEYS, "consentCircle", "budgetLine", "fundedFrom"].sort());
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

  // Phase A (lead, 11 Nov): ranges stay hidden whatever the role data holds. The village setting
  // `org.show_pay_ranges` ships off, and a card built without saying reads that setting.
  it("is never sent while the village keeps ranges hidden, its default (control: the same role with ranges shown carries it)", () => {
    const hidden = { ...ctx, cardWords: { ...ctx.cardWords, showPayRanges: undefined } };
    for (const tier of [VISITOR, GUEST, MEMBER]) {
      const c = projectSeat(role(), held, tier, hidden).card as Record<string, any>;
      expect(c).not.toHaveProperty("publicPay");
      expect(JSON.stringify(c)).not.toContain("300000");
    }
    expect(projectSeat(role(), held, VISITOR, { ...ctx, cardWords: { ...ctx.cardWords, showPayRanges: false } }).card).not.toHaveProperty("publicPay");
    expect(card(role(), VISITOR)).toHaveProperty("publicPay");
  });

  it("is absent when the offer writes no pay", () => {
    expect(card(role({ termsOffer: { v: 1, term: { endsOn: null } } as unknown as string }), VISITOR)).not.toHaveProperty("publicPay");
  });
});

describe("the card's parameters", () => {
  it("names the interviewing roles in order, with their lengths and the final approval", () => {
    const steps = card(role(), VISITOR).conversations;
    expect(steps).toEqual([
      { roleId: "human-ops", minutes: 60, roleName: null },
      { roleId: "visionary", minutes: 20, final: true, roleName: "Visionary Channel" },
    ]);
    expect(card(role(), VISITOR)).toMatchObject({ conversationMode: "block", firstConversation: "Human Operations & Onboarding Lead Steward" });
  });

  it("names the consenting circle for a paid role only (control: the paid role above names it)", () => {
    const unpaid = role({ track: "volunteer", termsOffer: { v: 1, pay: { kind: "none" } } as unknown as string });
    expect(card(unpaid, VISITOR)).not.toHaveProperty("consentCircle");
    expect(card(role(), VISITOR).consentCircle).toBe("Anchor Circle");
  });

  it("reads a role with no track as the village's default, a contractor as paid, and a role's own track first (guide v2)", () => {
    // Unpaid terms on offer, so only the track can make it paid.
    const none = role({ track: null, termsOffer: { v: 1, pay: { kind: "none" } } as unknown as string });
    const withDefault = (r: OrgRole) => projectSeat(r, held, VISITOR, { ...ctx, cardWords: { ...ctx.cardWords, defaultTrack: "contractor" } }).card as Record<string, any>;
    expect(card(none, VISITOR).track).toBeNull();
    expect(card(none, VISITOR)).not.toHaveProperty("consentCircle");
    expect(withDefault(none).track).toBe("contractor");
    // Paid by its default track: the paid roles' consent circle is named.
    expect(withDefault(none).consentCircle).toBe("Anchor Circle");
    expect(withDefault(role({ track: "volunteer" })).track).toBe("volunteer");
    // An older stored word reads as the one list's.
    expect(card(role({ track: "paid" as any }), VISITOR).track).toBe("contractor");
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
