/**
 * WHAT THE VILLAGE ACTUALLY READS WHEN IT VOTES TO START ITS GAME.
 *
 * `ballots.doc_markdown` is frozen when the vote opens and is the thing every
 * member votes on, so Rye's "so it's there in the proposal to be voted on" is
 * a requirement about THIS STRING and not about a screen. Until this file the
 * only way to check a word of it was to open a real launch vote against a real
 * schema, because the document was an array literal inside a route.
 *
 * No database, no ballot, no server. That is the point of the extraction.
 */
import { describe, expect, it } from "vitest";
import { launchProposalDoc } from "./lib/launchProposal";
import { HANDOVER_SET } from "../shared/capabilities";

const BASE = {
  villageName: "Larksfield",
  quorumPct: 100,
  unityPct: 100,
  onTheRoll: 4,
  weightNote: "",
  openedBy: "Wren",
  openedOn: "2026-09-24",
  slate: [] as Array<{ id: string; name: string }>,
};

describe("the launch proposal's frozen document", () => {
  it("NAMES the founding stewards it puts forward, and says whose list it is", () => {
    const doc = launchProposalDoc({
      ...BASE,
      slate: [
        { id: "cat-1", name: "Wren" },
        { id: "cat-2", name: "Iris" },
      ],
    });
    expect(doc).toContain("## Who carries the steward's seat");
    // The slate is IN the document, by name, as a list a member can read.
    expect(doc).toContain("- Wren");
    expect(doc).toContain("- Iris");
    // ONE PERSON CHOSE IT, and the village is owed that plainly. A document
    // that listed names with nobody attached would read as the village's own
    // decision, which it is not until the vote carries.
    expect(doc).toContain("Wren opened this vote and chose who it puts forward");
    expect(doc).toContain("Voting yes is voting for this list");
  });

  it("says accepting means holding ALL the powers, with the count from HANDOVER_SET", () => {
    const doc = launchProposalDoc({ ...BASE, slate: [{ id: "cat-1", name: "Wren" }] });
    /*
     * NOT a hand-typed nineteen. `HANDOVER_SET` is derived from `TRANSFERABLE`
     * so a new entrustable power joins it without anybody remembering to, and
     * a number typed here would pass this test forever while the document told
     * a village the wrong thing.
     */
    expect(doc).toContain(`all ${HANDOVER_SET.length} of the powers this village has to give`);
    expect(doc, "and what the seat actually does").toContain(
      "stop a decision the village has already carried",
    );
    expect(doc, "and that saying no is a real answer").toContain("Anybody named can decline");
  });

  it("says out loud when the proposal names NOBODY, and what that means", () => {
    const doc = launchProposalDoc(BASE);
    expect(doc).toContain("## The steward's seat");
    expect(doc).toContain("named nobody for the steward's seat");
    expect(doc, "and that nothing is broken by it").toContain("That stops nothing");
    expect(doc, "so no reader can mistake it for the other branch").not.toContain(
      "Who carries the steward's seat",
    );
  });

  it("keeps every sentence the launch document already carried", () => {
    /*
     * The regression this extraction could have caused. The document moved out
     * of the route whole, and a member reading it should not be able to tell
     * that anything happened to the file it lives in.
     */
    const doc = launchProposalDoc({ ...BASE, weightNote: "Everybody's voice weighs the same here." });
    expect(doc).toContain("# Start the Game");
    expect(doc).toContain("Larksfield is built. This vote is what starts it.");
    expect(doc).toContain("## What changes when this carries");
    expect(doc).toContain("Token issuance turns on.");
    expect(doc).toContain("## What this vote asks");
    expect(doc).toContain("Everyone on the roll votes yes: 100% participation and 100% agreement.");
    expect(doc).toContain("4 people hold a voice today");
    expect(doc).toContain("An abstention is not a yes here");
    expect(doc).toContain("Everybody's voice weighs the same here.");
    expect(doc).toContain("Every item on the journey to launch read done when Wren opened this, on 2026-09-24.");
  });

  it("leaves no empty line where a weight note would have been", () => {
    // The `...(note ? [note, ""] : [])` shape, pinned. A blank pair emitted
    // for a village with nothing to say about weight renders as a gap in the
    // middle of the document.
    const doc = launchProposalDoc(BASE);
    expect(doc).not.toContain("\n\n\n");
  });
});
