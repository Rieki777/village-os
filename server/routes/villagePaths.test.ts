/**
 * Admin, Paths & Stages: the two routes, driven against a fake Express the way
 * brochurePages.test.ts does. The questions are what the routes answer, which
 * gate each one asks, and what a save stores. The cache behind them is the
 * real one (server/lib/villagePaths.ts) over a fake pool, so a refused save is
 * proven to have written nothing.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";
import { register } from "./villagePaths";
import { loadVillagePaths, servedPathWords } from "../lib/villagePaths";
import { defaultVillagePathWords, PATH_LIMITS } from "../../shared/villagePaths";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect() {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (path: string, handler: Handler) => handlers.set(`${method} ${path}`, handler);
  return { app: { get: record("GET"), put: record("PUT") } as any, handlers };
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

let writes: unknown[];
const asked: string[] = [];

async function wire(allow: boolean) {
  writes = [];
  const pool = {
    query: async (sql: string, args: unknown[] = []) => {
      if (/^\s*SELECT/i.test(sql)) return [[]];
      writes.push(JSON.parse(String(args[1])));
      return [{ affectedRows: 1 }];
    },
  } as unknown as Pool;
  await loadVillagePaths(pool);
  const { app, handlers } = collect();
  register(app, {
    isAdmin: async () => allow,
    guardCapability: async (_req: any, res: any, key: string) => {
      asked.push(key);
      if (!allow) res.status(403).json({ error: "forbidden" });
      return allow;
    },
    config: () => ({ project: { name: "Riverbend" } }),
    valueTokenName: () => "Seeds",
  } as any);
  return handlers;
}

beforeEach(() => {
  asked.length = 0;
});

describe("reading the village's paths and stages", () => {
  it("answers what was saved and the words in force, to an admin only", async () => {
    const { res, out } = makeRes();
    await (await wire(true)).get("GET /api/admin/village-paths")!({}, res);
    expect(out.body).toEqual({ stored: {}, words: defaultVillagePathWords() });

    const denied = makeRes();
    await (await wire(false)).get("GET /api/admin/village-paths")!({}, denied.res);
    expect(denied.out.status).toBe(401);
  });
});

describe("saving them", () => {
  it("asks the story.tell gate, stores only what was typed, and answers the same shape as a read", async () => {
    const handlers = await wire(true);
    const { res, out } = makeRes();
    await handlers.get("PUT /api/admin/village-paths")!(
      { body: { paths: { steward: { label: " Keeper ", role: "" } }, stages: { sage: { name: "Elder" } }, ladder: { title: "The Spiral" } } },
      res,
    );
    expect(asked).toEqual(["story.tell"]);
    expect(out.status).toBe(200);
    const stored = { paths: { steward: { label: "Keeper" } }, stages: { sage: { name: "Elder" } }, ladder: { title: "The Spiral" } };
    expect(writes).toEqual([stored]);
    expect(out.body.stored).toEqual(stored);
    expect(out.body.words.paths.steward).toMatchObject({ label: "Keeper", role: "Co-Creator" });
    expect(out.body.words.stages.sage.name).toBe("Elder");
    // What the public config serves from the very next request.
    expect(servedPathWords().paths.find((p) => p.id === "steward")?.label).toBe("Keeper");
    expect(servedPathWords().ladder.title).toBe("The Spiral");
  });

  it("fills the village's {words} from the config it was handed", async () => {
    const handlers = await wire(true);
    const { res } = makeRes();
    await handlers.get("PUT /api/admin/village-paths")!({ body: { paths: { investor: { description: "Back {village} with {value}." } } } }, res);
    expect(servedPathWords().paths.find((p) => p.id === "investor")?.description).toBe("Back Riverbend with Seeds.");
  });

  it("refuses an unknown id, an unknown field and a word over its limit, and writes nothing", async () => {
    for (const body of [
      { paths: { pirate: { label: "Pirate" } } },
      { stages: { elder: { name: "Elder" } } },
      { paths: { investor: { route: "/elsewhere" } } },
      { stages: { guest: { rule: "granted" } } },
      { paths: { investor: { label: "x".repeat(PATH_LIMITS.label + 1) } } },
      { order: ["sage", "guest"] },
      "paths",
    ]) {
      const handlers = await wire(true);
      const { res, out } = makeRes();
      await handlers.get("PUT /api/admin/village-paths")!({ body }, res);
      expect(out.status, JSON.stringify(body)).toBe(400);
      expect(typeof out.body.error).toBe("string");
      expect(out.body.problems.length).toBeGreaterThan(0);
      expect(writes).toEqual([]);
    }
  });

  it("changes nothing for someone without the power", async () => {
    const handlers = await wire(false);
    const { res, out } = makeRes();
    await handlers.get("PUT /api/admin/village-paths")!({ body: { paths: { steward: { label: "Keeper" } } } }, res);
    expect(asked).toEqual(["story.tell"]);
    expect(out.status).toBe(403);
    expect(writes).toEqual([]);
    expect(servedPathWords().paths.find((p) => p.id === "steward")?.label).toBe("Village Steward");
  });
});
