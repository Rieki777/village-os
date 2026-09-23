/**
 * WHICH POWER GUARDS THE AFFINITY MAP.
 *
 * The map says which character suits which power. It used to be written by
 * whoever holds `story.tell`, on the reasoning that the editor sits beside the
 * words that describe a class, so whoever can reword The Architect can say what
 * The Architect is suited to. Rye ruled that too wide on 2026-09-23: rewording
 * a class is copy, and saying which powers suit which character steers who gets
 * entrusted with what. It moves to `org.declare`, whose own gloss is the
 * category, "Declare how the village and its circles hold power".
 *
 * TWO THINGS THE ORG MAP LANE ASKED FOR, and both are here:
 *
 *   `org.declare` CARRIES A SECOND, NARROWER PATH. A live holder of a seat
 *   flagged `represents_circle` may declare FOR THAT CIRCLE. The affinity map
 *   is village-wide, so it must ask the plain question and never the
 *   circle-scoped one, or every circle delegate gains a village-wide power.
 *   The test below pins the plain call. The stronger guard is structural: this
 *   module's `Deps` is a Pick of `isAdmin`, `guardCapability` and `getPool`, so
 *   the circle-scoped check is not reachable from here at all, and adding it
 *   would be a visible widening of that slice.
 *
 *   THE READ MOVES TOO. It took `isAdmin` alone. `org.declare` is transferable,
 *   so a village that transfers it would otherwise have a holder who may write
 *   the map and cannot see it.
 *
 * Asserted by WHICH KEY THE GUARD WAS ASKED, not by a status code: a route that
 * asked for the wrong power and happened to refuse the same people today would
 * pass a status-only check and drift the moment a village transferred one.
 */
import { describe, expect, it, vi } from "vitest";

// The map's own reading and writing has its own suite and its own database.
// Stubbed here so a guard case fails on the GATE and never on a pool.
vi.mock("../lib/powerAffinity", () => ({
  affinityForAdmin: async () => ({ powers: [] }),
  saveAffinityEdit: async () => ({ powers: [] }),
}));
vi.mock("../lib/characters", () => ({ listArchetypes: async () => [{ key: "catalyzing" }] }));
vi.mock("../lib/economy", () => ({ villageId: () => "v1" }));

import { register } from "./powerAffinity";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect(deps: Record<string, unknown>) {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (path: string, handler: Handler) => {
    handlers.set(`${method} ${path}`, handler);
  };
  register(
    { get: record("GET"), put: record("PUT"), post: record("POST"), delete: record("DELETE") } as any,
    deps as any,
  );
  return handlers;
}

function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) { out.status = code; return res; },
    json(body: unknown) { out.body = body; return res; },
  };
  return { res, out };
}

/** Deps that answer yes to everything, recording every power asked for. */
function deps(over: Record<string, unknown> = {}) {
  const asked: string[] = [];
  const base = {
    isAdmin: async () => true,
    guardCapability: async (_req: any, _res: any, cap: string) => { asked.push(cap); return true; },
    getPool: () => ({}) as any,
  };
  return { asked, deps: { ...base, ...over } };
}

describe("the affinity map's gates", () => {
  it("asks for org.declare to write, and never for story.tell", async () => {
    const { asked, deps: d } = deps();
    const handlers = collect(d);
    const { res } = makeRes();
    await handlers.get("PUT /api/admin/power-affinity/:key")!(
      { params: { key: "library.keep" }, body: { classes: [] } },
      res,
    );
    expect(asked, "the write asks the plain village-wide question").toContain("org.declare");
    expect(asked).not.toContain("story.tell");
  });

  it("refuses the write when that power is not held, and writes nothing", async () => {
    const put = vi.fn();
    const { deps: d } = deps({
      guardCapability: async (_req: any, res: any) => {
        res.status(403).json({ error: "not_allowed" });
        return false;
      },
    });
    const handlers = collect({ ...d, put });
    const { res, out } = makeRes();
    await handlers.get("PUT /api/admin/power-affinity/:key")!(
      { params: { key: "library.keep" }, body: { classes: ["catalyzing"] } },
      res,
    );
    expect(out.status).toBe(403);
    expect(put, "a refused guard returns before anything is stored").not.toHaveBeenCalled();
  });

  it("lets a holder of org.declare read the map without being an admin", async () => {
    // The half that would otherwise strand a village that transferred the key:
    // a holder who may write the map and cannot see what they are editing.
    const { asked, deps: d } = deps({ isAdmin: async () => false });
    const handlers = collect(d);
    const { res, out } = makeRes();
    await handlers.get("GET /api/admin/power-affinity")!({}, res);
    expect(asked, "the read falls through to the same key").toContain("org.declare");
    expect(out.status).toBe(200);
  });

  it("still lets an admin read it when they hold no key at all", async () => {
    const { deps: d } = deps({
      isAdmin: async () => true,
      guardCapability: async (_req: any, res: any) => {
        res.status(403).json({ error: "not_allowed" });
        return false;
      },
    });
    const handlers = collect(d);
    const { res, out } = makeRes();
    await handlers.get("GET /api/admin/power-affinity")!({}, res);
    expect(out.status).toBe(200);
  });
});
