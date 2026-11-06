/**
 * PUT /api/profile/locale (internal spec i18n, US2.4, §8 R16): a member's
 * language choice, saved in their preferences so it follows them.
 */
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { register } from "./routes/i18n";

type Member = { id: string; prefs?: Record<string, unknown> };
let me: Member | null;
let limited = false;
let server: http.Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  register(app, {
    catalogDir: "/nonexistent",
    pseudoAllowed: () => false,
    authedUser: (async () => me) as never,
    members: {
      update: async (_id: string, fn: (u: Member) => void) => {
        if (!me) return null;
        fn(me);
        return me;
      },
    } as never,
    overLimit: async () => limited,
  });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  me = { id: "7", prefs: { guide: "village" } };
  limited = false;
});

/** Every request goes to the local test server above. */
const put = (body: unknown) =>
  fetch(`${base}/api/profile/locale`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); // module-review-ok: a test calling its own local server

describe("PUT /api/profile/locale", () => {
  it("saves an offered language beside the other preferences", async () => {
    const res = await put({ locale: "es" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ locale: "es" });
    expect(me?.prefs).toEqual({ guide: "village", locale: "es" });
  });

  it("an empty value clears it, so the browser's language applies again", async () => {
    me!.prefs = { locale: "es" };
    const res = await put({ locale: "" });
    expect(await res.json()).toEqual({ locale: null });
    expect(me?.prefs).toEqual({});
  });

  it("refuses a language Village OS does not offer, naming the ones it does, and writes nothing", async () => {
    for (const locale of ["de", "en-XA", "x".repeat(200), 42]) {
      const res = await put({ locale });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/en, es/);
    }
    expect(me?.prefs).toEqual({ guide: "village" });
  });

  it("asks a visitor to sign in", async () => {
    me = null;
    expect((await put({ locale: "es" })).status).toBe(401);
  });

  it("bounds how often one member saves", async () => {
    limited = true;
    expect((await put({ locale: "es" })).status).toBe(429);
  });
});
