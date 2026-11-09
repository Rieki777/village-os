/**
 * THE ANTHROPIC KEY NEVER REACHES THE CLIENT BUNDLE (the Admin helper, 2026-11-09).
 *
 * A value can only reach the browser's bundle three ways, and each is held here:
 *
 *   1. Vite inlines `import.meta.env.X` for X matching `envPrefix`, which is
 *      `VITE_` unless vite.config.ts says otherwise. So the config must not
 *      widen it to a prefix the key matches, and must not `define` anything
 *      read from an ANTHROPIC variable.
 *   2. Client or shared code reading the variable by name through
 *      `import.meta.env` or `process.env`.
 *   3. A route handing it over. The helper's status route answers `{ on, guide }`
 *      and nothing else (server/routes/adminHelper.test.ts holds that).
 *
 * The variable's NAME may appear in client copy (the panel tells an admin what
 * to call it in Railway); its VALUE never can.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walk(full, out);
    } else if (/\.(ts|tsx|mjs|js)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

describe("the Anthropic key stays on the server", () => {
  it("vite exposes only VITE_ variables and defines nothing from an ANTHROPIC variable", () => {
    const config = fs.readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");
    const prefix = /envPrefix\s*:\s*([^,\n}]+)/.exec(config)?.[1] ?? '"VITE_"';
    expect(prefix).not.toMatch(/ANTHROPIC|""|''|\[\s*\]/);
    expect(config).not.toMatch(/ANTHROPIC/);
  });

  it("no client or shared code reads an ANTHROPIC variable from the environment", () => {
    const files = [...walk(path.join(ROOT, "client", "src")), ...walk(path.join(ROOT, "shared"))];
    expect(files.length).toBeGreaterThan(100);
    const readers = files.filter((f) =>
      /(import\.meta\.env|process\.env)\s*(\.\s*|\[\s*["'`])\w*ANTHROPIC/.test(fs.readFileSync(f, "utf8")),
    );
    expect(readers.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("the helper's client files never ask the server for the key", () => {
    const dir = path.join(ROOT, "client", "src", "components", "admin");
    for (const name of ["adminHelperApi.ts", "AdminHelperPanel.tsx", "AdminHelperHost.tsx"]) {
      const src = fs.readFileSync(path.join(dir, name), "utf8");
      expect(src, name).not.toMatch(/\/secrets|assistant_api_key|x-api-key/i);
    }
  });
});
