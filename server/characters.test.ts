/**
 * Tests for the party: what may be stored, and who fronts the sheet.
 *
 * Two things here are security rather than product. The three character fields
 * end up in an avatar filename, so they are checked as closed sets and against
 * this village's own rows; and the one-primary invariant has to survive two
 * calls arriving together, which is the case a boolean flag on each character
 * would lose.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import {
  addCharacter,
  avatarFor,
  isPresentation,
  isTone,
  partyFor,
  removeCharacter,
  setPrimary,
} from "./lib/characters";
import { seedEconomy } from "./lib/economySeed";
import { loadTokenRegistry, memberAccount } from "./lib/ledger";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";

const configured = testDbConfigured();
const VILLAGE = "local";

let db: TestDb;
let pool: mysql.Pool;

async function makeMember(id: string): Promise<string> {
  await pool.query(
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
      "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    [id, id, `${id}@examples.invalid`],
  );
  await pool.query(
    "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)",
    [memberAccount(id), "member", id, id],
  );
  return id;
}

async function primaryOf(userId: string): Promise<string | null> {
  const [rows]: any = await pool.query("SELECT `primary_character_id` AS p FROM `users` WHERE `id` = ?", [
    userId,
  ]);
  return rows[0]?.p ?? null;
}

describe.skipIf(!configured)("the party", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 10 });
    await loadTokenRegistry(pool);
    await seedEconomy(pool, VILLAGE);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  // ── What may be stored ───────────────────────────────────────────────────

  it("refuses a presentation or tone outside the closed set", async () => {
    const u = await makeMember("chr-enum");
    for (const bad of ["../../etc/passwd", "x", "", "f' OR '1", "F"]) {
      const p = await addCharacter(pool, VILLAGE, u, {
        archetypeKey: "building", presentation: bad, tone: "deep",
      });
      expect(p.ok).toBe(false);
      const t = await addCharacter(pool, VILLAGE, u, {
        archetypeKey: "building", presentation: "f", tone: bad,
      });
      expect(t.ok).toBe(false);
    }
    expect(await partyFor(pool, VILLAGE, u, u)).toHaveLength(0);
  });

  it("refuses an archetype this village does not have", async () => {
    const u = await makeMember("chr-arch");
    // Checked against the village's OWN rows, not a constant, so a village
    // that renamed or removed a class gets the answer its data gives.
    const res = await addCharacter(pool, VILLAGE, u, {
      archetypeKey: "necromancing", presentation: "f", tone: "deep",
    });
    expect(res.ok).toBe(false);
    expect(await partyFor(pool, VILLAGE, u, u)).toHaveLength(0);
  });

  it("never builds an avatar path out of stored values", () => {
    // The whole point of the fixed table. Anything not in it returns null and
    // the page draws a medallion; a path assembled from data is a path
    // somebody can aim, and this string is rendered into an img src.
    expect(avatarFor("building", "f", "deep")).toBe("/images/avatars/building-f-deep.webp");
    expect(avatarFor("../../secrets", "f", "deep")).toBeNull();
    expect(avatarFor("building", "f", "deep/../../x")).toBeNull();
    expect(avatarFor("necromancing", "f", "deep")).toBeNull();
    expect(isPresentation("f")).toBe(true);
    expect(isPresentation("F")).toBe(false);
    expect(isTone("olive")).toBe(true);
    expect(isTone("chartreuse")).toBe(false);
  });

  it("plays a class once, however many times it is walked", async () => {
    const u = await makeMember("chr-dup");
    await addCharacter(pool, VILLAGE, u, { archetypeKey: "building", presentation: "f", tone: "deep" });
    await addCharacter(pool, VILLAGE, u, { archetypeKey: "building", presentation: "m", tone: "light" });
    const party = await partyFor(pool, VILLAGE, u, u);
    // A second walk changes the look. It does not put a second copy of the
    // same class in the party row.
    expect(party).toHaveLength(1);
    expect(party[0].presentation).toBe("m");
    expect(party[0].tone).toBe("light");
  });

  // ── Who fronts the sheet ─────────────────────────────────────────────────

  it("makes the first character the primary without being asked", async () => {
    const u = await makeMember("chr-first");
    const res = await addCharacter(pool, VILLAGE, u, {
      archetypeKey: "building", presentation: "f", tone: "deep",
    });
    expect(res.ok).toBe(true);
    // A profile whose hero art is blank until somebody finds the star reads as
    // broken rather than as unset.
    expect(await primaryOf(u)).toBe(res.ok && res.character.id);
  });

  it("leaves exactly one primary when two calls arrive together", async () => {
    const u = await makeMember("chr-race");
    const a = await addCharacter(pool, VILLAGE, u, { archetypeKey: "building", presentation: "f", tone: "deep" });
    const b = await addCharacter(pool, VILLAGE, u, { archetypeKey: "catalyzing", presentation: "m", tone: "light" });
    expect(a.ok && b.ok).toBe(true);
    const ids = (await partyFor(pool, VILLAGE, u, u)).map((c) => c.id);

    await Promise.all([
      setPrimary(pool, VILLAGE, u, ids[0]),
      setPrimary(pool, VILLAGE, u, ids[1]),
      setPrimary(pool, VILLAGE, u, ids[0]),
    ]);

    // One column, so both writers write the same place and the last one wins.
    // A boolean per character is what would let both win and leave two.
    const party = await partyFor(pool, VILLAGE, u, u);
    expect(party.filter((c) => c.isPrimary)).toHaveLength(1);
    expect(ids).toContain(await primaryOf(u));
  });

  it("refuses to front a character belonging to somebody else", async () => {
    const mine = await makeMember("chr-mine");
    const theirs = await makeMember("chr-theirs");
    const t = await addCharacter(pool, VILLAGE, theirs, {
      archetypeKey: "storytelling", presentation: "f", tone: "olive",
    });
    expect(t.ok).toBe(true);
    const ok = await setPrimary(pool, VILLAGE, mine, t.ok ? t.character.id : "x");
    expect(ok).toBe(false);
    expect(await primaryOf(mine)).toBeNull();
  });

  it("hands the crown on when the primary leaves", async () => {
    const u = await makeMember("chr-promote");
    const a = await addCharacter(pool, VILLAGE, u, { archetypeKey: "building", presentation: "f", tone: "deep" });
    await addCharacter(pool, VILLAGE, u, { archetypeKey: "researching", presentation: "m", tone: "olive" });
    const first = a.ok ? a.character.id : "";
    expect(await primaryOf(u)).toBe(first);

    expect(await removeCharacter(pool, VILLAGE, u, first)).toBe(true);
    // Same transaction as the delete. Two steps would leave a window where the
    // profile points at a character that no longer exists and the header
    // renders nothing at all.
    const left = await partyFor(pool, VILLAGE, u, u);
    expect(left).toHaveLength(1);
    expect(await primaryOf(u)).toBe(left[0].id);
    expect(left[0].isPrimary).toBe(true);
  });

  it("falls back to the medallion when the last character leaves", async () => {
    const u = await makeMember("chr-empty");
    const a = await addCharacter(pool, VILLAGE, u, { archetypeKey: "facilitating", presentation: "f", tone: "light" });
    const only = a.ok ? a.character.id : "";
    expect(await removeCharacter(pool, VILLAGE, u, only)).toBe(true);
    // NULL is the honest state for somebody who has walked away from every
    // path, and the header draws a medallion for it.
    expect(await primaryOf(u)).toBeNull();
    expect(await partyFor(pool, VILLAGE, u, u)).toHaveLength(0);
  });

  it("refuses to remove a character belonging to somebody else", async () => {
    const mine = await makeMember("chr-del-mine");
    const theirs = await makeMember("chr-del-theirs");
    const t = await addCharacter(pool, VILLAGE, theirs, {
      archetypeKey: "catalyzing", presentation: "m", tone: "deep",
    });
    const removed = await removeCharacter(pool, VILLAGE, mine, t.ok ? t.character.id : "x");
    expect(removed).toBe(false);
    expect(await partyFor(pool, VILLAGE, theirs, theirs)).toHaveLength(1);
  });
});
