/**
 * THE SITE CONTENT SEED IS STARTER TEXT ANY VILLAGE CAN SHOW (2026-10-23).
 *
 * server/seeds/site-content-seed.json is what a village serves for its FAQs,
 * visit programme and investor summary until it saves its own (the documents
 * fall back to it at read time, server/repos/store-db.ts `dbDocument`), and the
 * build milestones it is given on its first boot (seeded once, only into an
 * empty table). It used to carry one village's facts and its founder's notes
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

  it("keeps the milestone ids the loop test ages and completes, and marks none complete", () => {
    const ids = SEED.milestones.map((m: { id: string }) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["land-acquired", "site-planning"]));
    expect(SEED.milestones.every((m: { status: string; completedDate: unknown }) => m.status !== "complete" && m.completedDate === null)).toBe(true);
  });
});
