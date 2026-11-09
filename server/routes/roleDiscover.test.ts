import { describe, expect, it, vi } from "vitest";
import { suggestionsFromReply } from "./roleDiscover";

describe("the guide's reply on the discover step", () => {
  const sent = new Set(["a", "b", "c", "d"]);
  it("keeps only role ids that were sent, once each, at most three", () => {
    const text = JSON.stringify({ suggestions: [{ roleId: "a", why: "x" }, { roleId: "a", why: "again" }, { roleId: "zz", why: "unknown" }, { roleId: "b", why: "y" }, { roleId: "c", why: "z" }, { roleId: "d", why: "w" }] });
    expect(suggestionsFromReply(text, sent).map((s) => s.roleId)).toEqual(["a", "b", "c"]);
  });
  it("removes dashes between words and clips long lines", () => {
    const [s] = suggestionsFromReply(JSON.stringify({ suggestions: [{ roleId: "a", why: `You grow food — and share it ${"x".repeat(400)}` }] }), sent);
    expect(s.why).not.toMatch(/[–—]/);
    expect(s.why.length).toBeLessThanOrEqual(200);
  });
  it("answers nothing for prose or a broken reply", () => {
    expect(suggestionsFromReply("I think the first one.", sent)).toEqual([]);
    expect(suggestionsFromReply("", sent)).toEqual([]);
  });
});

// ── The mapping route's gate ────────────────────────────────────────────────
vi.mock("../repos/appConfigDocs", () => ({ readConfigDocument: vi.fn(async () => null), writeConfigDocument: vi.fn(async () => undefined) }));
import { writeConfigDocument } from "../repos/appConfigDocs";
import { register } from "./roleDiscover";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function setup(holds: boolean) {
  const handlers = new Map<string, Handler>();
  const asked: string[] = [];
  const add = (verb: string) => (p: string, h: Handler) => handlers.set(`${verb} ${p}`, h);
  register({ get: add("GET"), put: add("PUT"), post: add("POST") } as any, {
    authedUser: async () => null,
    getPool: () => ({}) as never,
    clientIp: () => "127.0.0.1",
    overLimit: async () => false,
    mayAct: async (_req: unknown, cap: string) => {
      asked.push(cap);
      return { ok: holds, message: "You do not hold the power to do this." };
    },
    villageGuideName: () => "",
    villageName: () => "Test Village",
  } as never);
  return { handlers, asked };
}

async function call(h: Handler | undefined, body?: unknown) {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(c: number) { out.status = c; return res; },
    json(b: unknown) { out.body = b; return res; },
  };
  await h!({ body, headers: {}, ip: "127.0.0.1" }, res);
  return out;
}

const PATH = "/api/governance/role-discover/mapping";

describe("saving the mapping", () => {
  it("refuses a member without the power to decide, and writes nothing", async () => {
    const s = setup(false);
    const out = await call(s.handlers.get(`PUT ${PATH}`), { mapping: { humanDesign: { Projector: ["building"] } } });
    expect(out.status).toBe(403);
    expect(s.asked).toEqual(["org.decide"]);
    expect(writeConfigDocument).not.toHaveBeenCalled();
  });
  it("saves, read strictly, for a holder of the power", async () => {
    const s = setup(true);
    const out = await call(s.handlers.get(`PUT ${PATH}`), { mapping: { humanDesign: { Projector: ["building", 4] }, lines: { "9": ["x"] } } });
    expect(out.status).toBe(200);
    expect(out.body.mapping).toEqual({ humanDesign: { Projector: ["building"] }, lines: {} });
    expect(writeConfigDocument).toHaveBeenCalledTimes(1);
  });
  it("reads publicly, with nothing shipped", async () => {
    const s = setup(false);
    const out = await call(s.handlers.get(`GET ${PATH}`));
    expect(out.body.mapping).toEqual({ humanDesign: {}, lines: {} });
    expect(s.asked).toEqual([]);
  });
});
