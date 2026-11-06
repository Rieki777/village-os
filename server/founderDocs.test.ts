/**
 * THE FOUNDER'S OPERATING DOCS ARE EVERY VILLAGE'S (readiness R139, R201).
 *
 * The brand guard does not read them: scripts/check-brand-refs.mjs scans code
 * extensions only and exempts docs/, so `.yml` and `.md` were never looked at.
 * Two findings lived there:
 *
 *   R139  the backup template's "uploads not configured" message, printed in
 *         every village's backup run log, and the runbook step for the same
 *         secret, both gave the first village's address as the example.
 *   R201  docs/FORK_RUNBOOK.md, which README routes every founder to for env
 *         vars and traps, carried the first village's handoff to-dos inside the
 *         generic env table, and rulings attributed to a person by name (the
 *         ruling is to name the role, never the person).
 *
 * The handoff items moved to the private ops repository
 * (village-os-ops/internal/AMORA_HANDOFF_ITEMS_2026-11-01.md). Every fork
 * instruction around them stays, and the last block here says so.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** The first village's name in an example address, or a handoff to-do in a generic table. */
const FIRST_VILLAGE_ADDRESS = /amora\.example|amora\.cr|amora\.regencivics/i; // brand-ok: the pattern this test refuses

describe("the uploads backup's example address (R139)", () => {
  for (const rel of ["ops/backup/db-backup.yml", "docs/RUNBOOK.md"]) {
    it(`${rel} gives a neutral one`, () => {
      const text = read(rel);
      expect(text).not.toMatch(FIRST_VILLAGE_ADDRESS);
      expect(text).toContain("https://village.example.org");
    });
  }
});

describe("docs/FORK_RUNBOOK.md (R201)", () => {
  const runbook = read("docs/FORK_RUNBOOK.md");

  it("carries no village's handoff to-dos", () => {
    expect(runbook).not.toMatch(/handoff item/i);
    expect(runbook).not.toMatch(FIRST_VILLAGE_ADDRESS);
    expect(runbook).not.toMatch(/the Amora team/i); // brand-ok: the phrase this test refuses
  });

  it("names roles, never a person", () => {
    expect(runbook).not.toMatch(/\bRye\b/);
  });

  it("keeps every fork instruction the handoff items sat beside", () => {
    expect(runbook).toContain("Every fork must verify its sender domain in Resend");
    expect(runbook).toContain("Until a village connects its own Stripe account, card checkout answers an honest 503");
    expect(runbook).toContain("Create the endpoint and set this secret together with `STRIPE_SECRET_KEY`");
    expect(runbook).toContain("Test with `stripe listen --forward-to` before go-live");
  });

  it("is still where README sends a founder", () => {
    expect(read("README.md")).toContain("[docs/FORK_RUNBOOK.md](docs/FORK_RUNBOOK.md)");
  });
});
