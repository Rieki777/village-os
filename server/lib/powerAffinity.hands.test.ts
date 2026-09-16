/**
 * Where the catalogue puts a member's hand, on the one path a test reaches
 * without a database: the village's map failing to load.
 *
 * Three promises ride on it. A hand is the member's own act, so a map that
 * cannot be read keeps the hand on its row. A caller that decides anything on
 * `recommended` is told the read degraded, so the raise-hand route can say "try
 * again" in place of "not put to you". And a power the member holds never
 * carries a hand, on any path, because "Open to you" already said everything.
 */
import type { Pool } from "mysql2/promise";
import { describe, expect, it } from "vitest";
import { readPowerAffinity, withPowerAffinity } from "./powerAffinity";
import type { CapabilityCatalogueRow } from "./progressionPayload";

const refuse = async () => {
  throw new Error("the database is down");
};
const down = { query: refuse, execute: refuse, getConnection: refuse } as unknown as Pool;

const AT = "2026-09-15T10:00:00.000Z";

const catalogue: CapabilityCatalogueRow[] = [
  { key: "library.keep", label: "Keep the shared library and its loans", held: false, opens: { via: "appointment" } },
  { key: "story.tell", label: "Say what the village is, in public, in its own words", held: true, opens: { via: "appointment" } },
  { key: "map.publish", label: "Publish a draft onto the live map", held: false, opens: { via: "appointment" } },
];

const hand = (capability: string, status = "new", userId = "cass") => ({
  id: `h-${capability}-${status}-${userId}`,
  type: "power-application",
  status,
  userId,
  submittedAt: AT,
  data: { capability },
});

const who = (inbox: unknown[]) => ({ pool: down, villageId: "v1", userId: "cass", stageId: "contributor", inbox: inbox as any[] });

describe("readPowerAffinity when the village's map cannot be read", () => {
  it("says the read degraded, suggests nothing, and keeps the member's hand on its row", async () => {
    const { rows, degraded } = await readPowerAffinity(catalogue, who([hand("library.keep")]));
    expect(degraded).toBe(true);
    for (const r of rows) {
      expect(r.suits, r.key).toEqual([]);
      expect(r.recommended, r.key).toBe(false);
    }
    expect(rows.find((r) => r.key === "library.keep")?.hand).toEqual({ status: "new", submittedAt: AT });
    expect(rows.find((r) => r.key === "map.publish")).not.toHaveProperty("hand");
  });

  it("never puts a hand on a power the member holds", async () => {
    const { rows } = await readPowerAffinity(catalogue, who([hand("story.tell", "reviewing")]));
    expect(rows.find((r) => r.key === "story.tell")).not.toHaveProperty("hand");
  });

  it("shows no answered hand and no hand of anybody else's", async () => {
    const { rows } = await readPowerAffinity(
      catalogue,
      who([hand("library.keep", "accepted"), hand("library.keep", "declined"), hand("map.publish", "new", "dell")]),
    );
    for (const r of rows) expect(r, r.key).not.toHaveProperty("hand");
  });

  it("hands withPowerAffinity's callers the same rows", async () => {
    const rows = await withPowerAffinity(catalogue, who([hand("library.keep", "in-conversation")]));
    expect(rows.find((r) => r.key === "library.keep")?.hand?.status).toBe("in-conversation");
  });
});
