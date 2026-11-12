/**
 * Every village's onboarding path seed (server/seeds/<village>/onboarding-path-seed.json)
 * saves through the same reader the Admin door uses, so a person pasting it into
 * Admin, Onboarding path is never refused. Phase B (11 Nov 2026) also holds the
 * first village's fourteen days to the lead's decisions: the Technical Operations
 * conversation on day 2 or 3, the training step opening a page of this site, and
 * everything else inside the first fourteen days.
 *
 * Found by listing the folder, so this file names no village.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mergePath, readVillageDoc, type VillagePathDoc } from "../shared/onboardingPath";

const SEEDS = path.resolve(process.cwd(), "server/seeds");
const found = fs
  .readdirSync(SEEDS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => path.join(SEEDS, d.name, "onboarding-path-seed.json"))
  .filter((f) => fs.existsSync(f));

const bare = (raw: Record<string, unknown>) => Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("_")));

describe("onboarding path seeds", () => {
  it("there is at least one to hold", () => {
    expect(found.length).toBeGreaterThan(0);
  });

  for (const file of found) {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
    const name = path.basename(path.dirname(file));

    it(`${name}: saves through the Admin door's reader with nothing dropped`, () => {
      const read = readVillageDoc(bare(raw));
      expect(read.ok, read.ok ? "" : read.error).toBe(true);
      if (!read.ok) return;
      const items = mergePath({ village: read.doc as VillagePathDoc, circleId: null, first90: null });
      const written = (raw.phases as Array<{ items: unknown[] }>).flatMap((p) => p.items);
      expect(items).toHaveLength(written.length);
    });

    it(`${name}: the first fourteen days hold the Technical Operations conversation on day 2 or 3, and a training step that opens a page here`, () => {
      const items = mergePath({ village: bare(raw) as VillagePathDoc, circleId: null, first90: null });
      const tech = items.find((i) => i.key === "technical-operations-conversation");
      expect(tech?.dueDay).toBeGreaterThanOrEqual(2);
      expect(tech?.dueDay).toBeLessThanOrEqual(3);
      const training = items.find((i) => i.key === "community-training");
      expect(training?.link?.href).toMatch(/^\/training\//);
      expect(items.every((i) => i.dueDay <= 14)).toBe(true);
      expect((raw.checkins as number[]) ?? []).toContain(14);
    });
  }
});
