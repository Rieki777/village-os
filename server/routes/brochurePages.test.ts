/**
 * Admin, Pages: the switches for the story pages. Driven against a fake Express
 * the way brandPreview.test.ts does: the question is what the routes answer and
 * which gate they ask, not what MySQL does with a write-through document.
 *
 * The fake store applies a change with the real `applyBrochurePatch`, so what
 * a PUT answers here is what the document would hold.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyBrochurePatch, type BrochurePatch } from "../../shared/brochure";

let stored = false;
let hidden: string[] = [];
const writes: BrochurePatch[] = [];
vi.mock("../lib/brochurePages", () => ({
  brochurePagesOn: () => stored,
  brochureHiddenPages: () => hidden,
  updateBrochurePages: async (patch: BrochurePatch) => {
    writes.push(patch);
    const next = applyBrochurePatch({ enabled: stored, hidden }, patch);
    stored = next.enabled;
    hidden = next.hidden;
    return next;
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
  hidden = [];
  writes.length = 0;
  asked.length = 0;
});

describe("the story pages switch", () => {
  it("answers whether the pages are on, to an admin only", async () => {
    stored = true;
    const { res, out } = makeRes();
    await wire(true).get("GET /api/admin/brochure-pages")!({}, res);
    expect(out.body).toEqual({ enabled: true, hidden: [] });

    const denied = makeRes();
    await wire(false).get("GET /api/admin/brochure-pages")!({}, denied.res);
    expect(denied.out.status).toBe(401);
  });

  it("turns them on through the story.tell gate and answers the stored value", async () => {
    const { res, out } = makeRes();
    await wire(true).get("PUT /api/admin/brochure-pages")!({ body: { enabled: true } }, res);
    expect(asked).toEqual(["story.tell"]);
    expect(out.body).toEqual({ enabled: true, hidden: [] });
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

describe("the switch on one story page", () => {
  const put = async (body: unknown, allow = true) => {
    const { res, out } = makeRes();
    await wire(allow).get("PUT /api/admin/brochure-pages")!({ body }, res);
    return out;
  };

  it("lists the pages switched off one by one, beside the master switch", async () => {
    stored = true;
    hidden = ["/housing"];
    const { res, out } = makeRes();
    await wire(true).get("GET /api/admin/brochure-pages")!({}, res);
    expect(out.body).toEqual({ enabled: true, hidden: ["/housing"] });
  });

  it("switches one page off through the story.tell gate, and leaves the master switch alone", async () => {
    stored = true;
    const out = await put({ pages: { "/housing": false } });
    expect(asked).toEqual(["story.tell"]);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ enabled: true, hidden: ["/housing"] });
  });

  it("changes only the pages it names", async () => {
    stored = true;
    hidden = ["/housing", "/team"];
    const out = await put({ pages: { "/team": true, "/visit": false } });
    expect(out.body).toEqual({ enabled: true, hidden: ["/visit", "/housing"] });
  });

  it("takes both switches in one change", async () => {
    const out = await put({ enabled: true, pages: { "/opportunities": false } });
    expect(out.body).toEqual({ enabled: true, hidden: ["/opportunities"] });
  });

  it("keeps a page's own switch while the master switch goes off and on again", async () => {
    stored = true;
    await put({ pages: { "/housing": false } });
    await put({ enabled: false });
    const out = await put({ enabled: true });
    expect(out.body).toEqual({ enabled: true, hidden: ["/housing"] });
  });

  it("refuses a page that has no switch, a switch that is not true or false, and a stray key, and stores nothing", async () => {
    stored = true;
    const bad: unknown[] = [
      { pages: { "/quests": false } },
      { pages: { "/project-history": false } },
      { pages: { "/housing": "off" } },
      { pages: ["/housing"] },
      { page: { "/housing": false } },
      { enabled: "yes", pages: { "/housing": false } },
      {},
      null,
    ];
    for (const body of bad) {
      const out = await put(body);
      expect(out.status, JSON.stringify(body)).toBe(400);
      expect(typeof out.body.error).toBe("string");
    }
    expect(writes).toEqual([]);
    expect(hidden).toEqual([]);
  });

  it("changes nothing for someone without the power", async () => {
    stored = true;
    const out = await put({ pages: { "/housing": false } }, false);
    expect(out.status).toBe(403);
    expect(writes).toEqual([]);
    expect(hidden).toEqual([]);
  });
});
