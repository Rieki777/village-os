/**
 * What a canvas suggestion may aim at, which pen covers it, and when it
 * carries a purpose line, without a database. The route suite
 * (server/routes/canvasFrames.test.ts) proves the same rules over HTTP; these
 * pin the vocabulary the form and the route share.
 */
import { describe, expect, it } from "vitest";
import {
  CANVAS_DOOR_IDS,
  CANVAS_DOORS,
  doorsForBlock,
  parseCanvasProposal,
  parseMatrixRow,
  penForProposal,
  servesPurposeProblem,
  servesPurposeScoped,
  UNWIRED_DOORS,
} from "./canvasFrames";
import { CANVAS_BLOCK_IDS, CANVAS_BLOCKS } from "./governanceCanvas";
import { PURPOSE_EXAMPLE } from "./governingPurpose";
import { VARIABLES_BY_KEY } from "./gameVariables";

const LINE = "This lets the village admit people it already knows, which serves the purpose of deciding together in the open.";

describe("the setting doors", () => {
  it("every wired door names a real block, and every dial door a real dial", () => {
    for (const id of CANVAS_DOOR_IDS) {
      const d = CANVAS_DOORS[id];
      expect(d.id).toBe(id);
      expect(CANVAS_BLOCK_IDS).toContain(d.block);
      if (d.kind === "dial") expect(VARIABLES_BY_KEY[String(d.dialKey)], id).toBeTruthy();
    }
  });

  it("maps plan 2.3's table: Team, Power, Conflict and Resourcing write; Roles, Meetings and Power's switch link out", () => {
    expect(doorsForBlock("team").map((d) => d.id)).toEqual(["dial:membership.vouches_required", "exit:terms"]);
    expect(doorsForBlock("power").map((d) => d.id)).toEqual(["dial:governance.default_method"]);
    expect(doorsForBlock("conflict").map((d) => d.id)).toEqual(["exit:restorative"]);
    expect(doorsForBlock("resourcing").map((d) => d.id)).toEqual(["dial:ledger.admin_mint_cycle_cap"]);
    expect(UNWIRED_DOORS.map((d) => d.block)).toEqual(["roles", "meetings", "power"]);
    for (const quiet of ["stakeholders", "coordination", "learning", "legal", "impact"] as const) {
      expect(doorsForBlock(quiet), quiet).toEqual([]);
    }
  });
});

describe("parsing a suggestion", () => {
  it("takes words for a section the block draws on, and nothing else", () => {
    const ok = parseCanvasProposal({ blockId: "team", sectionId: "membership", body: "Two vouches." });
    expect(ok).toEqual({
      ok: true,
      proposal: { blockId: "team", target: "words", sectionId: "membership", door: null, change: null, body: "Two vouches.", source: "member" },
    });
    expect(parseCanvasProposal({ blockId: "team", sectionId: "economy", body: "Two vouches." })).toEqual({ ok: false, error: "Team does not draw on that section." });
    expect(parseCanvasProposal({ blockId: "nope", body: "Two vouches." }).ok).toBe(false);
    expect(parseCanvasProposal({ blockId: "team", sectionId: "membership", body: " " }).ok).toBe(false);
  });

  it("sends a block with no section of its own to where its words live", () => {
    const r = parseCanvasProposal({ blockId: "conflict", body: "Talk first." });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain(String(CANVAS_BLOCKS.conflict.elsewhere?.note));
  });

  it("holds the purpose statement to its own validator, on the Purpose block only", () => {
    expect(parseCanvasProposal({ blockId: "purpose", target: "purpose", body: PURPOSE_EXAMPLE }).ok).toBe(true);
    expect(parseCanvasProposal({ blockId: "purpose", target: "purpose", body: "We grow food." }).ok).toBe(false);
    expect(parseCanvasProposal({ blockId: "team", target: "purpose", body: PURPOSE_EXAMPLE }).ok).toBe(false);
  });

  it("takes a setting only through one of the block's own doors, with a value", () => {
    const dial = parseCanvasProposal({ blockId: "team", target: "setting", door: "dial:membership.vouches_required", change: { value: 4 }, body: "Four." });
    expect(dial.ok && dial.proposal.change).toEqual({ value: "4" });
    expect(parseCanvasProposal({ blockId: "power", target: "setting", door: "dial:membership.vouches_required", change: { value: "4" }, body: "Four." }).ok).toBe(false);
    expect(parseCanvasProposal({ blockId: "team", target: "setting", door: "dial:membership.vouches_required", change: {}, body: "Four." }).ok).toBe(false);
    const roles = parseCanvasProposal({ blockId: "roles", target: "setting", body: "A year." });
    expect(!roles.ok && roles.error).toContain("Seat terms");
  });

  it("reads an exit-policy door's change field by field, and refuses an empty one", () => {
    const r = parseCanvasProposal({
      blockId: "conflict", target: "setting", door: "exit:restorative", body: "Ours.",
      change: { steps: ["One", " ", "Two"], intakeContactRole: "care", replyHours: 48, ignored: true },
    });
    expect(r.ok && r.proposal.change).toEqual({ steps: ["One", "Two"], intakeContactRole: "care", replyHours: 48 });
    expect(parseCanvasProposal({ blockId: "conflict", target: "setting", door: "exit:restorative", body: "Ours.", change: {} }).ok).toBe(false);
    expect(parseCanvasProposal({ blockId: "team", target: "setting", door: "exit:terms", body: "Ours.", change: { valuationMethod: "" } }).ok).toBe(false);
    expect(parseCanvasProposal({ blockId: "team", target: "setting", door: "exit:terms", body: "Ours.", change: { noticePeriodDays: 14 } }).ok).toBe(true);
  });

  it("keeps the matrix on the Power block and holds its row to the columns", () => {
    const change = { subject: "Spending", approval: "The treasurer", consultation: "Nobody yet", information: "Everyone", riskTags: ["money", "money"] };
    const r = parseCanvasProposal({ blockId: "power", target: "matrix", body: "Who spends.", change });
    expect(r.ok && r.proposal.change).toEqual({ subject: "Spending", approval: "The treasurer", consultation: "Nobody yet", information: "Everyone", method: "", riskTags: ["money"] });
    expect(parseCanvasProposal({ blockId: "team", target: "matrix", body: "Who spends.", change }).ok).toBe(false);
    expect(parseMatrixRow({ ...change, approval: "" }).ok).toBe(false);
    expect(parseMatrixRow({ ...change, riskTags: ["a,b"] }).ok).toBe(false);
    expect(parseMatrixRow({ ...change, rowId: "x" }).ok).toBe(false);
  });
});

describe("the purpose line (GPS ruling 1's scoping)", () => {
  it("exists on the Power, Conflict, Roles and Resourcing answers and the matrix, and nowhere else", () => {
    const scoped = CANVAS_BLOCK_IDS.filter((b) => servesPurposeScoped(b, "words"));
    expect(scoped).toEqual(["roles", "power", "conflict", "resourcing"]);
    expect(servesPurposeScoped("team", "matrix")).toBe(true);
  });

  it("is refused where it does not exist, demanded where it does once a statement is written, and welcome before", () => {
    expect(servesPurposeProblem(false, LINE, true)).toContain("carries no line");
    expect(servesPurposeProblem(false, "", true)).toBeNull();
    expect(servesPurposeProblem(true, "", false)).toBeNull();
    expect(servesPurposeProblem(true, "", true)).toContain("how it serves the governing purpose");
    expect(servesPurposeProblem(true, "It helps.", true)).toContain("12 words");
    expect(servesPurposeProblem(true, LINE, true)).toBeNull();
  });
});

describe("which pen a suggestion needs", () => {
  it("reads the target, the door and the section", () => {
    expect(penForProposal({ target: "words", sectionId: "membership" })).toBe("prose");
    for (const s of ["people", "legal", "land", "constraints"]) expect(penForProposal({ target: "words", sectionId: s }), s).toBe("admin");
    expect(penForProposal({ target: "purpose" })).toBe("purpose");
    expect(penForProposal({ target: "matrix" })).toBe("consequence");
    expect(penForProposal({ target: "setting", door: "dial:governance.default_method" })).toBe("dial");
    expect(penForProposal({ target: "setting", door: "exit:restorative" })).toBe("consequence");
    expect(penForProposal({ target: "setting", door: "exit:terms" })).toBe("consequence");
  });
});
