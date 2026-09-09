/**
 * The membrane, decided.
 *
 * These are the rules a village is admitted through, so the cases worth having
 * are the ones where being wrong lets somebody in who should not be, or keeps
 * somebody out who should be. Pure, so none of it needs a database.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_VOUCHES_FOR_MEMBERSHIP,
  refuseVouch,
  vouchSentence,
  vouchState,
  type Vouch,
} from "./vouches";

const v = (voucher: string, kind = "member"): Vouch => ({
  voucherUserId: voucher,
  vouchedUserId: "u-new",
  kind,
});

describe("vouchState", () => {
  it("admits nobody on two, and admits on the third", () => {
    expect(vouchState([v("a"), v("b")]).met).toBe(false);
    expect(vouchState([v("a"), v("b"), v("c")]).met).toBe(true);
  });

  it("COUNTS PEOPLE, NEVER ROWS", () => {
    // The unique key already refuses a second vouch from the same person. This
    // refuses it again, because a rule this load-bearing should not depend on
    // an index staying where somebody put it.
    const state = vouchState([v("a"), v("a"), v("a")]);
    expect(state.count).toBe(1);
    expect(state.met).toBe(false);
  });

  it("lets one steward admit somebody outright", () => {
    // The village that lost one of its three before a fourth reached
    // Contributor. Treating a super vouch as merely one more would leave a
    // stuck village exactly as stuck.
    const state = vouchState([v("steward", "super")]);
    expect(state.met).toBe(true);
    expect(state.bySuper).toBe(true);
    expect(state.count).toBe(1);
  });

  it("reads the village's own bar", () => {
    expect(vouchState([v("a"), v("b")], 2).met).toBe(true);
    expect(vouchState([v("a"), v("b")], 5).met).toBe(false);
  });

  it("never lets the bar fall below one, whatever a village sets", () => {
    // A bar of zero would admit everybody the moment they signed up. Somebody
    // always has to say they know you.
    for (const bad of [0, -3, Number.NaN]) {
      expect(vouchState([], bad).needed).toBeGreaterThanOrEqual(1);
      expect(vouchState([], bad).met).toBe(false);
    }
  });

  it("names the vouchers in the order they spoke", () => {
    expect(vouchState([v("a"), v("b"), v("c")]).vouchers).toEqual(["a", "b", "c"]);
  });

  it("defaults to three, which is what the launch rule assumes", () => {
    expect(DEFAULT_VOUCHES_FOR_MEMBERSHIP).toBe(3);
    expect(vouchState([v("a"), v("b")]).needed).toBe(3);
  });

  it("ignores a row with no voucher on it", () => {
    expect(vouchState([{ voucherUserId: "", vouchedUserId: "u", kind: "member" }]).count).toBe(0);
  });
});

describe("refuseVouch", () => {
  const base = { voucherUserId: "a", vouchedUserId: "u-new", existing: [] as Vouch[], vouchedIsMember: false };

  it("allows an ordinary first vouch", () => {
    expect(refuseVouch(base)).toBeNull();
  });

  it("REFUSES VOUCHING FOR YOURSELF, which is the whole mechanism", () => {
    const r = refuseVouch({ ...base, voucherUserId: "u-new" });
    expect(r?.error).toMatch(/yourself/i);
  });

  it("refuses a second vouch from the same person, out loud", () => {
    // Quietly doing nothing would leave somebody believing they had helped.
    const r = refuseVouch({ ...base, existing: [v("a")] });
    expect(r?.error).toMatch(/already vouched/i);
  });

  it("refuses vouching for somebody already in", () => {
    expect(refuseVouch({ ...base, vouchedIsMember: true })?.error).toMatch(/already a member/i);
  });

  it("lets a DIFFERENT person vouch when one already has", () => {
    expect(refuseVouch({ ...base, voucherUserId: "b", existing: [v("a")] })).toBeNull();
  });

  it("refuses a vouch with nobody on one end of it", () => {
    expect(refuseVouch({ ...base, vouchedUserId: "" })).not.toBeNull();
    expect(refuseVouch({ ...base, voucherUserId: "" })).not.toBeNull();
  });
});

describe("vouchSentence", () => {
  it("counts down in people, and uses the singular for the last one", () => {
    expect(vouchSentence(vouchState([v("a")]))).toBe("1 of 3 vouches. 2 more people to go.");
    expect(vouchSentence(vouchState([v("a"), v("b")]))).toBe("2 of 3 vouches. one more person to go.");
  });

  it("says so plainly once the bar is met", () => {
    expect(vouchSentence(vouchState([v("a"), v("b"), v("c")]))).toMatch(/have the vouches/i);
  });

  it("says a steward did it, because that is a different fact", () => {
    expect(vouchSentence(vouchState([v("s", "super")]))).toMatch(/steward/i);
  });
});
