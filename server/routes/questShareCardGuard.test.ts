/**
 * WHAT THE SHARE-CARD RASTER DOES WITH EACH OF THE GUARD'S THREE ANSWERS.
 *
 * `GET /api/og/quest/:id` is the only route on the board that spends `sharp` on
 * a caller with no account. Everywhere else in the platform an unreachable
 * guard table reads as "not over limit", because a guard that takes a public
 * form down during an outage costs the village real leads. Here that trade
 * runs the other way, and Rye chose it on 2026-09-23: refuse on the raster
 * only. Failing open here would drop the only bound on the one expensive
 * anonymous path at the exact moment the database is already struggling.
 *
 * No database: the route reads its quest through `questsRepo` and its guard
 * through `limitState`, and both arrive as dependencies, so each answer can be
 * handed to it directly. That is the whole reason this is a fast unit test and
 * not an end-to-end one.
 */
import http from "node:http";
import os from "node:os";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LimitState } from "../repos/rateHits";
import { register as registerQuestRoutes } from "./quests";

const QUEST = {
  id: "q-share",
  title: "Tend the swale",
  gratitude: "50-100",
  status: "Open",
  tags: [],
  order: 1,
  circle: "land",
  imageUrl: "",
};

/** What the guard answers next, set per case. */
let answer: LimitState = "under";
let asked: Array<{ bucket: string; max: number; windowMs: number }> = [];
/** A fresh id per case: the poster cache sits before the guard, by design. */
let caseNo = 0;
const questId = () => `q-share-${++caseNo}`;

let server: http.Server;
let base = "";

const get = async (path: string) => {
  const r = await fetch(`${base}${path}`); // module-review-ok: the suite's own in-process server on 127.0.0.1, never an outbound call, so there is no correlation id to carry
  const type = r.headers.get("content-type") ?? "";
  return {
    status: r.status,
    retryAfter: r.headers.get("retry-after"),
    type,
    body: type.includes("json") ? await r.json().catch(() => undefined) : null,
    bytes: type.includes("json") ? 0 : (await r.arrayBuffer()).byteLength,
  };
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerQuestRoutes(app, {
    isAdmin: async () => false,
    authedUser: async () => null,
    adminActor: () => null,
    getPool: () => ({}) as any,
    uploadsDir: os.tmpdir(),
    members: { all: async () => [], byId: async () => null, update: async () => null },
    questsRepo: { byId: async (id: string) => (id === "q-nope" ? null : { ...QUEST, id }), all: async () => [QUEST] },
    claimsRepo: {},
    crewsRepo: {},
    firstName: (n: string) => String(n).split(" ")[0],
    notify: async () => {},
    stageOf: async () => "member",
    loadRoles: () => [],
    roleIdsFor: () => [],
    currentPatternId: () => null,
    questConsentRecipients: async () => [],
    overLimit: async () => false,
    clientIp: () => "1.2.3.4",
    limitState: async (bucket: string, max: number, windowMs: number) => {
      asked.push({ bucket, max, windowMs });
      return answer;
    },
  } as any);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

describe("the share card, against each answer the guard can give", () => {
  it("rasters when the caller is within the bound", async () => {
    answer = "under";
    asked = [];
    const r = await get(`/api/og/quest/${questId()}`);
    expect(r.status).toBe(200);
    expect(r.type).toContain("jpeg");
    expect(r.bytes, "a real poster, not an empty body").toBeGreaterThan(1000);
    // And it asked the guard the question the comment in the route promises.
    expect(asked).toEqual([{ bucket: "og-quest:1.2.3.4", max: 120, windowMs: 60 * 60 * 1000 }]);
  });

  it("answers 429 when the caller is over the bound", async () => {
    answer = "over";
    const r = await get(`/api/og/quest/${questId()}`);
    expect(r.status).toBe(429);
    expect(r.retryAfter).toBe("600");
    expect(String(r.body?.error)).toContain("Too many poster requests");
  });

  it("REFUSES with 503 when the guard cannot check, rather than rastering unguarded", async () => {
    answer = "unavailable";
    const r = await get(`/api/og/quest/${questId()}`);
    // 503 and not 429: the caller did nothing wrong, and the same request
    // works again as soon as the guard can answer.
    expect(r.status).toBe(503);
    expect(r.retryAfter).toBe("600");
    expect(String(r.body?.error)).toContain("could not be made just now");
    // Nothing was rendered: a JSON refusal carries no image.
    expect(r.type).toContain("json");
  });

  it("still answers 404 for a quest that does not exist, before any of that", async () => {
    answer = "unavailable";
    asked = [];
    const r = await get("/api/og/quest/q-nope");
    expect(r.status).toBe(404);
    // The guard is not even asked for a quest that is not there, so a missing
    // card cannot spend anybody's budget.
    expect(asked).toEqual([]);
  });
});
