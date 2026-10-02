/**
 * THE CANVAS MOON: which blocks a new moon asks about, and the one line the
 * weekly brief and the moon digest carry (plan 4.4; Wave 4).
 *
 * The rule is pure and proved without a database. The reads are proved
 * against a real scratch schema: the flags come back out of the notification
 * rows the key moments wrote, and the village's choice out of its stored
 * season file. DB-backed cases skip loudly without TEST_DATABASE_URL.
 */
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { canvasMoonQuestion, composeCanvasMoon, lunationBegunBy, newMoonNear, nextNewMoonAfter } from "./canvasMoon";
import { canvasMoonTitles, setCanvasMoonProvider } from "./calendarBrief";
import { digestText, type DigestFacts } from "./moonDigest";
import { writeConfigDocument } from "../repos/appConfigDocs";
import { CANVAS_BLOCK_IDS } from "../../shared/governanceCanvas";
import { CANVAS_SEASON_KEY } from "../../shared/canvasSeason";
import { newMoonsBetween } from "../../shared/lunar";

const configured = testDbConfigured();
if (!configured) console.warn("[canvasMoon] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");

/** The new moon of Saturday 10 October 2026, the W3 session day. */
const OCT_NEW_MOON = newMoonsBetween(new Date("2026-10-09T00:00:00Z"), new Date("2026-10-12T00:00:00Z"))[0];

describe("the moon's question", () => {
  it("is the village's choice plus every block a moment flagged, in canvas order", () => {
    const q = composeCanvasMoon({
      newMoonAt: OCT_NEW_MOON,
      chosen: ["power"],
      flagged: [
        { moment: "partners", block: "stakeholders" },
        { moment: "funding", block: "power" },
      ],
    });
    expect(q.blocks.map((b) => b.id)).toEqual(["stakeholders", "power"]);
    expect(q.blocks.map((b) => b.name)).toEqual(["Stakeholders", "Power"]);
    expect(q.source).toEqual({ chosen: ["power"], flagged: ["stakeholders", "power"], rotated: null });
  });

  it("lets a conflict moment change nothing on a line every member reads", () => {
    // The whole property: with a conflict flag or without one, every moon
    // reads the same, so the line can never tell anybody the pathway was used.
    const moons = newMoonsBetween(new Date("2026-10-01T00:00:00Z"), new Date("2027-10-01T00:00:00Z"));
    for (const m of moons) {
      const flagged = composeCanvasMoon({ newMoonAt: m, chosen: ["power"], flagged: [{ moment: "conflict", block: "conflict" }] });
      expect(flagged).toEqual(composeCanvasMoon({ newMoonAt: m, chosen: ["power"], flagged: [] }));
      expect(flagged.blocks.map((b) => b.id)).toEqual(["power"]);
      const alone = composeCanvasMoon({ newMoonAt: m, chosen: [], flagged: [{ moment: "conflict", block: "conflict" }] });
      expect(alone).toEqual(composeCanvasMoon({ newMoonAt: m, chosen: [], flagged: [] }));
      expect(alone.source.flagged).toEqual([]);
    }
  });

  it("rotates one block in canvas order when nothing was chosen or flagged", () => {
    const moons = newMoonsBetween(new Date("2026-10-01T00:00:00Z"), new Date("2027-10-01T00:00:00Z"));
    const rotated = moons.map((m) => composeCanvasMoon({ newMoonAt: m, chosen: [], flagged: [] }).source.rotated);
    expect(rotated.every((b) => b !== null)).toBe(true);
    // Twelve consecutive moons walk the twelve blocks, each once.
    expect(new Set(rotated.slice(0, 12)).size).toBe(12);
    const first = CANVAS_BLOCK_IDS.indexOf(rotated[0]!);
    expect(rotated[1]).toBe(CANVAS_BLOCK_IDS[(first + 1) % 12]);
  });

  it("drops a block id it does not know", () => {
    const q = composeCanvasMoon({ newMoonAt: OCT_NEW_MOON, chosen: ["a-thirteenth-block"], flagged: [{ moment: "partners", block: "nonsense" }] });
    expect(q.source.chosen).toEqual([]);
    expect(q.source.rotated).not.toBeNull();
  });

  it("finds the next new moon and the one near a moon's boundary", () => {
    expect(nextNewMoonAfter(new Date("2026-10-01T00:00:00Z"))?.toISOString()).toBe(OCT_NEW_MOON.toISOString());
    expect(newMoonNear(new Date(OCT_NEW_MOON.getTime() + 86_400_000), 3)?.toISOString()).toBe(OCT_NEW_MOON.toISOString());
    expect(newMoonNear(new Date(OCT_NEW_MOON.getTime() + 12 * 86_400_000), 3)).toBeNull();
  });
});

describe("the moon digest's line", () => {
  const facts: DigestFacts = { landed: [], paid: [], vetoed: [], opened: 0, closed: 0, stalled: 0, expired: 0 };

  it("prints the canvas moon under its own heading when there is one, and nothing otherwise", () => {
    const with_ = digestText("lunar-1200", facts, "The canvas moon looks at Stakeholders.");
    expect(with_).toContain("The canvas moon\n  The canvas moon looks at Stakeholders.");
    const without = digestText("lunar-1200", facts);
    expect(without).not.toContain("canvas moon");
  });
});

describe.skipIf(!configured)("reading the moon from the village", () => {
  let db: TestDb;
  let pool: Pool;
  const moon = lunationBegunBy(OCT_NEW_MOON);

  const flag = async (moment: string, block: string, m: number, user = "u1") => {
    await pool.query( // module-review-ok: a fixture row on the scratch schema this suite provisioned
      "INSERT INTO notifications (id, user_id, type, title, dedupe_key) VALUES (?,?,?,?,?)",
      [`n-${moment}-${block}-${m}-${user}`, user, "canvas_revisit", "x", `canvas_revisit:${moment}:${block}:${m}:${user}`],
    );
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 2 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  }, 120_000);

  afterAll(async () => {
    setCanvasMoonProvider(null);
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM notifications"); // module-review-ok: resetting the scratch schema between cases
    await pool.query("DELETE FROM app_config WHERE config_key = ?", [CANVAS_SEASON_KEY]); // module-review-ok: resetting the scratch schema between cases
  });

  it("reads the flags of the moon ending and the moon beginning, once each, and no older ones", async () => {
    await flag("partners", "stakeholders", moon - 1);
    await flag("partners", "stakeholders", moon - 1, "u2");
    await flag("funding", "legal", moon);
    await flag("funding", "impact", moon - 2);
    await flag("conflict", "conflict", moon);
    const q = await canvasMoonQuestion(pool, OCT_NEW_MOON);
    expect(q.moon).toBe(moon);
    expect(q.blocks.map((b) => b.id)).toEqual(["stakeholders", "legal"]);
    expect(q.source.rotated).toBeNull();
  });

  it("takes the season file's choice for the moon on that date", async () => {
    await writeConfigDocument(pool, CANVAS_SEASON_KEY, {
      season: {
        id: "test-season",
        name: "Test season",
        timezone: "America/Los_Angeles",
        weeks: [{ number: 1, date: "2026-09-26", title: "Selection" }],
        moons: [
          { date: "2026-10-10", blocks: ["purpose", "team"], note: "" },
          { date: "2026-11-09", blocks: ["impact"], note: "" },
        ],
      },
      savedBy: "u1",
      savedAt: new Date().toISOString(),
    });
    const q = await canvasMoonQuestion(pool, OCT_NEW_MOON);
    expect(q.source.chosen).toEqual(["purpose", "team"]);
    expect(q.blocks.map((b) => b.id)).toEqual(["purpose", "team"]);
  });

  it("carries titles through the brief's seam once a reader is registered, and nothing before", async () => {
    setCanvasMoonProvider(null);
    expect(await canvasMoonTitles(pool, OCT_NEW_MOON)).toBeNull();
    await flag("partners", "stakeholders", moon);
    setCanvasMoonProvider(async (p, at) => (await canvasMoonQuestion(p, at)).blocks.map((b) => b.name));
    expect(await canvasMoonTitles(pool, OCT_NEW_MOON)).toEqual(["Stakeholders"]);
  });
});
