/**
 * THE WALK EDITOR'S TWO ROUTES CARRY THE VILLAGE'S WELCOME.
 *
 * Rye, 2026-10-02: onboarding is the founders' to write. The guide's first
 * line on the map is the village's own once it has written one, and that
 * welcome is written in the same panel as the walk and saved with the same
 * press, so the walk's two admin routes carry it. Before this, the save ran
 * the body through `sanitiseWalk` alone and a welcome sent with it was
 * dropped on the floor, and the read never returned one.
 *
 * No database. The handlers are driven against a stand-in for the walk's
 * document, the way server/routes/brandPreview.test.ts drives its own.
 */
import { describe, expect, it } from "vitest";
import { register } from "./mapScene";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect(): { app: any; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (path: string, ...chain: Handler[]) => {
    handlers.set(`${method} ${path}`, chain[chain.length - 1]);
  };
  return {
    app: { get: record("GET"), post: record("POST"), put: record("PUT"), delete: record("DELETE"), use: () => undefined },
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
    json(body: any) {
      out.body = body;
      return res;
    },
  };
  return { res, out };
}

function routes(stored: any, admin = true) {
  let doc = stored;
  const { app, handlers } = collect();
  register(app, {
    isAdmin: async () => admin,
    mapWalkRepo: { get: () => doc, put: async (next: any) => { doc = next; return next; } } as any,
    mapVocabRepo: { get: () => ({}), put: async (v: any) => v } as any,
    authedUser: async () => null,
    capabilityCtx: async () => ({}) as any,
    guardCapability: (async () => false) as any,
    members: {} as any,
    getPool: () => ({ query: async () => [[], []] }) as any,
  } as any);
  const call = async (key: string, body?: unknown) => {
    const { res, out } = makeRes();
    await handlers.get(key)!({ body, query: {} }, res);
    return out;
  };
  return { call, stored: () => doc };
}

const step = { id: "a", structure_key: "gate", title: "Come in", body: "Our gate.", gesture: "none" };

describe("GET /api/admin/map/walk", () => {
  it("returns the welcome beside the walk", async () => {
    const r = routes({ en: [step], welcome: { en: "Welcome home." } });
    const out = await r.call("GET /api/admin/map/walk");
    expect(out.status).toBe(200);
    expect(out.body.walk.en[0].title).toBe("Come in");
    expect(out.body.welcome).toEqual({ en: "Welcome home." });
  });

  it("never reads the welcome's key as a language of the walk", async () => {
    const out = await routes({ en: [step], welcome: { en: "Welcome home." } }).call("GET /api/admin/map/walk");
    expect(Object.keys(out.body.walk)).toEqual(["en"]);
  });
});

describe("PUT /api/admin/map/walk", () => {
  it("stores the welcome the founder wrote, and answers with what it kept", async () => {
    const r = routes({});
    const out = await r.call("PUT /api/admin/map/walk", { walk: { en: [step] }, welcome: { en: "  Welcome home. " } });
    expect(out.body.success).toBe(true);
    expect(out.body.welcome).toEqual({ en: "Welcome home." });
    expect(r.stored()).toEqual({ en: [step], welcome: { en: "Welcome home." } });
  });

  it("keeps a stored welcome when the save says nothing about it", async () => {
    const r = routes({ en: [step], welcome: { en: "Welcome home." } });
    await r.call("PUT /api/admin/map/walk", { walk: { en: [{ ...step, title: "Through the gate" }] } });
    expect(r.stored().welcome).toEqual({ en: "Welcome home." });
    expect(r.stored().en[0].title).toBe("Through the gate");
  });

  it("refuses a caller who is not an admin, and stores nothing", async () => {
    const r = routes({}, false);
    const out = await r.call("PUT /api/admin/map/walk", { walk: { en: [step] }, welcome: { en: "Hi." } });
    expect(out.status).toBe(401);
    expect(r.stored()).toEqual({});
  });
});
