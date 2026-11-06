/**
 * One set of path names, on the server: the menu and the footer names served
 * inside /api/game/config follow the village's path words (siteWords,
 * server/lib/pageMeta.ts), and the membership letter's fingerprint never reads
 * the path choices at all.
 */
import fs from "node:fs";
import path from "node:path";
import type { Pool } from "mysql2/promise";
import { describe, expect, it } from "vitest";
import { resolveVillagePathWords, servedPaths, VILLAGE_PATHS_DOCUMENT } from "../../shared/villagePaths";
import { pageVarsFrom } from "../../shared/pageContent/vars";
import { LETTER_PAGE_SECTION, letterSourceFrom } from "../../shared/membershipLetter";
import { siteWords } from "./pageMeta";
import { currentLetter } from "./membershipLetter";
import { loadVillagePaths, saveVillagePaths } from "./villagePaths";

const config = { project: { name: "Willowbrook", tagline: "", location: "", commitmentName: "Village Pledge" } };
const renamed = servedPaths(
  resolveVillagePathWords({ paths: { investor: { label: "Backer", role: "Seed Partner" }, steward: { label: "Keeper" } } }),
  pageVarsFrom(config),
);

describe("the menu and footer names a renamed path gets", () => {
  it("reach the menu, and mark the row changed so the footer says the new name too", () => {
    const words = siteWords(null, config, renamed);
    expect(words.menu["/investor"]).toEqual({ label: "Backer", subtitle: "Seed Partner" });
    expect(words.menu["/steward"]).toEqual({ label: "Keeper", subtitle: "Co-Creator" });
    expect(words.menu["/resident"]).toEqual({ label: "Resident", subtitle: "Co-Creator" });
    expect(words.menuChanged).toEqual(["/investor", "/steward"]);
  });

  it("CONTROL: a menu name the village saved stays after the rename, in the menu and the footer", () => {
    const words = siteWords({ "page-site": { menu: { pages: [{ id: "/investor", label: "Our Funders", subtitle: "Patrons" }] } } }, config, renamed);
    expect(words.menu["/investor"]).toEqual({ label: "Our Funders", subtitle: "Patrons" });
    expect(words.menuChanged).toContain("/investor");
  });

  it("with no rename, nothing is marked changed, the same answer as before path words reached the menu", () => {
    const words = siteWords(null, config, servedPaths(resolveVillagePathWords(null), pageVarsFrom(config)));
    expect(words.menuChanged).toEqual([]);
    expect(words.menu["/investor"]).toEqual({ label: "Investor", subtitle: "Capital Contributor" });
  });

  it("reads the village's saved path words from the cache Paths & Stages writes, on the very next request", async () => {
    const pool = {
      query: async (sql: string, args: unknown[] = []) => {
        if (/^\s*SELECT/i.test(sql)) {
          expect(args[0]).toBe(VILLAGE_PATHS_DOCUMENT);
          return [[]];
        }
        return [{ affectedRows: 1 }];
      },
    } as unknown as Pool;
    await loadVillagePaths(pool);
    expect(siteWords(null, config).menu["/prosperity"].label).toBe("Prosperity Creator");
    await saveVillagePaths({ paths: { "prosperity-creator": { label: "Maker" } } });
    expect(siteWords(null, config).menu["/prosperity"].label).toBe("Maker");
    expect(siteWords(null, config).menuChanged).toEqual(["/prosperity"]);
    await saveVillagePaths({});
  });
});

describe("the membership letter's version", () => {
  it("never reads the path choices: the first village's letter keeps lv-a14aa38acde23a57 whatever its choices say", () => {
    const record = (f: string) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "server/seeds/amora", f), "utf8")); // brand-ok: the first village's own records
    const village = { project: { name: "Amora", commitmentName: "Love Letter", memberName: "Amorian" }, currency: { name: "Gratitude" } }; // brand-ok: the first village's settings as production serves them
    const page = record("pages/page-love-letter.json");
    const source = (choices: unknown) =>
      letterSourceFrom(village, {
        covenant: record("pages-covenant-seed.json"),
        legal: record("brochure-legal-seed.json"),
        [LETTER_PAGE_SECTION]: { ...page, form: { ...page.form, paths: choices } },
      });
    expect(currentLetter(source(page.form.paths)).version).toBe("lv-a14aa38acde23a57");
    expect(currentLetter(source([{ id: "investor", label: "Backer / Seed Partner" }])).version).toBe("lv-a14aa38acde23a57");
    expect(currentLetter(source(undefined)).version).toBe("lv-a14aa38acde23a57");
  });
});
