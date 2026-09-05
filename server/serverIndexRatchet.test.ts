/**
 * Proof that scripts/check-server-index-size.mjs is a real ratchet.
 *
 * A guard nobody has watched fail is a guard nobody knows works. The two
 * properties that matter here are (1) it REFUSES to raise its own baseline,
 * which is the whole reason it exists, and (2) it counts routes correctly on
 * the exact shapes that broke the first two drafts of it. Both are asserted
 * against the real shipped script, not a copy of its logic.
 *
 * The script resolves its own root as `dirname(import.meta.url)/..`, so a
 * fixture run is just the script copied into `<tmp>/scripts/` beside a
 * `<tmp>/server/index.ts`. Nothing about the script changes to make it
 * testable, which is the point: the thing under test is the thing that ships.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "check-server-index-size.mjs");

type Run = { status: number; stdout: string; stderr: string };

function runIn(root: string, args: string[] = []): Run {
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "check-server-index-size.mjs"), ...args], {
    encoding: "utf8",
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** A throwaway repo root holding the real script, an index.ts and a baseline. */
function makeFixture(indexSource: string, baseline: { lines: number; routes: number } | null): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "index-ratchet-"));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "server"), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(root, "scripts", "check-server-index-size.mjs"));
  fs.writeFileSync(path.join(root, "server", "index.ts"), indexSource);
  if (baseline) {
    fs.writeFileSync(path.join(root, "scripts", "server-index-size-baseline.json"), JSON.stringify(baseline));
  }
  return root;
}

const fixtures: string[] = [];
const fixture = (src: string, baseline: { lines: number; routes: number } | null): string => {
  const root = makeFixture(src, baseline);
  fixtures.push(root);
  return root;
};

afterAll(() => {
  for (const f of fixtures) fs.rmSync(f, { recursive: true, force: true });
});

describe("the server/index.ts ratchet refuses to turn the wrong way", () => {
  it("fails the gate when the file grew past its baseline", () => {
    const src = ['app.get("/a", h);', 'app.post("/b", h);', 'app.put("/c", h);', ""].join("\n");
    const root = fixture(src, { lines: 1, routes: 1 });
    const r = runIn(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("SERVER INDEX RATCHET FAILED");
    expect(r.stderr).toContain("baseline allows 1");
  });

  it("REFUSES --update-baseline when that would raise the number, and leaves the file untouched", () => {
    const src = ['app.get("/a", h);', 'app.post("/b", h);', ""].join("\n");
    const root = fixture(src, { lines: 1, routes: 1 });
    const baselinePath = path.join(root, "scripts", "server-index-size-baseline.json");
    const before = fs.readFileSync(baselinePath, "utf8");

    const r = runIn(root, ["--update-baseline"]);

    expect(r.status).toBe(1);
    expect(r.stderr).toContain("refusing to raise the server/index.ts baseline");
    // The refusal is worth nothing if it wrote the number anyway.
    expect(fs.readFileSync(baselinePath, "utf8")).toBe(before);
  });

  it("refuses a raise even when only ONE of the two numbers went up", () => {
    // Fewer lines than the baseline, more routes. A lines-only ratchet would
    // wave this through, which is exactly why routes are counted separately.
    const src = ['app.get("/a", h);', 'app.post("/b", h);', ""].join("\n");
    const root = fixture(src, { lines: 900, routes: 1 });
    const r = runIn(root, ["--update-baseline"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("routes 2 is above the recorded 1");
  });

  it("allows --update-baseline downward, and writes the lower numbers", () => {
    const src = ['app.get("/a", h);', ""].join("\n");
    const root = fixture(src, { lines: 500, routes: 40 });
    const r = runIn(root, ["--update-baseline"]);
    expect(r.status).toBe(0);
    const written = JSON.parse(fs.readFileSync(path.join(root, "scripts", "server-index-size-baseline.json"), "utf8"));
    expect(written).toEqual({ lines: 1, routes: 1 });
  });

  it("caps a new server/routes module so the monolith cannot just move house", () => {
    const root = fixture('app.get("/a", h);\n', { lines: 1, routes: 1 });
    fs.mkdirSync(path.join(root, "server", "routes"), { recursive: true });
    fs.writeFileSync(path.join(root, "server", "routes", "huge.ts"), `${"// filler\n".repeat(2500)}`);
    const r = runIn(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("over the 2000-line cap");
  });
});

describe("it counts routes on the shapes that broke the earlier drafts", () => {
  const countRoutes = (src: string): number => {
    const root = fixture(src, { lines: 100000, routes: 100000 });
    const r = runIn(root, ["--json"]);
    return JSON.parse(r.stdout.trim().split("\n")[0]).current.routes;
  };

  it("does not treat a wildcard path string as the start of a block comment", () => {
    // `"/assets/*"` and `"/org/*"` were real registrations in server/index.ts
    // until the Express 5 upgrade renamed them; the shape still has to parse,
    // because a fork or an older branch can carry it.
    // The naive per-line block tracker read the last two characters of those
    // PATH STRINGS as a comment opener that never closed, and silently lost
    // every route after them. It reported 557 where there were 560.
    const src = [
      'app.get("/assets/*", handler);',
      'app.get("/org/*", handler);',
      'app.get("/after-the-trap", handler);',
      "",
    ].join("\n");
    expect(countRoutes(src)).toBe(3);
  });

  it("does not lose the file to a nested backtick inside a template interpolation", () => {
    // index.ts embeds multi-line assistant prompts. A scan-to-the-next-backtick
    // reader ends the outer template on the inner one and flips code and string
    // for thousands of lines. That cost 19 routes.
    const src = [
      "const prompt = `line one",
      "line two ${obj[`key`]} still inside the template",
      'not a route: app.get("/decoy", h)',
      "`;",
      'app.get("/real", handler);',
      "",
    ].join("\n");
    expect(countRoutes(src)).toBe(1);
  });

  it("still ignores a registration written inside a comment", () => {
    const src = [
      "/*",
      ' * Express matches app.get("/api/modules") exactly, so',
      " */",
      '// app.get("/commented-out", handler);',
      'app.get("/real", handler);',
      "",
    ].join("\n");
    expect(countRoutes(src)).toBe(1);
  });

  it("is not derailed by a regex literal holding a quote or a slash", () => {
    const src = [
      "const q = /[\"']/;",
      "const p = /a[/]b/;",
      'app.get("/real", handler);',
      "",
    ].join("\n");
    expect(countRoutes(src)).toBe(1);
  });

  it("counts lines the way wc -l does", () => {
    const root = fixture("a\nb\nc\n", { lines: 100000, routes: 100000 });
    const r = runIn(root, ["--json"]);
    expect(JSON.parse(r.stdout.trim().split("\n")[0]).current.lines).toBe(3);
  });
});

describe("the committed baseline describes the real file", () => {
  it("passes against the repository as it stands", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});
