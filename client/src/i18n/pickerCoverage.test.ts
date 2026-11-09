/**
 * EVERY PAGE CARRIES THE LANGUAGE SELECTOR (internal spec i18n, US2: "on
 * every page, for members and visitors").
 *
 * Most pages get it from the site header (Layout). A handful render without
 * the shell: the 404, the agent-consent page, change requests, and Admin with
 * its own header and its own sign-in gate. Before this check those pages had
 * no way to change language at all, and a Spanish speaker who landed on the
 * 404 from a stale link read English with no door out of it.
 *
 * So every page module App.tsx routes to must reach the selector through one
 * of the components below, and each of those must render it. A new page that
 * skips the shell fails here and names itself.
 *
 * What this cannot see: a page that imports Layout but has a branch that
 * renders without it. The map's app mode is the one such branch today, and it
 * is left out on purpose (the map is a full-screen artifact whose corners are
 * its own controls; where a language control goes there is a design question,
 * raised with the coordinator, not a gap this check missed).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** The components that carry the selector, and the file that must render it. */
const CARRIERS: Record<string, string> = {
  "@/components/Layout": "components/Layout.tsx",
  "@/i18n/PageLanguageBar": "i18n/PageLanguageBar.tsx",
  "@/components/admin/AdminHeader": "components/admin/AdminHeader.tsx",
};

function routedPages(app: string): string[] {
  const out = new Set<string>();
  for (const m of app.matchAll(/import\(\s*"\.\/pages\/([^"]+)"\s*\)/g)) out.add(m[1]);
  for (const m of app.matchAll(/from\s+"@\/pages\/([^"]+)"/g)) out.add(m[1]);
  return [...out].sort();
}

function pageFile(name: string): string {
  for (const rel of [`pages/${name}.tsx`, `pages/${name}/index.tsx`]) if (existsSync(join(ROOT, rel))) return rel;
  throw new Error(`App.tsx routes to pages/${name}, which has no file`);
}

function missingSelector(source: string): boolean {
  return !Object.keys(CARRIERS).some((spec) => source.includes(`from "${spec}"`));
}

describe("the language selector reaches every page (spec i18n US2)", () => {
  it("every carrier renders the LanguagePicker", () => {
    for (const file of Object.values(CARRIERS)) expect(read(file), file).toMatch(/<LanguagePicker\b/);
  });

  it("Admin's own sign-in gate carries it too (Admin renders the gate, not the header, until signed in)", () => {
    for (const f of ["components/admin/AdminGate.tsx", "components/admin/MemberAdminView.tsx"]) expect(read(f), f).toContain('from "@/i18n/PageLanguageBar"');
  });

  it("every page App.tsx routes to imports a carrier", () => {
    const pages = routedPages(read("App.tsx"));
    expect(pages.length).toBeGreaterThan(40);
    const bare = pages.filter((p) => missingSelector(read(pageFile(p))));
    expect(bare, `these pages render no language selector: ${bare.join(", ")}`).toEqual([]);
  });

  it("control: a page with no carrier import is caught", () => {
    expect(missingSelector('import { Link } from "wouter";\nexport default function X() { return null; }')).toBe(true);
    expect(missingSelector('import Layout from "@/components/Layout";')).toBe(false);
    expect(missingSelector('import { PageLanguageBar } from "@/i18n/PageLanguageBar";')).toBe(false);
  });

  it("control: the route scan finds both lazy and direct page imports", () => {
    expect(routedPages('const A = lazyPage(() => import("./pages/Alpha"));\nimport NotFound from "@/pages/NotFound";')).toEqual(["Alpha", "NotFound"]);
  });
});
