import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MODULES } from "@shared/modules";

/**
 * Every module in the registry has an image, and every image has a module.
 *
 * Five were missing on production: crowdpool, governance, hypha, introductions
 * and resources. Each rendered as a broken image, because the village serves
 * its SPA shell for any missing asset, so the browser received HTML where a
 * picture should be.
 *
 * That last detail is why this test reads the FILESYSTEM rather than fetching
 * the URL. A fetch would have returned HTTP 200 for all of them: the first
 * attempt to measure this scored 19 of 19 present, and only a control (asking
 * for a module id that does not exist, and also getting 200) showed the method
 * could not tell a hit from a miss.
 *
 * Both directions are checked. An orphan image is a smaller problem than a
 * missing one, but it is the tell that a module was renamed or removed and its
 * asset was left behind.
 */

const ROOT = path.resolve(__dirname, "..", "..", "..");
const IMAGE_DIR = path.join(ROOT, "client", "public", "images", "modules");

describe("module images", () => {
  const files = fs.existsSync(IMAGE_DIR) ? fs.readdirSync(IMAGE_DIR) : [];
  const images = new Set(files.filter((f) => f.endsWith(".webp")).map((f) => f.slice(0, -5)));
  const ids = MODULES.map((m) => m.id);

  it("reads a real registry and a real image directory", () => {
    // Control. Two empty sets agree with each other perfectly, and that
    // agreement would be reported as success.
    expect(ids.length).toBeGreaterThan(10);
    expect(images.size).toBeGreaterThan(10);
  });

  /*
   * MODULES THAT SHIP THE DRAWN FALLBACK INSTEAD OF A FILE.
   *
   * Two gates in this repository meet here, and on 2026-09-15 they had no
   * overlap left. `scripts/image-budget-baseline.json` is a RATCHET: its header
   * says the number "may only ever go DOWN" and `--update-baseline` refuses to
   * raise it. Measured that day, the shipped total was 2161446 bytes against a
   * baseline of 2161446: zero headroom, so ANY new file fails that gate, at any
   * size. A module added after that point therefore cannot carry bundled art
   * without either compressing somebody else's or bypassing a ratchet.
   *
   * It does not need to. `ModuleArt` walks its sources and falls through to
   * `FallbackArt` on error, a gradient from the module's catalog hue plus its
   * lucide emblem, and its own header says that fallback "costs zero image
   * budget". `ModuleArt.fallback.test.tsx` proves the card really draws it.
   * Art a founder chooses later goes in the uploads volume, which the budget
   * gate's header names as the place art that needs to grow belongs, and which
   * `ModuleArt` already prefers over the bundled file.
   *
   * So this list is narrow and it is checked: every id here must be a real
   * module, and every module NOT here must still ship its file. The original
   * failure this suite was written for (five modules rendering as broken
   * images) stays caught for everything else.
   */
  const DRAWN_FALLBACK = new Set(["redemption"]);

  it("keeps the fallback list pointed at real modules", () => {
    const stale = [...DRAWN_FALLBACK].filter((id) => !ids.includes(id));
    expect(stale, `fallback list names no such module: ${stale.join(", ")}`).toEqual([]);
    // A module on this list must not also ship a file: that would be an
    // exemption nobody needs, quietly costing the budget.
    const both = [...DRAWN_FALLBACK].filter((id) => images.has(id));
    expect(both, `on the fallback list AND shipping art: ${both.join(", ")}`).toEqual([]);
  });

  it("gives every module an image, or the drawn fallback", () => {
    const missing = ids.filter((id) => !images.has(id) && !DRAWN_FALLBACK.has(id));
    expect(missing, `modules with no image: ${missing.join(", ")}`).toEqual([]);
  });

  it("leaves no image without a module", () => {
    const orphans = [...images].filter((f) => !ids.includes(f)).sort();
    expect(orphans, `images with no module: ${orphans.join(", ")}`).toEqual([]);
  });

  it("keeps every image to the house size and shape", () => {
    // 640x400 and roughly 25 KB is the convention every existing image follows.
    // The first pass of the five new ones came out at 58 to 73 KB, which is
    // 2.5 times the weight of everything around them on the same grid.
    const heavy = [...images]
      .map((id) => ({ id, kb: Math.round(fs.statSync(path.join(IMAGE_DIR, `${id}.webp`)).size / 1024) }))
      .filter((x) => x.kb > 45);
    expect(heavy, `oversized: ${heavy.map((h) => `${h.id} ${h.kb}KB`).join(", ")}`).toEqual([]);
  });
});
