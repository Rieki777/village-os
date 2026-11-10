/**
 * THE AGREEMENT REVIEW REMINDER (D10b of the canvas follow-up, 2026-11-09).
 *
 * An adopted agreement names a review date, and until this job nothing told
 * anybody when it came. `runAgreementReviews` is the job's whole body, pure
 * over what it is handed: the agreements, the village's civil date, the
 * members and the bound presence test. The notify spine is modelled here with
 * the unique `dedupe_key` it really has, so "once" is the spine's answer and
 * not this file's bookkeeping.
 */
import { describe, expect, it } from "vitest";
import type { StoredAgreement } from "../../shared/agreements";
import { AGREEMENT_REVIEW_LINK, agreementReviewKey, runAgreementReviews } from "./agreements";

const agreement = (over: Partial<StoredAgreement> = {}): StoredAgreement => ({
  id: "agr-quiet",
  title: "Quiet hours in the common house",
  body: "Between ten at night and seven in the morning the common house is quiet.",
  domain: null,
  circleId: null,
  reviewAt: "2027-03-01",
  status: "active",
  ballotId: "bal-1",
  proposedBy: "u-wren",
  proposedAt: "2026-11-01T00:00:00.000Z",
  decidedAt: "2026-11-09T00:00:00.000Z",
  ...over,
});

const MEMBERS = [
  { id: "u-wren", present: true },
  { id: "u-ash", present: true },
  { id: "u-gone", present: false },
];

function spine() {
  const rows = new Map<string, any>();
  return {
    rows,
    notify: async (input: any) => {
      if (rows.has(input.dedupeKey)) return { fresh: false };
      rows.set(input.dedupeKey, input);
      return { fresh: true };
    },
  };
}

const run = (s: ReturnType<typeof spine>, agreements: StoredAgreement[], today: string) =>
  runAgreementReviews({ agreements, today, members: MEMBERS, isPresent: (m) => !!(m as any)?.present, notify: s.notify });

describe("runAgreementReviews", () => {
  it("reminds every present member once on the review date, and a second run adds nothing", async () => {
    const s = spine();
    const first = await run(s, [agreement()], "2027-03-01");
    expect(first).toEqual({ due: 1, told: 2 });
    expect([...s.rows.values()].map((r) => [r.userId, r.type, r.dedupeKey, r.link])).toEqual([
      ["u-wren", "governance", "agreement:agr-quiet:review:2027-03-01:uu-wren", AGREEMENT_REVIEW_LINK],
      ["u-ash", "governance", "agreement:agr-quiet:review:2027-03-01:uu-ash", AGREEMENT_REVIEW_LINK],
    ]);
    expect(s.rows.get(agreementReviewKey("agr-quiet", "2027-03-01", "u-ash")).title).toContain("Quiet hours in the common house");

    const second = await run(s, [agreement()], "2027-03-01");
    expect(second).toEqual({ due: 1, told: 0 });
    expect(s.rows.size).toBe(2);
  });

  it("still reminds on a later sweep when the day itself was missed, once", async () => {
    const s = spine();
    expect(await run(s, [agreement()], "2027-03-03")).toEqual({ due: 1, told: 2 });
    expect(await run(s, [agreement()], "2027-03-04")).toEqual({ due: 1, told: 0 });
  });

  it("tells nobody the day before, for an agreement not active, or for one with no review date", async () => {
    const s = spine();
    expect(await run(s, [agreement()], "2027-02-28")).toEqual({ due: 0, told: 0 });
    for (const status of ["voting", "not-adopted", "withdrawn"] as const) {
      expect(await run(s, [agreement({ status })], "2027-03-01"), status).toEqual({ due: 0, told: 0 });
    }
    expect(await run(s, [agreement({ reviewAt: null })], "2027-03-01")).toEqual({ due: 0, told: 0 });
    expect(s.rows.size).toBe(0);
  });

  it("re-arms when the review date moves, because the date the village was told is no longer the date", async () => {
    const s = spine();
    await run(s, [agreement()], "2027-03-01");
    expect(await run(s, [agreement({ reviewAt: "2027-09-01" })], "2027-09-01")).toEqual({ due: 1, told: 2 });
  });

  it("keeps going when one member's notice fails", async () => {
    let calls = 0;
    const r = await runAgreementReviews({
      agreements: [agreement()],
      today: "2027-03-01",
      members: MEMBERS,
      isPresent: (m) => !!(m as any)?.present,
      notify: async () => {
        calls += 1;
        if (calls === 1) throw new Error("spine down");
        return { fresh: true };
      },
    });
    expect(r).toEqual({ due: 1, told: 1 });
  });
});
