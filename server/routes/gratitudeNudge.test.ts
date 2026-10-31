/**
 * The gratitude nudge's wiring: the job is registered, and the suggestions
 * read answers only the member asking, without ids.
 *
 * Express is a fake that records handlers, so this proves the module's own
 * code and nothing about the host. The rules are proved in
 * server/lib/gratitudeNudge.test.ts and the joins in
 * server/gratitudeSuggestions.db.test.ts.
 */
import { describe, expect, it } from "vitest";
import { registeredJobs } from "../lib/scheduler";
import { GRATITUDE_NUDGE_EVERY_MS, GRATITUDE_NUDGE_JOB, register } from "./gratitudeNudge";

type Handler = (req: any, res: any) => Promise<unknown>;

function fakeRes() {
  const out: { status: number; body: unknown } = { status: 200, body: undefined };
  const res = {
    status(n: number) {
      out.status = n;
      return res;
    },
    json(b: unknown) {
      out.body = b;
      return res;
    },
  };
  return { res, out };
}

function wire(user: any) {
  const routes = new Map<string, Handler>();
  const app = { get: (path: string, h: Handler) => routes.set(path, h) } as any;
  // A pool whose every read answers "nobody", so the route runs end to end.
  const pool = { query: async () => [[]] } as any;
  register(app, {
    getPool: () => pool,
    authedUser: async () => user,
    members: { byId: async () => null, all: async () => [] } as any,
    notify: async () => ({ fresh: true }),
    notifyDeps: { isPresent: () => true } as any,
    remainingFor: async () => 0,
  });
  return routes;
}

describe("the gratitude nudge's wiring", () => {
  it("registers one job, every six hours", () => {
    wire(null);
    const job = registeredJobs().find((j) => j.name === GRATITUDE_NUDGE_JOB);
    expect(job?.everyMs).toBe(GRATITUDE_NUDGE_EVERY_MS);
    expect(GRATITUDE_NUDGE_EVERY_MS).toBe(6 * 60 * 60 * 1000);
  });

  it("refuses a stranger", async () => {
    const h = wire(null).get("/api/game/gratitude/suggestions")!;
    const { res, out } = fakeRes();
    await h({}, res);
    expect(out.status).toBe(401);
  });

  it("answers the member asking with a list, even an empty one", async () => {
    const h = wire({ id: "u-me" }).get("/api/game/gratitude/suggestions")!;
    const { res, out } = fakeRes();
    await h({}, res);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ suggestions: [] });
  });
});
