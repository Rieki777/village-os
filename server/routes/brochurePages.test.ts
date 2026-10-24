/**
 * Admin, Pages: the switch for the story pages. Driven against a fake Express
 * the way brandPreview.test.ts does: the question is what the routes answer and
 * which gate they ask, not what MySQL does with a write-through document.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let stored = false;
vi.mock("../lib/brochurePages", () => ({
  brochurePagesOn: () => stored,
  setBrochurePages: async (on: boolean) => {
    stored = on;
    return stored;
  },
}));

import { register } from "./brochurePages";

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

const asked: string[] = [];
function wire(allow: boolean) {
  const { app, handlers } = collect();
  register(app, {
    isAdmin: async () => allow,
    guardCapability: async (_req: any, res: any, key: string) => {
      asked.push(key);
      if (!allow) res.status(403).json({ error: "forbidden" });
      return allow;
    },
  } as any);
  return handlers;
}

beforeEach(() => {
  stored = false;
  asked.length = 0;
});

describe("the story pages switch", () => {
  it("answers whether the pages are on, to an admin only", async () => {
    stored = true;
    const { res, out } = makeRes();
    await wire(true).get("GET /api/admin/brochure-pages")!({}, res);
    expect(out.body).toEqual({ enabled: true });

    const denied = makeRes();
    await wire(false).get("GET /api/admin/brochure-pages")!({}, denied.res);
    expect(denied.out.status).toBe(401);
  });

  it("turns them on through the story.tell gate and answers the stored value", async () => {
    const { res, out } = makeRes();
    await wire(true).get("PUT /api/admin/brochure-pages")!({ body: { enabled: true } }, res);
    expect(asked).toEqual(["story.tell"]);
    expect(out.body).toEqual({ enabled: true });
    expect(stored).toBe(true);
  });

  it("refuses anything but true or false, and changes nothing", async () => {
    const { res, out } = makeRes();
    await wire(true).get("PUT /api/admin/brochure-pages")!({ body: { enabled: "yes" } }, res);
    expect(out.status).toBe(400);
    expect(stored).toBe(false);
  });

  it("changes nothing for someone without the power", async () => {
    const { res, out } = makeRes();
    await wire(false).get("PUT /api/admin/brochure-pages")!({ body: { enabled: true } }, res);
    expect(out.status).toBe(403);
    expect(stored).toBe(false);
  });
});
