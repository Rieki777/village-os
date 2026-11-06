import { describe, expect, it } from "vitest";
import { CIRCLES_PAGE, COORDINATOR_WORD } from "./circles";
import { pageSpecForSection } from "./index";

/** Every default a spec holds, field by field. */
const defaults = () => CIRCLES_PAGE.sections.flatMap((s) => s.fields.map((f) => ({ where: `${s.id}.${f.key}`, text: f.default })));

describe("the Circles spec", () => {
  it("is registered, so Admin, Pages edits it and the save route checks it", () => {
    expect(pageSpecForSection("page-circles")).toBe(CIRCLES_PAGE);
  });

  it("lets every section after the top be hidden", () => {
    const [top, ...rest] = CIRCLES_PAGE.sections;
    expect(top.hideable).toBeFalsy();
    expect(rest.filter((s) => !s.hideable).map((s) => s.id)).toEqual([]);
  });

  it("types no circle's data: the circles, their roles and holders come from the village's rows", () => {
    expect(CIRCLES_PAGE.sections.flatMap((s) => s.lists ?? [])).toEqual([]);
  });

  it("asks for the top circle by its word, and only where the circles sit under one", () => {
    const word = `{${COORDINATOR_WORD}}`;
    for (const { where, text } of defaults()) {
      if (text.includes(word)) expect(where, where).toMatch(/[lL]inked$/);
    }
    const linked = CIRCLES_PAGE.sections.flatMap((s) => s.fields.filter((f) => /[lL]inked$/.test(f.key)));
    expect(linked.length).toBeGreaterThan(0);
    for (const f of linked) expect(f.help, f.key).toContain(word);
  });
});

describe("the Circles starter words", () => {
  /** A structure, a method or a count that belonged to one village's page, never every village's. */
  const ONE_VILLAGE = [
    /sociocra/i,
    /consent/i,
    /consensus/i,
    /\bleads?\b/i,
    /Finance/i,
    /Business Circle/i,
    /General Coordinating/i,
    /double.link/i,
    /representatives/i,
    /elected/i,
    /budget/i,
    /tyranny/i,
    /residents/i,
    /being built/i,
    /\d/,
    /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i,
  ];

  it("are true of any village: no method, no circle's name, no count", () => {
    const text = defaults().map((d) => d.text).join(" \n ");
    for (const claim of ONE_VILLAGE) expect(text, String(claim)).not.toMatch(claim);
  });

  it("name the village by its word and its top circle only by {coordinator}", () => {
    const text = defaults().map((d) => d.text).join(" ");
    expect(text).toContain("{village}");
    expect(text).toContain(`{${COORDINATOR_WORD}}`);
    expect(text).not.toMatch(/Circle\b|Council\b/);
  });
});
