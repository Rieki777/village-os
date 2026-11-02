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
