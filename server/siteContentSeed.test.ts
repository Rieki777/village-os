/**
 * THE SITE CONTENT SEED IS STARTER TEXT ANY VILLAGE CAN SHOW (2026-10-23).
 *
 * server/seeds/site-content-seed.json is what a village serves for its FAQs,
 * visit programme and investor summary until it saves its own (the documents
 * fall back to it at read time, server/repos/store-db.ts `dbDocument`), and the
 * build milestones it is given on its first boot (seeded once, only into an
 * empty table; since the canvas merge that list, and the FAQs, ship empty,
 * because a roadmap and its answers are the village's own). It used to carry one village's facts and its founder's notes
 * to themselves, shown to visitors: "tax-free", "schools within 20 minutes",
 * a 90-minute Zoom call, camping on the land, "Say how much and where."
 *
 * What is held here: no figure, no currency, no founder instruction, no token
 * economy, and none of one village's own words, in any string a visitor can
 * read. Ids, icons, statuses and links are machinery and are not read.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SEED = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "seeds", "site-content-seed.json"), "utf8"));

/** Keys that hold machinery a visitor never reads as words. `phase` is a label like "Phase 2". */
const MACHINERY = new Set(["id", "icon", "status", "cta_url", "completedDate", "order", "phase"]);

function visibleStrings(value: unknown, where: string, out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof value === "string") out.push([where, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => visibleStrings(v, `${where}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) if (!MACHINERY.has(k)) visibleStrings(v, `${where}.${k}`, out);
  }
  return out;
}

const ONE_VILLAGE = [
  "Dominicalito", // brand-ok: the list this file asserts the ABSENCE of
  "Costa Rica",
  "tax-free",
  "Zoom",
  "worldschool",
  "bilingual",
  "sociocra",
  "Gratitude",
  "value tokens",
  "debt",
  "Weaving",
  "camp",
  "Prosperity Packet",
];

/** The shapes a note to the founder took, read by every visitor. */
const FOUNDER_NOTES = [/\bSay (how|what|where)\b/, /\bPut your own\b/, /\bwrite yours\b/i, /\bonce you know\b/i, /\bAdd what\b/];

describe("the site content seed", () => {
  const strings = visibleStrings(SEED, "seed");

  it("states no figure, price or percentage a visitor reads", () => {
    expect(strings.filter(([, v]) => /\d|[$€£₡%]/.test(v))).toEqual([]);
  });

  it("carries none of one village's own words", () => {
    const found = strings.flatMap(([where, v]) => ONE_VILLAGE.filter((w) => v.toLowerCase().includes(w.toLowerCase())).map((w) => `${where}: ${w}`));
    expect(found).toEqual([]);
  });

  it("shows a visitor no note meant for the founder", () => {
    const found = strings.filter(([, v]) => FOUNDER_NOTES.some((re) => re.test(v)));
    expect(found).toEqual([]);
  });

  it("ships no logistics, which are one village's facts, and keeps the contact note", () => {
    const { getting_there, accommodation, what_to_bring, contact_note } = SEED.visitConfig.logistics;
    expect([getting_there, accommodation, what_to_bring]).toEqual(["", "", ""]);
    expect(contact_note).not.toBe("");
  });

  // The roadmap is the village's own plan, so a fresh village is handed none
  // (server/forkPublish.e2e.test.ts, "the fresh fork is handed no other
  // village's story"; ruled platform-wide 2026-10-01). Nothing ships planned,
  // and so nothing ships complete. loop.e2e writes the two milestones it ages
  // and completes through the founder's own door.
  it("ships no roadmap milestone, so none is planned or complete for the village", () => {
    expect(SEED.milestones).toEqual([]);
  });

  it("ships at most one neutral starter FAQ per pathway, pointing at pages every village has (2026-10-23)", () => {
    expect(Object.keys(SEED.faqs).sort()).toEqual(["investor", "prosperity", "resident", "steward"]);
    for (const list of Object.values(SEED.faqs) as Array<Array<{ answer: string }>>) {
      expect(list.length).toBeLessThanOrEqual(1);
      // No figure, no place, no promise: only where to go to ask.
      for (const f of list) expect(f.answer).not.toMatch(/[0-9$€%]|land share|school|tax/i);
    }
  });

  it("states no visit term: a blank duration, format or cost draws no line on the Visit page", () => {
    expect(SEED.visitConfig.visit_types.length).toBeGreaterThan(0);
    for (const v of SEED.visitConfig.visit_types) expect([v.duration, v.format, v.cost], v.id).toEqual(["", "", ""]);
  });
});
