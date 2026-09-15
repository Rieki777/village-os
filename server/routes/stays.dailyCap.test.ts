/**
 * THE STAY-REQUEST REFUSAL STATES THE CAP IT ENFORCED.
 *
 * `stay.request_daily_cap` is an open-ring dial: default 5, range 1 to 100,
 * and any member may put it on a ballot. The refusal used to read "Five stay
 * requests in a day is plenty" as a literal, so a village that voted the cap
 * to 2 refused a member at 2 while telling them five, and a village that
 * raised it to 20 hid the room it had just voted itself.
 *
 * The shape this now follows is `server/lib/economy.ts`'s give refusal, which
 * has always stated the live number: "{cap} is the most you can give one
 * person this moon". One read of the dial decides the limit AND the sentence,
 * so the two can never disagree.
 *
 * NO DATABASE. Everything this route touches before the refusal is injected:
 * `authedUser`, `capabilityCtx` (which is all `stayAudienceFor` reads) and
 * `overLimit`. The variables cache is filled through `loadVariables` with a
 * stub pool, which is the same code path boot uses and the same one the
 * governance apply loop leaves behind. So this file asks the question the
 * member asks, through the real handler, in milliseconds.
 *
 * THE CAP IS ASSERTED AS THE NUMBER THE LIMITER WAS GIVEN, never as a second
 * copy of the dial: `overLimit` records its own argument and the assertions
 * compare the sentence against that.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { loadVariables } from "../lib/variables";
import { register } from "./stays";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

/** A fake Express that keeps the handlers `register` hands it. */
function collect(): { app: any; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, handler: Handler) => {
    handlers.set(`${method} ${p}`, handler);
  };
  return {
    app: {
      get: record("GET"),
      post: record("POST"),
      put: record("PUT"),
      delete: record("DELETE"),
      use: () => {},
    },
    handlers,
  };
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

/**
 * The override cache, filled the way boot fills it. `loadVariables` runs one
 * SELECT and reads `[rows]` off it, so a stub with a `query` is the whole
 * surface it needs and no schema is involved.
 */
const vote = async (rows: Array<{ config_key: string; value: string }>) => {
  await loadVariables({ query: async () => [rows] } as any);
};

describe("the stay-request refusal names the cap the village voted", () => {
  /** What `overLimit` was actually asked to enforce, per call. */
  let limits: number[] = [];

  /** Drive `POST /api/stays/request` with the limiter already tripped. */
  const refusal = async () => {
    limits = [];
    const { app, handlers } = collect();
    register(app, {
      adminActor: () => ({ id: "steward-1", name: "Steward" }),
      authedUser: async () => ({ id: "usr-ana", name: "Ana" }),
      // A member, so the guest-booking gate above the cap never fires and the
      // refusal under test is the one that answers.
      capabilityCtx: async () => ({
        stageIndex: 0,
        stageIndexOf: () => 0,
        roleCapabilities: ["stay.member_rate"],
      }),
      isAdmin: async () => false,
      members: { byId: async () => null },
      notify: async () => ({ ok: true }),
      notifyAdmins: async () => {},
      notifyDeps: { origin: () => "http://localhost" },
      overLimit: async (_key: string, limit: number) => {
        limits.push(limit);
        return true;
      },
      questsRepo: { all: async () => [] },
      stayPostingHooks: () => ({ onLowBalance: async () => {}, onStopped: async () => {} }),
      getPool: () => ({}) as any,
    } as any);

    const handler = handlers.get("POST /api/stays/request");
    if (!handler) throw new Error("POST /api/stays/request was not registered");
    const { res, out } = makeRes();
    await handler({ body: {} }, res);
    return out;
  };

  beforeEach(async () => {
    // A village that has never voted has NO ROW. Every case starts there and
    // adds its own, so the default case below is reading an absence.
    await vote([]);
  });

  it("states five when the village has voted nothing", async () => {
    const out = await refusal();
    expect(out.status).toBe(429);
    expect(limits).toEqual([5]);
    expect(out.body.error).toBe("5 stay requests in a day is plenty. The stewards will reply");
  });

  it("states two when the village voted two, which is what it also enforced", async () => {
    await vote([{ config_key: "stay.request_daily_cap", value: "2" }]);
    const out = await refusal();
    expect(out.status).toBe(429);
    expect(limits).toEqual([2]);
    expect(out.body.error).toContain(`${limits[0]} stay requests in a day`);
    expect(out.body.error).not.toContain("Five");
    expect(out.body.error).not.toContain("5 stay");
  });

  it("states twenty when the village opened it up, so the room it voted is visible", async () => {
    await vote([{ config_key: "stay.request_daily_cap", value: "20" }]);
    const out = await refusal();
    expect(limits).toEqual([20]);
    expect(out.body.error).toBe("20 stay requests in a day is plenty. The stewards will reply");
  });

  it("reads one request in the singular, so a cap of one is a sentence", async () => {
    await vote([{ config_key: "stay.request_daily_cap", value: "1" }]);
    const out = await refusal();
    expect(limits).toEqual([1]);
    expect(out.body.error).toBe("1 stay request in a day is plenty. The stewards will reply");
  });

  it("clamps a cap of zero to one in the sentence and in the limiter together", async () => {
    // Caps fail closed in this platform, and this one has a floor of 1 in the
    // registry. The sentence and the limiter take the same clamped number, so
    // a member is never refused at a limit the refusal does not name.
    await vote([{ config_key: "stay.request_daily_cap", value: "0" }]);
    const out = await refusal();
    expect(limits).toEqual([1]);
    expect(out.body.error).toBe("1 stay request in a day is plenty. The stewards will reply");
  });
});
