/**
 * THE CIRCLES TAB OPENS THE REAL ORG CHART, AND KEEPS OPENING IT.
 *
 * `docs/prototypes/grounds-v0.html` is a 9,000-line self-contained artifact
 * that the map workstream owns and regenerates. That is the risk this file
 * exists for: two of the assertions below are decisions made by the person
 * this village belongs to, and a regeneration that dropped them would revert
 * them silently, on a surface nobody diffs because it is one enormous file.
 *
 * The decisions:
 *
 *   1. The top-left Circles selector hands off to `/map/circles`. It used to
 *      draw the artifact's own halo-and-satellite view, which cannot step
 *      inside a circle, cannot open a seat and cannot read live data,
 *      because a static file cannot. Names in it measure about 4px.
 *   2. The land's own chrome leaves in circles mode. The minimap draws a
 *      satellite plate of the terrain and the Build button edits structures
 *      on it; both answer questions the org chart is not asking.
 *
 * The artifact's own view stays reachable at `#/circles`, so this is a
 * change of front door and not a deletion.
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { describe, expect, it } from "vitest";

const ARTIFACT = path.resolve(__dirname, "../docs/prototypes/grounds-v0.html");
const html = fs.readFileSync(ARTIFACT, "utf8");

describe("the living map artifact", () => {
  it("is the file the shell mounts (the positive control)", () => {
    // If this ever stops matching, every assertion below would pass or fail
    // for the wrong reason. Fail here instead.
    expect(html.length).toBeGreaterThan(100_000);
    expect(html).toContain('id="msCircles"');
    expect(html).toContain('id="minimapWrap"');
  });

  it("parses: every inline script is valid JavaScript", () => {
    // A syntax error anywhere in here is a blank map, not a broken button.
    const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
    expect(blocks.length, "there are inline scripts to check").toBeGreaterThan(0);
    for (const [i, m] of blocks.entries()) {
      const startLine = html.slice(0, m.index).split("\n").length;
      expect(
        () => new vm.Script(m[1] ?? "", { filename: `block${i}@line${startLine}` }),
        `inline script block ${i} (line ${startLine}) parses`,
      ).not.toThrow();
    }
  });

  it("sends the Circles selector to /map/circles", () => {
    expect(html).toMatch(/\$\('msCircles'\)\.onclick\s*=[\s\S]{0,400}?\/map\/circles/);
  });

  it("routes that handoff through siteNav, like every other door out", () => {
    // siteNav is what lets the React shell upgrade the jump to SPA
    // navigation; without it the reader pays a full 4MB reload.
    expect(html).toMatch(/\$\('msCircles'\)\.onclick\s*=[\s\S]{0,400}?siteNav\(/);
  });

  it("hides the land's chrome while the circles are showing", () => {
    const rule = html.match(/body\.circles\s*:is\(([^)]*)\)\{display:none\}/);
    expect(rule, "the circles-mode hide rule is present").toBeTruthy();
    const hidden = rule?.[1] ?? "";
    expect(hidden, "the minimap goes").toContain("#minimapWrap");
    expect(hidden, "the Build button goes").toContain("#buildBtn");
  });

  it("leaves the artifact's own circles view reachable at #/circles", () => {
    // The handoff is a change of front door. Deleting the view outright
    // would break anyone deep-linked to it.
    expect(html).toContain("#/circles");
    expect(html).toContain("function buildOrgMap(");
  });
});
