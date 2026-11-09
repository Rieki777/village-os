/**
 * The investor path's rules (spec village-os-ops internal/spec/investor-path, v0.3, S1).
 * Pure: no database, no clock but the one handed in. Each block names the control that
 * must turn it red (tasks.md S1).
 */
import { describe, expect, it } from "vitest";
import {
  FOUNDING_BENEFITS,
  REFUSALS,
  WAY_GROUPS,
  WAY_KEYS,
  WAYS,
  concentrationBand,
  concentrationCheck,
  concentrationVoteRule,
  foundingBenefitsFor,
  foundingStanding,
  handVerdict,
  homeLeaseCheck,
  inKindRoute,
  isConcept,
  previousMonth,
  routeIntent,
  signoffRoute,
  signoffVerdict,
  villageMonth,
  wayVisibility,
  type Refusal,
} from "./investorPath";

describe("the way catalogue (spec US1.1a, 1.1b)", () => {
  it("has ten keys in four groups, each key in exactly one group", () => {
    expect(WAY_KEYS).toHaveLength(10);
    expect(WAY_GROUPS.map((g) => g.key)).toEqual(["stake", "build", "home", "give"]);
    const grouped = WAY_GROUPS.flatMap((g) => g.ways);
    expect([...grouped].sort()).toEqual([...WAY_KEYS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const g of WAY_GROUPS) for (const w of g.ways) expect(WAYS[w].group).toBe(g.key);
  });

  // Control: drop founding's membersOnly flag and this goes red.
  it("keeps founding members-only and every other way public", () => {
    for (const k of WAY_KEYS) expect(WAYS[k].membersOnly).toBe(k === "founding");
    expect(wayVisibility("founding", { hidden: [], member: false })).toMatchObject({ ok: false, code: "WAY_MEMBERS_ONLY" });
    expect(wayVisibility("founding", { hidden: [], member: true })).toEqual({ ok: true });
    expect(wayVisibility("direct", { hidden: [], member: false })).toEqual({ ok: true });
  });

  it("answers WAY_HIDDEN for a hidden way, naming Admin, Pages and the highest-tier vote", () => {
    const v = wayVisibility("parcel", { hidden: ["parcel"], member: true }) as Refusal;
    expect(v.ok).toBe(false);
    expect(v.code).toBe("WAY_HIDDEN");
    expect(v.votePath.tier).toBe("highest");
    expect(v.votePath.where).toMatch(/Admin, Pages/);
  });

  it("earns equity only through a confirmed investment: purchases and claims earn none by themselves", () => {
    expect(WAYS.direct.equity).toBe("earns");
    expect(WAYS.home.equity).toBe("none");
    expect(WAYS.parcel.equity).toBe("none");
    expect(WAYS.steward.equity).toBe("alongside");
    expect(WAYS.business.equity).toBe("alongside");
    expect(WAYS.sponsor.equity).toBe("gift");
  });

  it("says on the home way that its land lease needs shares (R3)", () => {
    expect(WAYS.home.leaseNeedsShares).toBe(true);
    for (const k of WAY_KEYS) if (k !== "home") expect(WAYS[k].leaseNeedsShares).toBe(false);
  });
});

describe("routing a raised hand (US3.3, US2.5)", () => {
  // Control: route a sole holder to their own hand and this goes red.
  it("never routes the raiser to themselves", () => {
    const r = routeIntent({ raiserId: "u1", roleHolders: ["u1"], anchorCircle: ["u1", "u2"] });
    expect(r.recipients).not.toContain("u1");
    expect(r).toEqual({ to: "anchor", recipients: ["u2"] });
  });

  it("goes to the role's other holders first", () => {
    expect(routeIntent({ raiserId: "u1", roleHolders: ["u1", "u3"], anchorCircle: ["u2"] })).toEqual({ to: "role", recipients: ["u3"] });
  });

  it("falls back to a village notice any member may answer when nobody else is left", () => {
    expect(routeIntent({ raiserId: "u1", roleHolders: [], anchorCircle: ["u1"] })).toEqual({ to: "notice", recipients: [] });
  });

  it("resolves every way to someone or to the notice", () => {
    for (const k of WAY_KEYS) {
      const r = routeIntent({ raiserId: "x", roleHolders: [], anchorCircle: [] });
      expect(["role", "anchor", "notice"]).toContain(r.to);
      expect(WAYS[k].defaultRole.length).toBeGreaterThan(0);
    }
  });
});

describe("the Concept rule (US1.4)", () => {
  // Control: treat "designed" as permitted and this goes red.
  it("labels every stage before permitted as Concept", () => {
    for (const s of ["idea", "sited", "designed"] as const) expect(isConcept({ stage: s, confirmed: true })).toBe(true);
    for (const s of ["permitted", "funded", "building", "built", "in_use", "needs_care"] as const)
      expect(isConcept({ stage: s, confirmed: true })).toBe(false);
  });

  it("labels an unconfirmed place Concept at any stage, and stageless land only when unconfirmed", () => {
    expect(isConcept({ stage: "built", confirmed: false })).toBe(true);
    expect(isConcept({ stage: null, confirmed: false })).toBe(true);
    expect(isConcept({ stage: null, confirmed: true })).toBe(false);
  });
});

describe("hand limits (US3.4a)", () => {
  it("allows one open intent per way", () => {
    expect(handVerdict({ openOnWay: 0, raisedThisMoon: 0, limit: 10 })).toEqual({ ok: true });
    expect(handVerdict({ openOnWay: 1, raisedThisMoon: 1, limit: 10 })).toMatchObject({ ok: false, code: "HAND_ALREADY_OPEN" });
  });

  // Control: skip withdrawn intents in the count and this goes red (the caller's count includes them).
  it("caps raises a moon, withdrawn ones counted", () => {
    const raised = [{ withdrawn: true }, { withdrawn: false }];
    expect(handVerdict({ openOnWay: 0, raisedThisMoon: raised.length, limit: 2 })).toMatchObject({ ok: false, code: "HAND_LIMIT_REACHED" });
    expect(handVerdict({ openOnWay: 0, raisedThisMoon: 1, limit: 2 })).toEqual({ ok: true });
  });
});

describe("concentration (US7)", () => {
  const base = { linePct: 20, holders: 5, totals: { equity: 1_000, voice: 1_000 }, group: { equity: 100, voice: 100 } };

  it("does not apply below 3 holders: every investment takes the notice instead", () => {
    expect(concentrationCheck({ ...base, holders: 2, incoming: { equity: 1, voice: 0 } })).toEqual({ applies: false, crosses: [], needsNotice: true });
  });

  it("passes an investment that stays under the line", () => {
    expect(concentrationCheck({ ...base, incoming: { equity: 50, voice: 5 } })).toEqual({ applies: true, crosses: [], needsNotice: false });
  });

  it("flags equity crossing the line", () => {
    expect(concentrationCheck({ ...base, incoming: { equity: 200, voice: 0 } }).crosses).toEqual(["equity"]);
  });

  // Control: count only investments, not gifts, and this goes red.
  it("checks a donation's Voice too", () => {
    const gift = concentrationCheck({ ...base, incoming: { equity: 0, voice: 300 } });
    expect(gift.crosses).toEqual(["voice"]);
    expect(gift.needsNotice).toBe(true);
  });

  it("shows only bands, and only at 10 or more holders", () => {
    expect(concentrationBand({ topPct: 15, holders: 9, floor: 10 })).toBeNull();
    expect(concentrationBand({ topPct: 5, holders: 10, floor: 10 })).toBe("under_10");
    expect(concentrationBand({ topPct: 15, holders: 10, floor: 10 })).toBe("10_20");
    expect(concentrationBand({ topPct: 25, holders: 10, floor: 10 })).toBe("over_20");
  });

  it("counts the refusal vote work-only, without the investor", () => {
    expect(concentrationVoteRule("inv")).toEqual({ voiceCount: "work_only", excludeUserIds: ["inv"] });
  });
});

describe("sign-off by the finance lead or Treasurer (R2)", () => {
  const holders = ["fin", "tre"];

  // Control: let the investor sign their own and this goes red.
  it("never lets the investor sign their own investment, even holding the role", () => {
    expect(signoffVerdict({ investorId: "fin", recorderId: "tre", signerId: "fin", signoffHolders: holders })).toMatchObject({ ok: false, code: "SIGNOFF_SELF" });
  });

  it("refuses a signer who holds no sign-off role", () => {
    expect(signoffVerdict({ investorId: "inv", recorderId: "fin", signerId: "someone", signoffHolders: holders })).toMatchObject({ ok: false, code: "SIGNOFF_NOT_ROLE" });
  });

  it("refuses the recorder while another sign-off holder exists", () => {
    expect(signoffVerdict({ investorId: "inv", recorderId: "fin", signerId: "fin", signoffHolders: holders })).toMatchObject({ ok: false, code: "SIGNOFF_RECORDER" });
    expect(signoffVerdict({ investorId: "inv", recorderId: "fin", signerId: "tre", signoffHolders: holders })).toEqual({ ok: true });
  });

  it("lets the recorder sign when they are the only eligible holder", () => {
    expect(signoffVerdict({ investorId: "inv", recorderId: "fin", signerId: "fin", signoffHolders: ["fin"] })).toEqual({ ok: true });
  });

  it("opens the member notice when nobody eligible signs within 7 days, or nobody is eligible", () => {
    const at = new Date("2027-01-10T12:00:00Z");
    const day = 86_400_000;
    expect(signoffRoute({ investorId: "inv", signoffHolders: holders, recordedAt: at, now: new Date(+at + 6 * day) })).toEqual({ state: "awaiting_signoff", eligible: holders });
    expect(signoffRoute({ investorId: "inv", signoffHolders: holders, recordedAt: at, now: new Date(+at + 7 * day) }).state).toBe("notice");
    expect(signoffRoute({ investorId: "fin", signoffHolders: ["fin"], recordedAt: at, now: at })).toEqual({ state: "notice", eligible: [] });
  });
});

describe("a home's 99-year land lease needs N shares (R3)", () => {
  it("passes at N whole units and refuses below", () => {
    expect(homeLeaseCheck({ minShares: 100, investedUnits: 60, earnedUnits: 40 })).toEqual({ ok: true });
    expect(homeLeaseCheck({ minShares: 100, investedUnits: 60, earnedUnits: 39 })).toMatchObject({ ok: false, code: "HOME_SHARES_SHORT" });
  });

  // Control: count only invested equity and this goes red.
  it("counts Earned Equity as well as invested equity", () => {
    expect(homeLeaseCheck({ minShares: 10, investedUnits: 0, earnedUnits: 10 })).toEqual({ ok: true });
  });

  it("counts whole units only", () => {
    expect(homeLeaseCheck({ minShares: 10, investedUnits: 9.6, earnedUnits: 0.6 })).toMatchObject({ ok: false });
  });

  it("fails closed while the village has not set N, naming the vote that sets it", () => {
    for (const minShares of [null, Number.NaN, -1]) {
      const v = homeLeaseCheck({ minShares, investedUnits: 1e9, earnedUnits: 0 }) as Refusal;
      expect(v.code).toBe("HOME_SHARES_UNSET");
      expect(v.votePath.subject).toBe("investor.home_lease_min_shares");
    }
  });

  it("tells the steward only yes or no, never the holding", () => {
    const v = homeLeaseCheck({ minShares: 100, investedUnits: 12, earnedUnits: 3 });
    expect(JSON.stringify(v)).not.toMatch(/12|15|\b3\b/);
  });
});

describe("in-kind goods route by where they go (R4)", () => {
  // Control: route library goods to equity and this goes red.
  it("sends material-library goods to library credits through intake, with no equity or Voice", () => {
    expect(inKindRoute({ destination: "library" })).toEqual({ token: "library-credit", via: "library.recordIntake", equity: false, voice: false });
  });

  it("sends goods for a campaign's village need to invested equity, earmarked to the campaign", () => {
    expect(inKindRoute({ destination: "campaign", campaignId: "tractor-2027" })).toEqual({
      token: "invested-equity", via: "money_in", channel: "other", earmark: "campaign:tractor-2027", equity: true, voice: true,
    });
  });

  it("refuses campaign goods with no campaign named", () => {
    expect(inKindRoute({ destination: "campaign", campaignId: " " })).toMatchObject({ ok: false, code: "INKIND_NO_CAMPAIGN" });
  });
});

describe("Founding Cedars (R7)", () => {
  it("is not earned before any donation has issued its Voice", () => {
    expect(foundingStanding({ donationMonths: [], currentMonth: "2027-03" })).toEqual({ earned: false });
  });

  it("is earned on the first month and stays current while donations continue", () => {
    expect(foundingStanding({ donationMonths: ["2027-01", "2027-02", "2027-03"], currentMonth: "2027-03" })).toEqual({
      earned: true, earnedMonth: "2027-01", currentThrough: "2027-03", current: true, monthsKept: 3,
    });
  });

  it("stays current through the month after the last donation, so a monthly donor is never between titles", () => {
    expect(foundingStanding({ donationMonths: ["2027-02"], currentMonth: "2027-03" })).toMatchObject({ current: true });
  });

  // Control: keep a lapsed title current and this goes red.
  it("lapses after a full month with no donation, keeping the badge and its date", () => {
    expect(foundingStanding({ donationMonths: ["2027-01"], currentMonth: "2027-03" })).toEqual({
      earned: true, earnedMonth: "2027-01", currentThrough: "2027-01", current: false, monthsKept: 1,
    });
  });

  it("ignores duplicate, unsorted and malformed months", () => {
    expect(foundingStanding({ donationMonths: ["2027-02", "2027-01", "2027-02", "Feb", "2027-13"], currentMonth: "2027-02" })).toMatchObject({
      earnedMonth: "2027-01", currentThrough: "2027-02", monthsKept: 2,
    });
  });

  it("wraps the year for the previous month", () => {
    expect(previousMonth("2027-01")).toBe("2026-12");
    expect(foundingStanding({ donationMonths: ["2026-12"], currentMonth: "2027-01" })).toMatchObject({ current: true });
  });

  it("reads months in the village's own time, not UTC", () => {
    // 03:00 UTC on 1 Feb is 21:00 on 31 Jan in Costa Rica (UTC-6).
    expect(villageMonth(new Date("2027-02-01T03:00:00Z"), "America/Costa_Rica")).toBe("2027-01");
    expect(villageMonth(new Date("2027-02-01T03:00:00Z"), "UTC")).toBe("2027-02");
  });

  it("has a benefits hook that reads the standing and is empty in v1", () => {
    expect(FOUNDING_BENEFITS).toEqual([]);
    const s = foundingStanding({ donationMonths: ["2027-01"], currentMonth: "2027-01" });
    const rule = { key: "retreat-night", eligible: (st: typeof s) => st.earned && st.current };
    expect(foundingBenefitsFor(s, [rule])).toEqual(["retreat-night"]);
    expect(foundingBenefitsFor(foundingStanding({ donationMonths: [], currentMonth: "2027-01" }), [rule])).toEqual([]);
  });
});

describe("every refusal names a vote path (Article 0.4)", () => {
  it("covers the whole refusal table", () => {
    const codes = Object.keys(REFUSALS);
    expect(codes.length).toBeGreaterThanOrEqual(9);
    for (const code of codes) {
      const p = REFUSALS[code as keyof typeof REFUSALS];
      expect(["highest", "village"]).toContain(p.tier);
      expect(p.subject.length).toBeGreaterThan(0);
      expect(p.where.length).toBeGreaterThan(0);
    }
  });

  it("returns the table's path on every refusal a rule produces", () => {
    const refusals: Refusal[] = [
      wayVisibility("direct", { hidden: ["direct"], member: true }),
      wayVisibility("founding", { hidden: [], member: false }),
      handVerdict({ openOnWay: 1, raisedThisMoon: 0, limit: 10 }),
      handVerdict({ openOnWay: 0, raisedThisMoon: 10, limit: 10 }),
      signoffVerdict({ investorId: "a", recorderId: "b", signerId: "a", signoffHolders: ["a", "b"] }),
      signoffVerdict({ investorId: "a", recorderId: "b", signerId: "c", signoffHolders: ["b"] }),
      signoffVerdict({ investorId: "a", recorderId: "b", signerId: "b", signoffHolders: ["b", "d"] }),
      homeLeaseCheck({ minShares: null, investedUnits: 0, earnedUnits: 0 }),
      homeLeaseCheck({ minShares: 5, investedUnits: 0, earnedUnits: 0 }),
      inKindRoute({ destination: "campaign", campaignId: "" }),
    ].filter((v): v is Refusal => "ok" in v && v.ok === false);
    expect(refusals).toHaveLength(10);
    expect(new Set(refusals.map((r) => r.code)).size).toBe(Object.keys(REFUSALS).length);
    for (const r of refusals) expect(r.votePath).toEqual(REFUSALS[r.code]);
  });
});
