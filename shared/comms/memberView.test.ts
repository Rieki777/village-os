import { describe, expect, it } from "vitest";
import { dialFromSearch, dialLink, PROPOSAL_LIMITS, readProposal } from "./memberView";

describe("a proposed change to the village's email", () => {
  it("reads a proposal about a journey, a step, an email or a dial", () => {
    expect(readProposal({ target: "journey", key: "gathering.going", change: "  Turn it on for everyone.  " })).toEqual({
      proposal: { target: "journey", key: "gathering.going", step: null, change: "Turn it on for everyone." },
    });
    expect(readProposal({ target: "step", key: "path.resident", step: "meet_us", change: "Send it on day 3." })).toEqual({
      proposal: { target: "step", key: "path.resident", step: "meet_us", change: "Send it on day 3." },
    });
    // A step named on anything but a step proposal is dropped.
    expect(readProposal({ target: "words", key: "gathering.confirm", step: "x", change: "Say what to bring." })).toMatchObject({
      proposal: { step: null },
    });
  });

  it("says the one thing wrong with a proposal it cannot take", () => {
    expect(readProposal(null)).toEqual({ problem: "Choose what the change is about." });
    expect(readProposal({ target: "everything", key: "a", change: "x".repeat(20) })).toEqual({ problem: "Choose what the change is about." });
    expect(readProposal({ target: "dial", key: "Not A Key", change: "x".repeat(20) })).toMatchObject({ problem: expect.stringContaining("Choose the journey") });
    expect(readProposal({ target: "step", key: "path.resident", change: "x".repeat(20) })).toEqual({ problem: "Choose the step the change is about." });
    expect(readProposal({ target: "words", key: "gathering.confirm", change: "too short" })).toMatchObject({ problem: expect.stringContaining("at least") });
    expect(readProposal({ target: "words", key: "gathering.confirm", change: "x".repeat(PROPOSAL_LIMITS.max + 1) })).toMatchObject({
      problem: expect.stringContaining("under"),
    });
  });

  it("links a dial to the Game Mechanics page, and reads the dial back from that address", () => {
    expect(dialLink("comms.daily_cap")).toBe("/game-mechanics?dial=comms.daily_cap");
    expect(dialFromSearch("?dial=comms.daily_cap")).toBe("comms.daily_cap");
    expect(dialFromSearch("?focus=proposal-1")).toBe("");
    expect(dialFromSearch("?dial=%3Cscript%3E")).toBe("");
  });
});
