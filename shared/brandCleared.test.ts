/**
 * A VILLAGE CAN CLEAR ITS TAGLINE AND ITS FOOTER LINE, AND BLANK STILL INHERITS
 * (readiness R088).
 *
 * The finding: `pick()` in `mergedConfig()` treats "" as inherit, so emptying
 * the Tagline or the Footer introduction brought back the platform's own
 * sentence and no control could say "none". The trap the fix has to step
 * around: "" is also how every untouched box is STORED (the wizard posts its
 * whole form back), so making "" mean "none" would empty every village that
 * never opened the tab. The rule is in shared/brandCleared.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "./gameConfig";
import { pageVarsFrom } from "./pageContent/vars";
import { clearedFields, isCleared, overlayOrNone, withCleared } from "./brandCleared";

const TAGLINE = GAME_CONFIG.project.tagline;
const FOOTER = GAME_CONFIG.project.footerBlurb;

describe("what the site shows for a clearable line", () => {
  it("inherits the platform default when the box is blank or absent, exactly as before", () => {
    // The empty sentinel: every untouched box is stored as "", and it must keep inheriting.
    expect(overlayOrNone({ tagline: "" }, "tagline", TAGLINE)).toBe(TAGLINE);
    expect(overlayOrNone({}, "tagline", TAGLINE)).toBe(TAGLINE);
    expect(overlayOrNone({ footerBlurb: null }, "footerBlurb", FOOTER)).toBe(FOOTER);
    expect(overlayOrNone(undefined, "footerBlurb", FOOTER)).toBe(FOOTER);
  });

  it("shows the village's own words when it typed some", () => {
    expect(overlayOrNone({ tagline: "Our own line" }, "tagline", TAGLINE)).toBe("Our own line");
  });

  it("shows nothing when the village cleared it on purpose", () => {
    expect(overlayOrNone({ tagline: "", cleared: ["tagline"] }, "tagline", TAGLINE)).toBe("");
    expect(overlayOrNone({ footerBlurb: "", cleared: ["footerBlurb"] }, "footerBlurb", FOOTER)).toBe("");
  });

  it("lets typed words beat a box ticked earlier, so a stale tick can never hide them", () => {
    expect(overlayOrNone({ tagline: "Typed later", cleared: ["tagline"] }, "tagline", TAGLINE)).toBe("Typed later");
    expect(isCleared({ tagline: "Typed later", cleared: ["tagline"] }, "tagline")).toBe(false);
  });

  it("clears only the field it names", () => {
    const project = { tagline: "", footerBlurb: "", cleared: ["tagline"] };
    expect(overlayOrNone(project, "tagline", TAGLINE)).toBe("");
    expect(overlayOrNone(project, "footerBlurb", FOOTER)).toBe(FOOTER);
  });

  it("ignores names it does not clear and a list of the wrong shape", () => {
    expect(clearedFields({ cleared: ["name", "tagline", 7] })).toEqual(["tagline"]);
    expect(clearedFields({ cleared: "tagline" })).toEqual([]);
    expect(isCleared({ name: "", cleared: ["name"] }, "name")).toBe(false);
  });
});

describe("the box that sets it", () => {
  it("clears a field by listing it and emptying it, and restores it by unlisting it", () => {
    const on = withCleared({ tagline: "old words", cleared: [] as string[] }, "tagline", true);
    expect(on).toMatchObject({ tagline: "", cleared: ["tagline"] });
    expect(overlayOrNone(on, "tagline", TAGLINE)).toBe("");
    const off = withCleared(on, "tagline", false);
    expect(off.cleared).toEqual([]);
    // Unticked with nothing typed is blank again, which inherits.
    expect(overlayOrNone(off, "tagline", TAGLINE)).toBe(TAGLINE);
  });

  it("keeps the other field's answer when one is toggled", () => {
    const both = withCleared(withCleared({}, "tagline", true), "footerBlurb", true);
    expect(both.cleared).toEqual(["tagline", "footerBlurb"]);
    expect(withCleared(both, "tagline", false).cleared).toEqual(["footerBlurb"]);
  });
});

describe("the Home headline over a cleared tagline", () => {
  it("falls back to welcoming visitors by the village's name, never to the platform slogan", () => {
    const vars = pageVarsFrom({ project: { name: "Riverbend", tagline: overlayOrNone({ tagline: "", cleared: ["tagline"] }, "tagline", TAGLINE) } } as any);
    expect(vars.tagline).toBe("Welcome to Riverbend");
    expect(vars.tagline).not.toContain(TAGLINE);
  });
});

/**
 * THE SERVER READS THROUGH THIS, and the control for the finding.
 *
 * `mergedConfig()` lives in server/index.ts, which needs a database to import,
 * so this reads the two lines it builds the tagline and the footer line from.
 * On main both were `pick(...)`, which is exactly the defect: "" in, platform
 * sentence out, and nothing a village could store to say "none".
 */
describe("mergedConfig", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "server", "index.ts"), "utf8");
  const body = source.slice(source.indexOf("function mergedConfig()"), source.indexOf("function mergedConfig()") + 4000);

  it("builds the tagline and the footer line through overlayOrNone, never pick", () => {
    expect(body).toMatch(/tagline: overlayOrNone\(brand\.project, "tagline", p\.tagline\)/);
    expect(body).toMatch(/footerBlurb: overlayOrNone\(brand\.project, "footerBlurb", p\.footerBlurb\)/);
    expect(body).not.toMatch(/tagline: pick\(/);
    expect(body).not.toMatch(/footerBlurb: pick\(/);
  });
});
