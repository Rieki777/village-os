/**
 * The powers page says who holds what, and puts no number on the page (0098).
 *
 * R55, the founder's ruling: the handover is a journey to celebrate and never
 * a scorecard to fail. A village holding two powers is young, and this page
 * has to feel good to a two-week-old village and a two-year-old one alike.
 * The inverse index is exactly the artifact that becomes a scorecard if it is
 * rendered carelessly, and "2 of 12 - 17%" is one careless afternoon away at
 * all times.
 *
 * Two halves. The sentences are pure and get exercised branch by branch. The
 * page itself is read as TEXT, which is what this repo's client tests can do
 * (there is no jsdom: vitest runs in a node environment and the client half of
 * the suite is pure logic). Reading the file is weaker than rendering it and
 * it catches the thing that actually happens, which is somebody typing a
 * percentage into a template.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { holderSentence, inFamilies, namesSentence, suggestionSentence, type PowerRow } from "./powersCopy";

const PAGE = fs.readFileSync(
  path.join(process.cwd(), "client", "src", "pages", "Powers.tsx"),
  "utf8",
);

/** The page with its own explanatory header stripped: only shipped markup. */
const BODY = PAGE.slice(PAGE.indexOf("import Layout"));

const power = (over: Partial<PowerRow> = {}): PowerRow => ({
  capability: "library.keep",
  title: "The shared library",
  surface: "What comes in and what goes out on loan",
  consequence: "keep the shared library",
  movable: true,
  heldBy: null,
  ...over,
});

describe("no number on the page", () => {
  it("carries no percent sign", () => {
    expect(BODY).not.toContain("%");
  });

  it("carries no N of M", () => {
    expect(BODY).not.toMatch(/\b\d+\s+of\s+\d+\b/);
    expect(BODY).not.toMatch(/\{[^}]*\}\s+of\s+\{/);
  });

  it("carries no progress display", () => {
    // `MoonProgress mode="progress"` is a COMPLETION vocabulary with an
    // implied hundred percent, and `value={2/12}` is a seventeen percent
    // readout of a village's life. VoteResult's header already refuses the
    // moon for this exact reason and the argument transfers verbatim.
    expect(BODY).not.toMatch(/MoonProgress|ProgressBar|<Progress\b|role="progressbar"/);
    expect(BODY).not.toMatch(/mode="progress"/);
  });

  it("computes no total, length or count off the list", () => {
    // The quiet version of the same defect: "3 powers held" needs no percent
    // sign at all.
    expect(BODY).not.toMatch(/powers\.length|powers\.filter|\.length\}/);
  });

  it("never sorts or groups by who holds what", () => {
    // The order arrives from the server's registry and is identical for a
    // village holding none of these and a village holding every one. Sorting
    // by held and unheld draws a completion bar out of a plain list.
    expect(BODY).not.toMatch(/\.sort\(|\.filter\(\s*\(?\w+\)?\s*=>\s*\w+\.heldBy/);
  });

  it("renders one list and never a held section beside an unheld one", () => {
    expect(BODY.match(/data-testid="powers-list"/g)).toHaveLength(1);
  });
});

describe("who holds this, in one sentence", () => {
  it("says the scaffolding has it, and that the village could take it", () => {
    expect(holderSentence(power())).toBe(
      "The admin panel looks after this one. It is one the village can take on.",
    );
  });

  it("says nothing about taking on a power that cannot move", () => {
    // No nag, and no invitation to something the product cannot deliver.
    expect(holderSentence(power({ movable: false }))).toBe("The admin panel looks after this one.");
  });

  it("names the role and the person sitting in it", () => {
    expect(
      holderSentence(power({ heldBy: { roleName: "The Library Keepers", byBallot: true, people: ["Ana"] } })),
    ).toBe("The Library Keepers (Ana) holds this.");
  });

  it("names several holders by first name, in the role's parentheses", () => {
    expect(holderSentence(power({ heldBy: { roleName: "Steward Circle", byBallot: false, people: ["Bea", "Sam"] } }))).toBe(
      "Steward Circle (Bea and Sam) holds this.",
    );
  });

  it("says plainly when a power the village took on has nobody in the chair", () => {
    expect(
      holderSentence(power({ heldBy: { roleName: "The Library Keepers", byBallot: true, people: [] } })),
    ).toBe("The Library Keepers holds this, and nobody is sitting there yet.");
  });

  it("carries no digit in any branch", () => {
    const branches = [
      holderSentence(power()),
      holderSentence(power({ movable: false })),
      holderSentence(power({ heldBy: { roleName: "R", byBallot: false, people: [] } })),
      holderSentence(power({ heldBy: { roleName: "R", byBallot: false, people: ["A", "B", "C"] } })),
    ];
    for (const s of branches) expect(s, s).not.toMatch(/\d/);
  });
});

describe("names read out loud", () => {
  it("handles one, two and many", () => {
    expect(namesSentence(["Ana"])).toBe("Ana");
    expect(namesSentence(["Ana", "Ben"])).toBe("Ana and Ben");
    expect(namesSentence(["Ana", "Ben", "Cal"])).toBe("Ana, Ben and Cal");
  });

  it("says nothing at all when there is nobody, rather than an empty list", () => {
    expect(namesSentence([])).toBe("");
  });
});

describe("role powers (2026-11-05): a power a role carries is never the panel's", () => {
  it("names who holds it today through a role, the house way", () => {
    expect(holderSentence(power({ heldToday: ["Ops lead (Rye)"] }))).toBe("Ops lead (Rye) holds this today, for the stewards.");
    expect(holderSentence(power({ heldToday: ["Ops lead (Rye)", "Steward Circle (Sam)"] }))).toBe(
      "Ops lead (Rye) and Steward Circle (Sam) hold this today, for the stewards.",
    );
  });

  it("control: with nobody holding it through a role, the panel sentence stands", () => {
    expect(holderSentence(power({ heldToday: [] }))).toBe("The admin panel looks after this one. It is one the village can take on.");
  });

  it("the village holding it still wins over who held it before", () => {
    expect(holderSentence(power({ heldToday: ["Ops lead (Rye)"], heldBy: { roleName: "Library keepers", byBallot: false, people: ["Ana"] } }))).toBe(
      "Library keepers (Ana) holds this.",
    );
  });

  it("says who holds a stage power without calling a guest a member", () => {
    expect(holderSentence(power({ stage: "Guest", movable: false }))).toBe("Everyone at the Guest stage or past it holds this.");
  });

  it("says where a suggestion goes", () => {
    expect(suggestionSentence(power({ suggestionsGoTo: "holders" }))).toBe("A suggested change to this goes to its holders to review.");
    expect(suggestionSentence(power({ suggestionsGoTo: "vote" }))).toBe("A suggested change to this goes to a village vote.");
  });

  it("groups by family in the families' order, the same whoever holds what", () => {
    const fams = [{ id: "structure", title: "Structure" }, { id: "gatherings", title: "Gatherings" }];
    const a = power({ capability: "event.manage", family: "gatherings" });
    const b = power({ capability: "org.seat", family: "structure", heldToday: ["Ops lead (Rye)"] });
    const c = power({ capability: "library.keep", family: "gatherings", heldBy: { roleName: "Keepers", byBallot: true, people: [] } });
    const grouped = inFamilies([a, b, c], fams);
    expect(grouped.map((f) => [f.id, f.powers.map((p) => p.capability)])).toEqual([
      ["structure", ["org.seat"]],
      ["gatherings", ["event.manage", "library.keep"]],
    ]);
    const unheld = inFamilies([a, { ...b, heldToday: [] }, { ...c, heldBy: null }], fams);
    expect(unheld.map((f) => f.powers.map((p) => p.capability))).toEqual(grouped.map((f) => f.powers.map((p) => p.capability)));
  });
});
