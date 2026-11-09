/**
 * WHICH CHARACTERS A ROLE SUITS, SET BY A PERSON (role draft board, Rye 9 Nov:
 * "which roles attach to each character" are kept current by Saberra, Sera and
 * the admins). Until now a role's tags were only ever a boot-time guess
 * (economySeed, `archetypes_suggested = 1`), with no way for anybody to
 * correct them. A tag set here is the village's word: the guess flag clears,
 * so no later boot overwrites it, and only the village's own cast is accepted,
 * because an unknown key silently matches nothing (shared/archetypes.ts).
 */
import { describe, expect, it } from "vitest";
import { characterTagsFrom, updateOrgRole } from "./orgChart";

const CAST = ["building", "researching", "facilitating", "catalyzing", "storytelling"];

describe("characterTagsFrom", () => {
  it("keeps the cast's keys, in the order given, without duplicates", () => {
    expect(characterTagsFrom(["catalyzing", "building", "catalyzing"], CAST)).toEqual({ ok: true, tags: ["catalyzing", "building"] });
  });

  it("takes an empty list as a decision: the role suits no character in particular", () => {
    expect(characterTagsFrom([], CAST)).toEqual({ ok: true, tags: [] });
  });

  it("refuses a key the village's cast does not hold, naming it", () => {
    const r = characterTagsFrom(["catalyzing", "wizard"], CAST);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("wizard");
  });

  it("refuses anything that is not a list of words", () => {
    expect(characterTagsFrom("catalyzing", CAST).ok).toBe(false);
    expect(characterTagsFrom([7], CAST).ok).toBe(false);
  });
});

describe("updateOrgRole writes the tags as the village's word", () => {
  it("stores the list and clears the guess flag in the same update", async () => {
    const seen: Array<{ sql: string; args: unknown[] }> = [];
    const pool = { query: async (sql: string, args: unknown[]) => (seen.push({ sql, args }), [{ affectedRows: 1 }]) } as any;
    expect(await updateOrgRole(pool, "r1", { archetypes: ["facilitating"] })).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].sql).toContain("`archetypes` = ?");
    expect(seen[0].sql).toContain("`archetypes_suggested` = 0");
    expect(seen[0].args).toEqual([JSON.stringify(["facilitating"]), "r1"]);
  });

  it("leaves the tags alone when the body does not name them", async () => {
    const seen: string[] = [];
    const pool = { query: async (sql: string) => (seen.push(sql), [{ affectedRows: 1 }]) } as any;
    await updateOrgRole(pool, "r1", { aim: "An aim" });
    expect(seen[0]).not.toContain("archetypes");
  });
});
