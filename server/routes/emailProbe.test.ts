/**
 * The email guild's live check, through the real route: who may run it, what
 * it sends, and that the answer never carries the key.
 */
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let storedKey = "";
vi.mock("../lib/secrets", () => ({ secretValue: (k: string) => (k === "resend_api_key" ? storedKey : "") }));

const { register, EMAIL_PROBE_PATH } = await import("./emailProbe");

describe("POST /api/admin/integrations/resend/probe", () => {
  let server: http.Server;
  let base = "";
  let admin = true;
  const audit: any[] = [];
  const resendCalls: Array<{ url: string; body: any; auth: string }> = [];
  let resendStatus = 200;
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    register(app, {
      isAdmin: async () => admin,
      adminActor: () => ({ id: "founder-1" }),
      getPool: () => ({ query: async (_sql: string, params: any[]) => { audit.push(params); return [[]]; } }) as any,
      sender: () => "hello@village.example",
    });
    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 120_000));
    admin = true;
    storedKey = "re_send_only_9z9z";
    resendStatus = 200;
    resendCalls.length = 0;
    // The route's own outbound call to Resend is the only one intercepted.
    globalThis.fetch = (async (url: any, init: any) => {
      const target = new URL(String(url));
      if (target.protocol === "https:" && target.host === "api.resend.com") {
        resendCalls.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.Authorization });
        return new Response(resendStatus === 200 ? '{"id":"e_1"}' : '{"message":"refused"}', { status: resendStatus });
      }
      return realFetch(url, init);
    }) as any;
  });

  const post = async () => {
    const res = await realFetch(`${base}${EMAIL_PROBE_PATH}`, { method: "POST" });
    return { status: res.status, text: await res.text() };
  };

  it("refuses anybody who is not an admin, and sends nothing", async () => {
    admin = false;
    expect((await post()).status).toBe(401);
    expect(resendCalls).toHaveLength(0);
  });

  it("says there is nothing to check when no key is set", async () => {
    storedKey = "";
    const r = await post();
    expect(r.status).toBe(409);
    expect(JSON.parse(r.text).message).toContain("No Resend key");
    expect(resendCalls).toHaveLength(0);
  });

  it("sends one message from the village's sender to Resend's test address, and never answers with the key", async () => {
    const r = await post();
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toEqual({ ok: true, detail: "Resend accepted a test send from hello@village.example." });
    expect(resendCalls).toEqual([
      expect.objectContaining({ url: "https://api.resend.com/emails", auth: "Bearer re_send_only_9z9z" }),
    ]);
    expect(resendCalls[0].body.to).toEqual(["delivered@resend.dev"]);
    expect(r.text).not.toContain("re_send_only");
    expect(r.text).not.toContain("9z9z");
    expect(audit.some((p) => String(p).includes("integrations:resend_api_key:probe:alive"))).toBe(true);
  });

  it("reports a refusal as a failed check, still without the key", async () => {
    resendStatus = 403;
    const r = await post();
    expect(r.status).toBe(200);
    const body = JSON.parse(r.text);
    expect(body.ok).toBe(false);
    expect(body.detail).toContain("403");
    expect(r.text).not.toContain("9z9z");
  });

  it("runs at most once a minute", async () => {
    expect((await post()).status).toBe(200);
    const again = await post();
    expect(again.status).toBe(429);
    expect(resendCalls).toHaveLength(1);
  });
});
