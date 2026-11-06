/**
 * EVERY ROUTE THAT SERVES THE MAP ARTIFACT PASSES THE MAP GATE (readiness R056).
 *
 * The control for the finding, read off the source because the shape of the
 * defect was WHERE a route was registered: three plain `app.get` calls in
 * server/index.ts that no module gate stood in front of, while `/api/map` beside
 * them was gated. grounds.test.ts proves the gated handlers behave; this proves
 * no other registration of a `/grounds/` path exists to walk around them, and
 * that each one in the gated module names its gate.
 *
 * It reads registrations (`app.get(` and friends with a `/grounds` path), not
 * every mention of the word: robots.txt disallowing `/grounds/` and the
 * security headers matching the two URLs are not routes.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const SERVER = path.resolve(__dirname, "..");
const HOME = path.join("server", "routes", "grounds.ts");
const REGISTRATION = /\bapp\.(get|use|all|head)\(\s*["'`]\/grounds[^"'`]*["'`]([^\n]*)/g;

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") sources(full, out);
    } else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const registrations = sources(SERVER).flatMap((file) => {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(path.resolve(SERVER, ".."), file);
  return [...text.matchAll(REGISTRATION)].map((m) => ({
    where: `${rel}:${text.slice(0, m.index).split("\n").length}`,
    file: rel,
    rest: m[2],
  }));
});

describe("the map artifact's routes", () => {
  it("are registered only in the gated module", () => {
    const outside = registrations.filter((r) => r.file !== HOME).map((r) => r.where);
    expect(outside, "a /grounds route registered with no map gate in front of it").toEqual([]);
  });

  it("each name the map gate as their first handler", () => {
    const home = registrations.filter((r) => r.file === HOME);
    expect(home.map((r) => r.where)).toHaveLength(3);
    for (const r of home) {
      expect(r.rest, r.where).toMatch(/^,\s*(mapNotOff|requireModule\("map"\)),/);
    }
  });

  it("are mounted by server/index.ts", () => {
    const index = fs.readFileSync(path.join(SERVER, "index.ts"), "utf8");
    expect(index).toMatch(/import \{ register as registerGroundsRoutes \} from "\.\/routes\/grounds";/);
    expect(index).toMatch(/^\s*registerGroundsRoutes\(app, /m);
  });
});
