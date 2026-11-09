/**
 * ONE ANSWER FOR role.pay (coordinator ruling, 2026-11-09; the Saberra lane's
 * budgets review, gap G-B3).
 *
 * The pay power opens three doors here: a role's pay, a quest's price, and the
 * pricing desk. Each asked `guardCapability`, which lets an admin through on any
 * key the village has not taken on, so an admin who holds no pay power could
 * still set pay after the launch vote had carried, while the Budgets door
 * refused the same person. The doors now ask one check (`server/lib/holderDoor.ts`):
 *
 *   1. After the launch vote carries, with a steward seated, an admin who does
 *      not hold role.pay is refused on all three, and the refusal names the vote.
 *   2. A live holder of role.pay goes through after launch.
 *   3. Before the launch vote, the admin's door stays open.
 *   4. After launch with nobody in the steward's seat, the admin keeps the door:
 *      the launch rule's empty-seat case (`adminDoorRefusal`).
 *   5. The gate still answers first: a refusal it writes is the one sent.
 *
 * Every door refuses before it touches a table, so this needs no schema: the
 * pool and the stores throw if anything gets that far.
 */
import { describe, expect, it } from "vitest";
import { register } from "./valuation";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;
function collect() {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, h: Handler) => handlers.set(`${method} ${p}`, h);
  return { app: { get: record("GET"), post: record("POST"), put: record("PUT"), delete: record("DELETE") } as any, handlers };
}
function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
  };
  return { res, out };
}

const REACHED = "the door let this request through to the work behind it";
const tripwire = new Proxy({}, { get: () => () => { throw new Error(REACHED); } });

interface World {
  actor: { id: string };
  launched: boolean;
  holders: Record<string, string[]>;
  /** What the gate answers: pass (an admin's short-circuit, or a holder), or its own refusal. */
  gate: "pass" | "refuse";
}

function doors(world: World) {
  const { app, handlers } = collect();
  register(app, {
    authedUser: async () => world.actor,
    getPool: () => { throw new Error(REACHED); },
    guardCapability: async (_req: any, res: any, cap: string) => {
      if (world.gate === "refuse") {
        res.status(401).json({ error: "auth_required", from: "the gate", capability: cap });
        return false;
      }
      return true;
    },
    capabilityCtx: async () => ({ villageHeld: [] }),
    launchedByVote: async () => world.launched,
    overLimit: async () => false,
    liveHoldersOf: async (cap: string) => world.holders[cap] ?? [],
    projectCurrency: () => "CRC",
    eeMeaningWritten: () => true,
    quests: tripwire,
    claims: tripwire,
  } as any);
  const hit = async (key: string, req: any = {}) => {
    const h = handlers.get(key);
    if (!h) throw new Error(`no handler for ${key}`);
    const { res, out } = makeRes();
    try {
      await h({ params: { id: "r-1" }, body: { work: { kind: "role", lines: [] }, set: { totalMinor: 1000 } }, query: {}, headers: {}, ...req }, res);
    } catch (e) {
      if ((e as Error).message === REACHED) return { status: 0, body: { reached: true } };
      throw e;
    }
    return out;
  };
  return hit;
}

const PAY_DOORS = ["PUT /api/org/roles/:id/pay", "PUT /api/quests/:id/pay", "GET /api/quests/pricing-desk"] as const;
const SEATED = { "steward.veto": ["steward-1"], "role.pay": ["treasurer-1"] };

describe("role.pay gives one answer on every door", () => {
  for (const key of PAY_DOORS) {
    it(`${key}: refuses an admin who holds no pay power once the launch vote has carried`, async () => {
      const out = await doors({ actor: { id: "admin-1" }, launched: true, holders: SEATED, gate: "pass" })(key);
      expect(out.status).toBe(403);
      expect(out.body.error).toBe("not_a_holder");
      expect(out.body.capability).toBe("role.pay");
      expect(out.body.message).toMatch(/put it to the village/i);
    });

    it(`${key}: lets a live holder of role.pay through after launch`, async () => {
      const out = await doors({ actor: { id: "treasurer-1" }, launched: true, holders: SEATED, gate: "pass" })(key);
      expect(out.body).toEqual({ reached: true });
    });

    it(`${key}: keeps the admin's door open before the launch vote`, async () => {
      const out = await doors({ actor: { id: "admin-1" }, launched: false, holders: SEATED, gate: "pass" })(key);
      expect(out.body).toEqual({ reached: true });
    });

    it(`${key}: keeps the admin's door open after launch when nobody sits in the steward's seat`, async () => {
      const out = await doors({ actor: { id: "admin-1" }, launched: true, holders: { "role.pay": ["treasurer-1"] }, gate: "pass" })(key);
      expect(out.body).toEqual({ reached: true });
    });

    it(`${key}: sends the gate's own refusal when the gate refuses`, async () => {
      const out = await doors({ actor: { id: "member-1" }, launched: true, holders: SEATED, gate: "refuse" })(key);
      expect(out.status).toBe(401);
      expect(out.body.from).toBe("the gate");
    });
  }

  it("says the village decides when nobody holds the pay power after launch", async () => {
    const out = await doors({ actor: { id: "admin-1" }, launched: true, holders: { "steward.veto": ["steward-1"] }, gate: "pass" })("PUT /api/org/roles/:id/pay");
    expect(out.status).toBe(403);
    expect(out.body.ballotNeeded).toBe(true);
    expect(out.body.votePath).toBe("/api/org/drafts/:id/put-to-village");
  });
});


describe("which door a reader sets pay through, for the page that says so", () => {
  const standing = (launched: boolean, holders: Record<string, string[]>) => ({
    getPool: () => { throw new Error(REACHED); },
    liveHoldersOf: async (cap: string) => holders[cap] ?? [],
    launchedByVote: async () => launched,
    capabilityCtx: async () => ({ villageHeld: [] }),
  });
  it("names a holder, an admin before launch, an admin with no steward seated, and nobody else", async () => {
    const { holderStanding } = await import("../lib/holderDoor");
    expect(await holderStanding(standing(true, SEATED) as any, { id: "treasurer-1" }, "role.pay")).toBe("holder");
    expect(await holderStanding(standing(false, SEATED) as any, { id: "admin-1", isAdmin: true }, "role.pay")).toBe("admin-before-launch");
    expect(await holderStanding(standing(true, { "role.pay": ["treasurer-1"] }) as any, { id: "admin-1", isAdmin: true }, "role.pay")).toBe("admin-no-steward");
    expect(await holderStanding(standing(true, SEATED) as any, { id: "admin-1", isAdmin: true }, "role.pay")).toBeNull();
    expect(await holderStanding(standing(false, SEATED) as any, { id: "member-1" }, "role.pay")).toBeNull();
  });
});
