import { describe, expect, it } from "vitest";
import { CANVAS_BLOCK_IDS, CANVAS_BLOCKS } from "./governanceCanvas";
import {
  ANYONE_MAY_RAISE,
  KEY_MOMENTS,
  MOMENT_BLOCKS,
  MOMENT_POWER,
  MOMENT_TRIGGERS,
  PUBLIC_CANVAS_PATH,
  blocksForRaise,
  canvasMoonLine,
  momentOfTrigger,
  revisitBody,
  revisitDedupeKey,
  revisitLink,
  revisitTitle,
  type RevisitAudience,
} from "./canvasRevisit";

const AUDIENCES: RevisitAudience[] = ["live-holders", "every-member", "admins", "care-holders"];

describe("the four key moments", () => {
  it("gives every trigger exactly one moment", () => {
    const seen = new Map<string, string>();
    for (const moment of KEY_MOMENTS) {
      for (const t of MOMENT_TRIGGERS[moment]) {
        expect(seen.has(t), `${t} belongs to two moments`).toBe(false);
        seen.set(t, moment);
        expect(momentOfTrigger(t)).toBe(moment);
      }
    }
    // Three, two, three and three: tension-opened is named for Wave 5 and has no call site yet.
    expect(seen.size).toBe(11);
    expect(momentOfTrigger("a-circle-was-painted")).toBeNull();
  });

  it("asks the blocks the plan names, in canvas order", () => {
    expect(MOMENT_BLOCKS.collaboration).toEqual(CANVAS_BLOCK_IDS);
    expect(MOMENT_BLOCKS.partners).toEqual(["stakeholders"]);
    expect(MOMENT_BLOCKS.conflict).toEqual(["conflict"]);
    expect(MOMENT_BLOCKS.funding).toEqual(["power", "resourcing", "legal", "impact"]);
  });

  it("follows the canvas pen for three moments and the care role for conflict", () => {
    expect(MOMENT_POWER).toEqual({ collaboration: "story.tell", partners: "story.tell", conflict: "care", funding: "story.tell" });
  });

  it("lets a scope narrow a moment's blocks and never widen them", () => {
    expect(blocksForRaise("collaboration", ["power", "team"])).toEqual(["team", "power"]);
    // A block outside the moment's own list is dropped, and a scope that
    // names nothing the moment asks about falls back to the moment's list.
    expect(blocksForRaise("funding", ["power", "team"])).toEqual(["power"]);
    expect(blocksForRaise("partners", ["team"])).toEqual(["stakeholders"]);
    expect(blocksForRaise("funding", [])).toEqual(["power", "resourcing", "legal", "impact"]);
    expect(blocksForRaise("funding", null)).toEqual(["power", "resourcing", "legal", "impact"]);
  });
});

describe("what a notice says", () => {
  it("asks the partners question in the plan's own words", () => {
    expect(revisitTitle("partners", "stakeholders")).toBe("A new partner arrived. Does our Stakeholders answer still hold?");
    expect(revisitBody("partners", "live-holders")).toContain("Nothing was sent to them");
    expect(revisitBody("partners", "live-holders")).toContain(PUBLIC_CANVAS_PATH);
  });

  it("names the block and asks the moment's question, for every moment and block", () => {
    for (const moment of KEY_MOMENTS) {
      for (const block of MOMENT_BLOCKS[moment]) {
        const title = revisitTitle(moment, block);
        expect(title).toContain(CANVAS_BLOCKS[block].name);
        expect(title.length).toBeLessThanOrEqual(255);
      }
    }
    expect(revisitTitle("funding", "legal")).toBe("Before you raise: look at Legal again.");
    expect(revisitTitle("conflict", "conflict")).toBe("Is the pathway holding? Look at Conflict again.");
    expect(revisitTitle("collaboration", "purpose")).toBe("Something new is starting. Look at Purpose again.");
  });

  /*
   * A claimed instance's canvas is empty by construction, and the claim is a
   * collaboration moment, so these words reach a founder about blocks nobody
   * has answered: they may not presume an answer exists (audit of Wave 4,
   * 2026-10-01). The partners line is the plan's own wording and stays.
   */
  it("presumes no answer exists, outside the partners line the plan words", () => {
    for (const moment of KEY_MOMENTS.filter((m) => m !== "partners")) {
      for (const block of MOMENT_BLOCKS[moment]) {
        expect(revisitTitle(moment, block), `${moment} ${block}`).not.toMatch(/answer/i);
      }
      for (const audience of AUDIENCES) {
        expect(revisitBody(moment, audience), `${moment} ${audience}`).not.toMatch(/its answers again|still holds?/i);
      }
    }
  });

  it("carries no digit and no dash anywhere, so no count and no date can hide in one", () => {
    for (const moment of KEY_MOMENTS) {
      for (const audience of AUDIENCES) {
        const body = revisitBody(moment, audience);
        expect(body, `${moment}/${audience}`).not.toMatch(/\d/);
        expect(body).not.toMatch(/[–—]/);
      }
      for (const block of MOMENT_BLOCKS[moment]) {
        expect(revisitTitle(moment, block)).not.toMatch(/[\d–—]/);
      }
    }
  });

  it("tells every member that anyone may raise it, and tells nobody else that", () => {
    for (const moment of KEY_MOMENTS) {
      expect(revisitBody(moment, "every-member")).toContain(ANYONE_MAY_RAISE);
      for (const audience of AUDIENCES.filter((a) => a !== "every-member")) {
        expect(revisitBody(moment, audience)).not.toContain(ANYONE_MAY_RAISE);
      }
    }
  });

  it("opens the block's own card on the Canvas view", () => {
    expect(revisitLink("power")).toBe("/journey-to-launch?view=canvas#canvas-block-power");
  });

  it("keys a row by moment, block, moon and person, so a repeat inside one moon is one row", () => {
    expect(revisitDedupeKey("funding", "power", 331, "usr-1")).toBe("canvas_revisit:funding:power:331:usr-1");
    expect(revisitDedupeKey("funding", "power", 331, "usr-1")).not.toBe(revisitDedupeKey("funding", "power", 332, "usr-1"));
    expect(revisitDedupeKey("funding", "power", 331, "usr-1")).not.toBe(revisitDedupeKey("collaboration", "power", 331, "usr-1"));
  });
});

describe("the canvas moon's one line", () => {
  it("names block titles and nothing else", () => {
    expect(canvasMoonLine(["Stakeholders"])).toBe("The canvas moon looks at Stakeholders.");
    expect(canvasMoonLine(["Power", "Resourcing", "Legal"])).toBe("The canvas moon looks at Power, Resourcing and Legal.");
    expect(canvasMoonLine(CANVAS_BLOCK_IDS.map((b) => CANVAS_BLOCKS[b].name))).toBe(
      "The canvas moon looks at all twelve blocks together.",
    );
  });

  it("says nothing when there is nothing to name", () => {
    expect(canvasMoonLine([])).toBeNull();
    expect(canvasMoonLine(["  ", ""])).toBeNull();
  });
});
