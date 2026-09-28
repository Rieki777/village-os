/**
 * THE FIVE FRAMES' SENTENCES, line by line (Wave 3b, 2026-09-28).
 *
 * What adopting does is the claim that matters most on the Adopt frame, and it
 * changes at the Birthing, so each pen is asked on both sides of it. The body
 * the suggestion box sends is checked against the route's own validator
 * (`parseCanvasProposal`), so a body this file builds is one the server takes.
 */
import { describe, expect, it } from "vitest";
import { parseCanvasProposal } from "@shared/canvasFrames";
import {
  adoptEffect,
  adoptIntro,
  adoptLabel,
  ADMIN_PAGES_LINE,
  changeLines,
  EMPTY_FIELDS,
  followableHref,
  gapFacts,
  KEEP,
  mayAdopt,
  mayDecline,
  opensPurposeVote,
  penKeyFor,
  penSentences,
  proposalHeadline,
  readFailure,
  refusalText,
  suggestedLine,
  suggestionBody,
  suggestionFate,
  suggestionOptions,
  type BlockFramesPayload,
  type PenView,
  type ProposalView,
} from "./canvasFramesCopy";

const pen = (over: Partial<PenView> = {}): PenView => ({
  pen: "prose",
  how: "act",
  who: "the-gate",
  sentence: "Whoever holds the village's story adopts these words.",
  ballotBuilt: true,
  youMayAdopt: false,
  ...over,
});

const proposal = (over: Partial<ProposalView> = {}): ProposalView => ({
  id: 12,
  blockId: "power",
  target: "words",
  sectionId: "decisions",
  door: null,
  change: null,
  body: "We decide by consent at the Saturday circle.",
  source: "member",
  proposedBy: { id: "u2", name: "Sage" },
  createdAt: "2026-10-03T10:00:00.000Z",
  status: "open",
  pen: pen(),
  youProposedIt: false,
  ...over,
});

const titles = { decisions: "Decisions", aims: "Aims", vision: "Vision", constraints: "Constraints", membership: "Membership", people: "People" };

const block = (id: BlockFramesPayload["block"]["id"], briefSections: string[] = []): BlockFramesPayload["block"] => ({
  id,
  number: 7,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  briefSections,
});

describe("what adopting does, before the Birthing and after it", () => {
  it("writes a dial straight away before the Game starts, and files it in its author's name after", () => {
    const dial = proposal({ target: "setting", sectionId: null, door: "dial:governance.default_method", change: { value: "consent" }, pen: pen({ pen: "dial" }) });
    expect(adoptEffect(dial, false, titles)).toBe("The Game has not started, so adopting sets how village-wide ballots decide to consent straight away.");
    const after = { ...dial, pen: pen({ pen: "dial", how: "ballot", who: "any-member" }) };
    expect(adoptEffect(after, true, titles)).toBe(
      "The Game has started, so adopting files this as a proposal to change the Game's rules, in Sage's name, and the village votes on it. Only the member who suggested it can file it.",
    );
    expect(adoptEffect({ ...after, youProposedIt: true }, true, titles)).toContain("in your name");
    expect(adoptLabel(dial)).toBe("Adopt and change the setting");
    expect(adoptLabel(after)).toBe("File it as a proposal");
  });

  it("writes the exit policy before the Game starts, and says the vote is not built after", () => {
    const terms = proposal({ blockId: "team", target: "setting", sectionId: null, door: "exit:terms", change: { noticePeriodDays: 30 }, pen: pen({ pen: "consequence", who: "admins" }) });
    expect(adoptEffect(terms, false, titles)).toBe("The Game has not started, so adopting writes this into the exit policy straight away.");
    const after = { ...terms, pen: pen({ pen: "consequence", how: "ballot", who: "any-member", ballotBuilt: false }) };
    expect(adoptEffect(after, true, titles)).toBe(
      "The Game has started, so this goes to a vote of the whole village at the structural tier. That vote is not built yet, so this suggestion stays open until it is.",
    );
  });

  it("sends the care door to the conflict agreement's own vote after the Birthing", () => {
    const care = proposal({ blockId: "conflict", target: "setting", sectionId: null, door: "exit:restorative", change: { replyHours: 48 }, pen: pen({ pen: "consequence", how: "ballot", who: "any-member", ballotBuilt: false }) });
    expect(adoptEffect(care, true, titles)).toContain("only by a vote on the village's conflict agreement");
    expect(adoptEffect({ ...care, pen: pen({ pen: "consequence", who: "admins" }) }, false, titles)).toContain("unless a conflict agreement already holds it");
  });

  it("adds or changes a matrix row before the Birthing", () => {
    const row = { subject: "Spending under a hundred", approval: "The treasurer", consultation: "Nobody yet", information: "The circle", method: "", riskTags: [] };
    const add = proposal({ target: "matrix", sectionId: null, change: row, pen: pen({ pen: "consequence", who: "admins" }) });
    expect(adoptEffect(add, false, titles)).toBe("The Game has not started, so adopting adds this row to the Decision Matrix straight away.");
    expect(adoptEffect({ ...add, change: { ...row, rowId: 3 } }, false, titles)).toContain("changes this row");
    expect(proposalHeadline(add, titles)).toBe("A new row for the Decision Matrix: Spending under a hundred");
  });

  it("keeps the governance module with the administrators after the Birthing, and says why", () => {
    const mod = proposal({ target: "setting", sectionId: null, door: "module:governance", change: { to: "members" }, pen: pen({ pen: "module", who: "admins" }) });
    expect(adoptEffect(mod, false, titles)).toBe("The Game has not started, so adopting switches this on for members straight away.");
    expect(adoptEffect(mod, true, titles)).toContain("stays with the administrators after the Game starts");
  });

  it("writes words into their section on either side of the Birthing", () => {
    expect(adoptEffect(proposal(), false, titles)).toBe("Adopting writes these words into Decisions as the village's adopted answer.");
    expect(adoptEffect(proposal(), true, titles)).toBe(adoptEffect(proposal(), false, titles));
    expect(adoptLabel(proposal())).toBe("Adopt these words");
  });

  it("opens the frame on the moment the village is in", () => {
    expect(adoptIntro(false)).toContain("The Game has not started, so adopting a suggestion that names a setting writes the setting");
    // After the Birthing no one sentence is true of every setting (a dial is
    // filed, the governance module switches straight away, the care door goes
    // through the agreement), so the line sends the reader to each card.
    expect(adoptIntro(true)).toBe(
      "The Game has started, so what adopting does now depends on the suggestion. Each one below says what adopting it would do, and who decides.",
    );
    expect(adoptIntro(true)).not.toMatch(/files a proposal/);
  });
});

describe("who is offered which button", () => {
  it("offers Decline only to the pen acting alone on somebody else's suggestion", () => {
    expect(mayDecline(proposal({ pen: pen({ youMayAdopt: true }) }))).toBe(true);
    expect(mayDecline(proposal({ pen: pen({ youMayAdopt: true }), youProposedIt: true }))).toBe(false);
    expect(mayDecline(proposal({ pen: pen({ youMayAdopt: false }) }))).toBe(false);
    expect(mayDecline(proposal({ pen: pen({ youMayAdopt: true, how: "ballot" }) }))).toBe(false);
  });

  it("sends a purpose statement to the proposal wizard once the village holds the pen, never to a refused button", () => {
    const vote = proposal({ blockId: "purpose", target: "purpose", sectionId: null, pen: pen({ pen: "purpose", how: "ballot", who: "any-member", youMayAdopt: true }) });
    expect(mayAdopt(vote)).toBe(false);
    expect(opensPurposeVote(vote)).toBe(true);
    const founders = { ...vote, pen: pen({ pen: "purpose", who: "founders", youMayAdopt: true }) };
    expect(mayAdopt(founders)).toBe(true);
    expect(opensPurposeVote(founders)).toBe(false);
  });

  it("names each pen once", () => {
    const words = pen();
    expect(penSentences({ words, adminWords: pen({ pen: "admin", sentence: "Admins." }), dial: pen({ pen: "dial", sentence: "Admins." }) })).toEqual([words.sentence, "Admins."]);
    expect(penKeyFor({ target: "words", sectionId: "people" })).toBe("adminWords");
    expect(penKeyFor({ target: "setting", door: "exit:terms" })).toBe("consequence");
  });
});

describe("the lines about one suggestion", () => {
  it("says who suggested it and when, and where it came from", () => {
    expect(suggestedLine(proposal(), "en-GB")).toBe("Suggested by Sage on 3 October 2026");
    expect(suggestedLine(proposal({ youProposedIt: true }), "en-GB")).toBe("Suggested by you on 3 October 2026");
    expect(suggestedLine(proposal({ source: "derived", proposedBy: { id: "u1", name: "Ada" } }), "en-GB")).toBe("Drafted from the live system by Ada on 3 October 2026");
  });

  it("puts each change in words", () => {
    expect(changeLines(proposal({ target: "setting", door: "exit:terms", change: { noticePeriodDays: 1, unwindSteps: ["Talk", "Settle"] } }))).toEqual([
      "Notice before leaving: 1 day",
      "The steps of leaving: Talk / Settle",
    ]);
    expect(changeLines(proposal({ target: "setting", door: "exit:restorative", change: { intakeContactRole: "", replyHours: null } }))).toEqual([
      "The care role: none",
      "No promised reply time",
    ]);
    expect(changeLines(proposal({ target: "setting", door: "module:governance", change: { to: "public" } }))).toEqual(["Switched on for everybody, visitors included"]);
    expect(changeLines(proposal())).toEqual([]);
  });

  it("prints a refusal's sentence and never its code", () => {
    expect(refusalText({ error: "restorative_in_agreement", message: "Nothing was adopted." }, "x")).toBe("Nothing was adopted.");
    expect(refusalText({ error: "The founders adopt this before the Game starts." }, "x")).toBe("The founders adopt this before the Game starts.");
    expect(refusalText({ error: "unknown_role" }, "That was refused.")).toBe("That was refused.");
    expect(refusalText(null, "That was refused.")).toBe("That was refused.");
  });

  it("says why a read failed, and whether trying again could help", () => {
    expect(readFailure(401, "auth_required", "this block")).toEqual({ message: "Sign in to read this block.", retry: false });
    expect(readFailure(403, "Members only.", "this block")).toEqual({ message: "Members only.", retry: false });
    expect(readFailure(500, undefined, "this block")).toEqual({ message: "This block could not be read just now.", retry: true });
  });
});

describe("the See frame's gaps between the words and the settings", () => {
  const doors: BlockFramesPayload["doors"] = [
    { id: "dial:membership.vouches_required", label: "How many vouches admit a new member", href: "/game-mechanics", kind: "dial", wired: true },
    { id: "exit:terms", label: "How somebody leaves", href: "/exit-policy", kind: "exit-policy", wired: true },
  ];

  it("says where the words are missing while the settings already work", () => {
    const gaps = gapFacts({
      block: block("team", ["membership", "people"]),
      answer: {
        sections: [
          { id: "membership", title: "Membership", readable: true, status: "blank" },
          { id: "people", title: "People", readable: false, status: "admin-only" },
        ],
      },
      doors,
      proposals: [],
    });
    expect(gaps.map((g) => g.text)).toEqual([
      "Nothing is written yet under Membership, while the settings behind this block, listed below, already work as they are set today.",
    ]);
  });

  it("never names a door as a state that applies: governance is off by default, and its door is called \"switched on\"", () => {
    // The Power block on a fresh village: Decisions is blank and governance is
    // off, which the server's own fact says. The gap line may not say otherwise.
    const gaps = gapFacts({
      block: block("power", ["decisions"]),
      answer: { sections: [{ id: "decisions", title: "Decisions", readable: true, status: "blank" }] },
      doors: [
        { id: "dial:governance.default_method", label: "How village-wide ballots decide", href: "/game-mechanics", kind: "dial", wired: true },
        { id: "module:governance", label: "Governance switched on for members", href: "/admin?tab=modules&module=governance", kind: "module", wired: true },
      ],
      proposals: [],
    });
    const text = gaps.map((g) => g.text).join(" ");
    expect(text).toContain("Nothing is written yet under Decisions");
    expect(text).not.toMatch(/switched on/i);
    expect(text).not.toMatch(/how village-wide ballots decide/i);
  });

  it("names a draft, words kept from members, an open setting suggestion and a setting the canvas cannot reach", () => {
    const gaps = gapFacts({
      block: block("roles", ["work"]),
      answer: { sections: [{ id: "work", title: "Work", readable: false, status: "not-shared" }] },
      doors: [{ label: "The term on each seat", href: "/roles", why: "Seat terms are set on each seat.", wired: false }],
      proposals: [],
    });
    expect(gaps.map((g) => g.text)).toEqual([
      "Words under Work are written and not opened to members, so members read the settings without them.",
      "The term on each seat cannot be changed from the canvas yet. Seat terms are set on each seat.",
    ]);
    expect(gaps[1].href).toBe("/roles");

    const withDraft = gapFacts({
      block: block("team", ["membership"]),
      answer: { sections: [{ id: "membership", title: "Membership", readable: true, status: "proposed", body: "Three vouches." }] },
      doors,
      proposals: [proposal({ blockId: "team", target: "setting", sectionId: null, door: "dial:membership.vouches_required", change: { value: "3" } })],
    });
    expect(withDraft.map((g) => g.text)).toEqual([
      "The words under Membership are a draft nobody has adopted yet, while the settings behind this block, listed below, already work as they are set today.",
      "Sage suggested a change to how many vouches admit a new member. Until it is decided, the setting stays as it is.",
    ]);
  });

  it("sets the purpose statement against the purpose words, both ways", () => {
    const none = gapFacts({
      block: block("purpose", ["aims", "vision"]),
      answer: {
        sections: [
          { id: "aims", title: "Aims", readable: true, status: "confirmed", body: "Homes." },
          { id: "vision", title: "Vision", readable: true, status: "blank" },
        ],
        purposeStatement: null,
      },
      doors: [],
      proposals: [],
    });
    expect(none.map((g) => g.text)).toEqual(["The village has adopted words under Aims, and its governing purpose statement is not written yet."]);
    const written = gapFacts({
      block: block("purpose", ["aims", "vision"]),
      answer: {
        sections: [
          { id: "aims", title: "Aims", readable: true, status: "confirmed", body: "Homes." },
          { id: "vision", title: "Vision", readable: true, status: "blank" },
        ],
        purposeStatement: { statement: "We exist to...", writtenAt: "2026-10-01T00:00:00.000Z" },
      },
      doors: [],
      proposals: [],
    });
    expect(written.map((g) => g.text)).toEqual(["The governing purpose statement is written, and nothing is written yet under Vision."]);
  });

  it("says nothing where the words are adopted and no setting is behind the block", () => {
    expect(
      gapFacts({
        block: block("impact", ["impact"]),
        answer: { sections: [{ id: "impact", title: "Impact", readable: true, status: "confirmed", body: "Soil." }] },
        doors: [],
        proposals: [],
      }),
    ).toEqual([]);
  });
});

describe("the suggestion box", () => {
  const power: Pick<BlockFramesPayload, "block" | "answer" | "doors"> = {
    block: block("power", ["decisions"]),
    answer: { sections: [{ id: "decisions", title: "Decisions", readable: true, status: "blank" }] },
    doors: [
      { id: "dial:governance.default_method", label: "How village-wide ballots decide", href: "/game-mechanics", kind: "dial", wired: true },
      { id: "module:governance", label: "Governance switched on for members", href: "/admin", kind: "module", wired: true },
    ],
  };

  it("offers each block's own aims, in order", () => {
    expect(suggestionOptions(power).map((o) => o.key)).toEqual(["words:decisions", "setting:dial:governance.default_method", "setting:module:governance", "matrix"]);
    const purpose = suggestionOptions({ block: block("purpose", ["aims", "constraints"]), answer: { sections: [] }, doors: [] });
    expect(purpose.map((o) => o.key)).toEqual(["purpose", "words:aims", "words:constraints"]);
    expect(purpose[2].label).toContain("kept with the administrators");
    const conflict = suggestionOptions({
      block: block("conflict", []),
      answer: { sections: [] },
      doors: [{ id: "exit:restorative", label: "The restorative steps", href: "/exit-policy", kind: "exit-policy", wired: true }],
    });
    expect(conflict.map((o) => o.key)).toEqual(["setting:exit:restorative"]);
  });

  it("builds bodies the route's own validator takes, sending only what was filled", () => {
    const [words, dial, mod, matrix] = suggestionOptions(power);
    const w = suggestionBody("power", words, { ...EMPTY_FIELDS, body: "We decide by consent.", servesPurpose: "a line" }, false);
    expect(w).toEqual({ blockId: "power", target: "words", body: "We decide by consent.", sectionId: "decisions" });
    expect(parseCanvasProposal(w).ok).toBe(true);

    const d = suggestionBody("power", dial, { ...EMPTY_FIELDS, body: "Consent suits us.", value: " consent ", servesPurpose: " It keeps every voice in the room while we learn how to decide together. " }, true);
    expect(d).toEqual({
      blockId: "power",
      target: "setting",
      body: "Consent suits us.",
      door: "dial:governance.default_method",
      change: { value: "consent" },
      servesPurpose: "It keeps every voice in the room while we learn how to decide together.",
    });
    expect(parseCanvasProposal(d).ok).toBe(true);

    expect(parseCanvasProposal(suggestionBody("power", mod, { ...EMPTY_FIELDS, body: "Open it.", value: "members" }, true)).ok).toBe(true);

    const m = suggestionBody("power", matrix, {
      ...EMPTY_FIELDS,
      body: "Small spending needs a home.",
      subject: "Spending under a hundred",
      approval: "The treasurer",
      consultation: "Nobody yet",
      information: "The circle",
      riskTags: "money, trust,",
    }, true);
    expect((m.change as { riskTags: string[] }).riskTags).toEqual(["money", "trust"]);
    expect(parseCanvasProposal(m).ok).toBe(true);
  });

  it("changes only the exit terms and care-door fields somebody filled, and keeps a role unless one is chosen", () => {
    const team = suggestionOptions({
      block: block("team", []),
      answer: { sections: [] },
      doors: [{ id: "exit:terms", label: "How somebody leaves", href: "/exit-policy", kind: "exit-policy", wired: true }],
    })[0];
    const t = suggestionBody("team", team, { ...EMPTY_FIELDS, body: "A month is kinder.", noticePeriodDays: "30", unwindSteps: "Talk\n\n Settle \n" }, false);
    expect(t.change).toEqual({ noticePeriodDays: 30, unwindSteps: ["Talk", "Settle"] });
    expect(parseCanvasProposal(t).ok).toBe(true);
    expect(parseCanvasProposal(suggestionBody("team", team, { ...EMPTY_FIELDS, body: "Nothing filled." }, false))).toEqual({
      ok: false,
      error: "Say which exit term this changes.",
    });

    const care = suggestionOptions({
      block: block("conflict", []),
      answer: { sections: [] },
      doors: [{ id: "exit:restorative", label: "The restorative steps", href: "/exit-policy", kind: "exit-policy", wired: true }],
    })[0];
    expect(suggestionBody("conflict", care, { ...EMPTY_FIELDS, body: "x", replyHours: "48" }, false).change).toEqual({ replyHours: 48 });
    expect(suggestionBody("conflict", care, { ...EMPTY_FIELDS, body: "x", intakeContactRole: "", coverRole: KEEP }, false).change).toEqual({ intakeContactRole: "" });
  });
});

describe("links a member can follow from See", () => {
  it("keeps every link for an administrator and drops only the administrators' pages for anybody else", () => {
    expect(followableHref("/admin?tab=modules&module=governance", true)).toBe("/admin?tab=modules&module=governance");
    expect(followableHref("/admin?tab=modules&module=governance", false)).toBeNull();
    expect(followableHref("/admin", false)).toBeNull();
    expect(followableHref("/admin/secrets", false)).toBeNull();
    expect(followableHref("/administer-land", false)).toBe("/administer-land");
    expect(followableHref("/game-mechanics", false)).toBe("/game-mechanics");
    expect(followableHref(undefined, true)).toBeNull();
    expect(ADMIN_PAGES_LINE).toBe("Set on the administrators' pages.");
  });
});

describe("what the suggestion box says will become of a suggestion", () => {
  const consequence = (birthed: boolean) =>
    pen({ pen: "consequence", how: birthed ? "ballot" : "act", who: birthed ? "any-member" : "admins", ballotBuilt: !birthed });

  it("adds nothing where the pen's own sentence is the whole truth", () => {
    expect(suggestionFate({ target: "words" }, pen())).toBeNull();
    expect(suggestionFate({ target: "setting", door: "exit:terms" }, consequence(false))).toBeNull();
    expect(suggestionFate({ target: "setting", door: "exit:restorative" }, consequence(false))).toBeNull();
    expect(suggestionFate({ target: "purpose" }, pen({ pen: "purpose", who: "admins" }))).toBeNull();
    // A dial after the Birthing: its vote is built, and the pen's sentence says the author files it.
    expect(suggestionFate({ target: "setting", door: "dial:governance.default_method" }, pen({ pen: "dial", how: "ballot", who: "any-member" }))).toBeNull();
    expect(suggestionFate({ target: "words" }, undefined)).toBeNull();
  });

  it("after the Birthing says the exit terms' and the matrix's vote is not built", () => {
    const line = "That vote is not built yet, so a suggestion here stays open until it is.";
    expect(suggestionFate({ target: "setting", door: "exit:terms" }, consequence(true))?.text).toBe(line);
    expect(suggestionFate({ target: "matrix" }, consequence(true))?.text).toBe(line);
  });

  it("after the Birthing sends the care door to the agreement's own vote, and never calls that vote unbuilt", () => {
    const fate = suggestionFate({ target: "setting", door: "exit:restorative" }, consequence(true));
    expect(fate?.text).toMatch(/^The Game has started, so the care door changes only by a vote on the whole conflict agreement/);
    expect(fate?.text).toContain("cannot be adopted from the canvas");
    expect(fate?.text).not.toMatch(/not built/);
  });

  it("after the handover sends the purpose statement to Start a proposal", () => {
    const fate = suggestionFate({ target: "purpose" }, pen({ pen: "purpose", how: "ballot", who: "any-member", youMayAdopt: true }));
    expect(fate).toMatchObject({ href: "/propose", label: "Start a proposal" });
    expect(fate?.text).toContain("cannot be adopted from the canvas");
  });
});
