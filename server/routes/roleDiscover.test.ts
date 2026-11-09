import { describe, expect, it } from "vitest";
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
import express from "express";
import type { AddressInfo } from "node:net";
import { vi } from "vitest";

vi.mock("../repos/appConfigDocs", () => ({ readConfigDocument: vi.fn(async () => null), writeConfigDocument: vi.fn(async () => undefined) }));
import { writeConfigDocument } from "../repos/appConfigDocs";
import { register } from "./roleDiscover";

async function serve(holds: boolean) {
  const asked: string[] = [];
  const app = express();
  app.use(express.json());
  register(app, {
    authedUser: async () => null,
    getPool: () => ({}) as never,
    clientIp: () => "127.0.0.1",
    overLimit: async () => false,
    guardCapability: async (_req: unknown, res: express.Response, cap: string) => {
      asked.push(cap);
      if (holds) return true;
      res.status(403).json({ error: "You do not hold the power to do this." });
      return false;
    },
    villageGuideName: () => "",
    villageName: () => "Test Village",
  } as never);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, asked, close: () => server.close() };
}

describe("saving the mapping", () => {
  it("refuses a member without the power to decide, and writes nothing", async () => {
    const s = await serve(false);
    const res = await fetch(`${s.base}/api/governance/role-discover/mapping`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mapping: { humanDesign: { Projector: ["building"] } } }) });
    s.close();
    expect(res.status).toBe(403);
    expect(s.asked).toEqual(["org.decide"]);
    expect(writeConfigDocument).not.toHaveBeenCalled();
  });
  it("saves, read strictly, for a holder of the power", async () => {
    const s = await serve(true);
    const res = await fetch(`${s.base}/api/governance/role-discover/mapping`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mapping: { humanDesign: { Projector: ["building", 4] }, lines: { "9": ["x"] } } }) });
    const body = await res.json();
    s.close();
    expect(res.status).toBe(200);
    expect(body.mapping).toEqual({ humanDesign: { Projector: ["building"] }, lines: {} });
    expect(writeConfigDocument).toHaveBeenCalledTimes(1);
  });
  it("reads publicly, with nothing shipped", async () => {
    const s = await serve(false);
    const res = await fetch(`${s.base}/api/governance/role-discover/mapping`);
    const body = await res.json();
    s.close();
    expect(body.mapping).toEqual({ humanDesign: {}, lines: {} });
  });
});
