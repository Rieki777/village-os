/**
 * THE RULE THAT KEEPS A MACHINE FROM MINTING, tested where it is decidable.
 *
 * Everything about the settlement ballot that can be got wrong without a
 * database is in `settlementProposalDecision`, and every case below is a way a
 * machine could end up asking when it should not: asking twice, asking about a
 * moon the village refused, asking about a moon that is mid-vote, or asking at
 * all in a village that never opted in.
 *
 * The document has its own cases, and they are about what a member READS before
 * they vote on where money goes. A document that overstates the release, or
 * that lets a reader think their own gratitude is on the ballot, is a defect in
 * the vote itself and not in the prose.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_ASKS_AFTER_SILENCE,
  settlementModeFrom,
  settlementProposalDecision,
  settlementProposalDoc,
  settlementProposalTitle,
  settlementRefusalWarning,
  settlementVoteDaysFrom,
  type SettlementAsk,
} from "./moonSettlement";

const moon = (n: number) => ({ id: `lunar-${String(n).padStart(6, "0")}`, cycleNumber: n });
const ask = (n: number, over: Partial<SettlementAsk> = {}): SettlementAsk => ({
  cycleId: moon(n).id,
  open: false,
  outcome: "no_quorum",
  ...over,
});

describe("which mode a village is in", () => {
  it("reads the two modes it ships with", () => {
    expect(settlementModeFrom("proposal")).toBe("proposal");
    expect(settlementModeFrom("manual")).toBe("manual");
    expect(settlementModeFrom(" PROPOSAL ")).toBe("proposal");
  });

  it("lands on manual for anything it cannot read, which is the safe direction", () => {
    // Not "proposal", even though that is the registry default. An unreadable
    // value means nobody knows what this village asked for, and the answer to
    // "should a machine open a vote about money" when nobody knows is no.
    for (const raw of ["", null, undefined, "automatic", "Automatic", 7, {}]) {
      expect(settlementModeFrom(raw)).toBe("manual");
    }
  });

  it("does not accept 'automatic', because this build has no such thing", () => {
    // The foundation is in place and the mode is deliberately absent. If a
    // later lane adds it, this line is the one that has to be changed on
    // purpose rather than a behaviour that quietly starts existing.
    expect(settlementModeFrom("automatic")).toBe("manual");
  });
});

describe("how long the village gets to answer", () => {
  it("holds the window under a lunation", () => {
    expect(settlementVoteDaysFrom("3")).toBe(3);
    expect(settlementVoteDaysFrom("40")).toBe(21);
    expect(settlementVoteDaysFrom("0")).toBe(3);
    expect(settlementVoteDaysFrom("nonsense")).toBe(3);
  });
});

describe("whether to ask the village about a moon", () => {
  it("asks about the oldest moon that has ended and never been asked about", () => {
    const d = settlementProposalDecision({ governanceOn: true, mode: "proposal", due: [moon(330), moon(331)], asks: [] });
    expect(d).toEqual({ post: true, cycleId: "lunar-000330", cycleNumber: 330 });
  });

  it("never asks in a village that settles by hand", () => {
    const d = settlementProposalDecision({ governanceOn: true, mode: "manual", due: [moon(330)], asks: [] });
    expect(d.post).toBe(false);
    expect(d.post === false && d.why).toContain("by hand");
  });

  it("says nothing is due rather than inventing a moon", () => {
    const d = settlementProposalDecision({ governanceOn: true, mode: "proposal", due: [], asks: [] });
    expect(d.post).toBe(false);
  });

  it("does not ask twice while the village is still answering", () => {
    const d = settlementProposalDecision({
      governanceOn: true,
      mode: "proposal",
      due: [moon(330)],
      asks: [ask(330, { open: true, outcome: null })],
    });
    expect(d.post).toBe(false);
    expect(d.post === false && d.why).toContain("already voting");
  });

  it("NEVER asks again about a moon the village voted down", () => {
    /*
     * The load-bearing case in this file. A machine that re-posts a refused
     * settlement every hour until somebody gives in has not conducted a vote,
     * it has worn one down. The refusal is terminal for the JOB; a person can
     * still open one by hand, which is a different actor and the point.
     */
    const d = settlementProposalDecision({
      governanceOn: true,
      mode: "proposal",
      due: [moon(330)],
      asks: [ask(330, { outcome: "failed" })],
    });
    expect(d.post).toBe(false);
    expect(d.post === false && d.why).toContain("voted not to settle");
  });

  it("asks once more when nobody answered, and then stops", () => {
    // A quorum nobody met is not a refusal: a village that did not finish
    // deciding is not a village that said no. So exactly one re-ask.
    const once = settlementProposalDecision({
      governanceOn: true,
      mode: "proposal",
      due: [moon(330)],
      asks: [ask(330)],
    });
    expect(once).toEqual({ post: true, cycleId: "lunar-000330", cycleNumber: 330 });

    const twice = settlementProposalDecision({
      governanceOn: true,
      mode: "proposal",
      due: [moon(330)],
      asks: [ask(330), ask(330)],
    });
    expect(twice.post).toBe(false);
    expect(twice.post === false && twice.why).toContain("nobody answered");
    expect(MAX_ASKS_AFTER_SILENCE).toBe(2);
  });

  it("moves past a parked moon instead of blocking every moon behind it", () => {
    /*
     * THE STALL THIS EXISTS TO PREVENT. Settling in order is right, but a
     * single refused moon must not park the village's income forever. One
     * decision is one decision; it is not a permanent hold on the mechanism.
     */
    const d = settlementProposalDecision({
      governanceOn: true,
      mode: "proposal",
      due: [moon(330), moon(331)],
      asks: [ask(330, { outcome: "failed" })],
    });
    expect(d).toEqual({ post: true, cycleId: "lunar-000331", cycleNumber: 331 });
  });

  it("leaves a carried moon alone until its landing runs", () => {
    const d = settlementProposalDecision({
      governanceOn: true,
      mode: "proposal",
      due: [moon(330)],
      asks: [ask(330, { outcome: "passed" })],
    });
    expect(d.post).toBe(false);
    expect(d.post === false && d.why).toContain("already carried");
  });

  it("holds the village to ONE settlement vote at a time", () => {
    /*
     * The deliberate stop, pinned so it cannot be relaxed by accident. Two
     * settlement ballots open at once would sit on the decisions page with
     * near-identical titles and different amounts, and a member would have to
     * read a moon number to know which money they were voting about. The vote
     * window is capped under a lunation so this can never actually stall.
     */
    const d = settlementProposalDecision({
      governanceOn: true,
      mode: "proposal",
      due: [moon(330), moon(331)],
      asks: [ask(330, { open: true, outcome: null })],
    });
    expect(d.post).toBe(false);
    expect(d.post === false && d.why).toContain("cycle 330");
  });

  it("does not re-post a settlement somebody called off", () => {
    /*
     * A facilitator can withdraw any ballot, including one the moon opened.
     * This job runs hourly, so treating a withdrawal as "no answer yet" would
     * have put the same ballot straight back and made the withdraw button a
     * button that does nothing.
     */
    const d = settlementProposalDecision({
      governanceOn: true,
      mode: "proposal",
      due: [moon(330)],
      asks: [ask(330, { outcome: "withdrawn" })],
    });
    expect(d.post).toBe(false);
    expect(d.post === false && d.why).toContain("called off");
  });

  it("never asks a village that cannot see a ballot", () => {
    /*
     * The mode defaults to `proposal`, so a village running with the governance
     * module off would otherwise be asked every moon about votes its members
     * have no page to answer on — and its economy would quietly stop paying
     * anybody while the settlements waited forever. The founder's button still
     * settles, which is what makes refusing here safe.
     */
    const d = settlementProposalDecision({
      governanceOn: false,
      mode: "proposal",
      due: [moon(330)],
      asks: [],
    });
    expect(d.post).toBe(false);
    expect(d.post === false && d.why).toContain("nowhere for a settlement vote to be seen");
  });

  it("an open ballot on a LATER moon does not stop the older one being asked", () => {
    // The open check is per moon and not per village: a village mid-vote on
    // 331 has not been asked about 330, and 330 is the one that is overdue.
    const d = settlementProposalDecision({
      governanceOn: true,
      mode: "proposal",
      due: [moon(330), moon(331)],
      asks: [ask(331, { open: true, outcome: null })],
    });
    expect(d).toEqual({ post: true, cycleId: "lunar-000330", cycleNumber: 330 });
  });
});

const facts = {
  cycleNumber: 330,
  startsAt: "2026-08-03T00:00:00.000Z",
  endsAt: "2026-09-01T00:00:00.000Z",
  poolToken: "seed",
  tokenName: "Seed",
  currencyName: "gratitude",
};

describe("the document a member reads before voting on where money goes", () => {
  it("names the moon and the amounts, and says they will not move", () => {
    const doc = settlementProposalDoc({
      ...facts,
      shares: [
        { name: "Maya", received: 60, distinctSenders: 4, credited: 60 },
        { name: "Ivo", received: 40, distinctSenders: 2, credited: 40 },
      ],
    });
    expect(settlementProposalTitle(330)).toBe("Settle the moon that ended: cycle 330");
    expect(doc).toContain("100 Seed");
    expect(doc).toContain("  Maya: 60 Seed");
    expect(doc).toContain("do not");
    // The promise that makes the vote a vote and not an estimate.
    expect(doc).toContain("pays exactly them");
  });

  it("says plainly that the gratitude people sent is not on the ballot", () => {
    /*
     * The most likely misreading, and the most expensive one. A member who
     * thinks a no vote takes back the thanks they were given will vote about
     * something that is not happening.
     */
    const doc = settlementProposalDoc({
      ...facts,
      shares: [{ name: "Maya", received: 60, distinctSenders: 4, credited: 60 }],
    });
    expect(doc).toContain("is not on this ballot");
    expect(doc).toContain("credited the moment it was sent");
  });

  it("does not promise a release when the pool is empty", () => {
    const doc = settlementProposalDoc({
      ...facts,
      shares: [{ name: "Maya", received: 60, distinctSenders: 4, credited: 0 }],
    });
    expect(doc).toContain("Nothing.");
    expect(doc).toContain("moves no value");
    expect(doc).not.toContain("  Maya:");
  });

  it("handles a moon nobody was thanked in without claiming otherwise", () => {
    const doc = settlementProposalDoc({ ...facts, shares: [] });
    expect(doc).toContain("Nobody was thanked this moon");
  });

  it("stops naming people after twelve and counts the rest", () => {
    const shares = Array.from({ length: 15 }, (_, i) => ({
      name: `Member ${i}`,
      received: 15 - i,
      distinctSenders: 1,
      credited: 15 - i,
    }));
    const doc = settlementProposalDoc({ ...facts, shares });
    expect(doc).toContain("  Member 11:");
    expect(doc).not.toContain("  Member 12:");
    expect(doc).toContain("  and 3 more members");
  });

  it("says what a failure costs, because a member is voting on that too", () => {
    const doc = settlementProposalDoc({
      ...facts,
      shares: [{ name: "Maya", received: 60, distinctSenders: 4, credited: 60 }],
    });
    expect(doc).toContain("the moon stays open and no value moves");
    expect(doc).toContain("Nothing is lost and nothing expires");
  });
});

describe("the warning a founder reads before overruling the village", () => {
  it("names a village no and its date, and says Close still pays", () => {
    expect(settlementRefusalWarning({ ballotId: "b1", at: "2026-09-14T10:00:00.000Z", vetoed: false })).toBe(
      "The village voted this moon's settlement down on 14 September 2026. Closing it pays this split anyway.",
    );
  });

  it("names a steward's veto as a veto, since both read as failed", () => {
    expect(settlementRefusalWarning({ ballotId: "b2", at: "2026-09-14T10:00:00.000Z", vetoed: true })).toBe(
      "A steward stopped this moon's settlement on 14 September 2026. Closing it pays this split anyway.",
    );
  });
});
