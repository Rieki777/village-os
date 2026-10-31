/**
 * ASKS, through the doors as the server registers them, on a scratch schema
 * with every real migration applied (0299 among them).
 *
 * The adversarial pass the master coordinator named (2026-10-31): an ask to a
 * former member and to an erased account, the cap of three open blocking
 * asks, somebody outside the two members trying to read or move an ask, and a
 * "not mine" hand-back sent straight back to the same member. Plus the erasure
 * step, which must take every row either member is on and leave everybody
 * else's alone.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import http from "node:http";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { forgetAsksForMember } from "../repos/memberAsks";
import { register } from "./memberAsks";

type Person = { id: string; name: string; handle: string; email: string; membershipGranted: boolean; stageGranted?: string };

const member = (id: string, name: string): Person => ({ id, name, handle: id, email: `${id}@village.test`, membershipGranted: true });

const PEOPLE: Record<string, Person> = {
  ana: member("ana", "Ana Reyes"),
  ben: member("ben", "Ben Okafor"),
  cai: member("cai", "Cai Lund"),
  // Never admitted, or admitted and gone: either way not somebody to ask.
  gone: { id: "gone", name: "Gale Former", handle: "gone", email: "gone@village.test", membershipGranted: false, stageGranted: "visitor" },
  erased: { id: "erased", name: "A departed member", handle: "erased", email: "erased@anonymized.invalid", membershipGranted: true },
};

describe.skipIf(!testDbConfigured())("asks through the doors", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let server: http.Server;
  let base = "";
  /** Who the stand-in session says is signed in. */
  let me: Person | null = PEOPLE.ana;
  const notices: Array<{ userId: string; dedupeKey: string; title: string }> = [];

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    const app = express();
    app.use(express.json());
    register(app, {
      authedUser: async () => me,
      getPool: () => pool as any,
      members: {
        byId: async (id: string) => PEOPLE[id] ?? null,
        all: async () => Object.values(PEOPLE),
      } as any,
      notify: async (n: any) => {
        notices.push({ userId: n.userId, dedupeKey: n.dedupeKey, title: n.title });
        return { inserted: true } as any;
      },
      overLimit: async () => false,
      firstName: (n: string) => n.split(/\s+/)[0] ?? n,
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    me = PEOPLE.ana;
    notices.length = 0;
    await pool.query("DELETE FROM member_asks"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
  });

  const call = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(`${base}${url}`, { // module-review-ok: this suite's own loopback server, not an outbound call
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  const ask = (to: string, extra: Record<string, unknown> = {}) =>
    call("POST", "/api/asks", { askedUserId: to, link: "https://docs.example.org/d/1", why: "Review the draft", ...extra });
  const rows = async () => {
    const [r] = await pool.query<any[]>("SELECT id, asker_user_id, asked_user_id, status FROM member_asks ORDER BY created_at, id"); // module-review-ok: every row, read back from the scratch schema this suite provisioned; the repo reads only one member's side, and these cases ask about all of them
    return r;
  };

  it("lands on the asked member's list, tells them, and shows on the asker's own", async () => {
    const sent = await ask("ben", { blocking: true, dueOn: "2026-11-07" });
    expect(sent.status).toBe(201);
    expect(notices).toEqual([expect.objectContaining({ userId: "ben", dedupeKey: `ask:${sent.body.ask.id}:asked:ben` })]);

    me = PEOPLE.ben;
    const bens = await call("GET", "/api/asks");
    expect(bens.body.waitingOnYou).toHaveLength(1);
    expect(bens.body.waitingOnYou[0]).toMatchObject({ otherName: "Ana", why: "Review the draft", tier: "blocking", dueOn: "2026-11-07" });

    me = PEOPLE.ana;
    const anas = await call("GET", "/api/asks");
    expect(anas.body.yourAsks).toEqual([expect.objectContaining({ otherName: "Ben", status: "open" })]);
    expect(anas.body.waitingOnYou).toEqual([]);
  });

  it("refuses asking a former member or an erased account, with the answer nobody gets", async () => {
    for (const who of ["gone", "erased", "nobody-at-all"]) {
      const r = await ask(who);
      expect(r.status).toBe(404);
      expect(r.body.error).toBe("There is no current member by that name to ask.");
    }
    expect(await rows()).toEqual([]);
    expect(notices).toEqual([]);
  });

  it("refuses an ask from somebody the village has not let in", async () => {
    me = PEOPLE.gone;
    expect((await ask("ben")).status).toBe(403);
    expect(await rows()).toEqual([]);
  });

  it("never offers a former member or an erased account in the search", async () => {
    const found = await call("GET", "/api/asks/people?q=a");
    expect(found.body).toEqual([]);
    // "er" matches only Gale Former and the erased account (handle "erased"),
    // so an empty answer is the filter at work. Two letters, the search's minimum.
    expect((await call("GET", "/api/asks/people?q=er")).body).toEqual([]);
    const all = await call("GET", "/api/asks/people?q=en");
    const ids = all.body.map((p: any) => p.userId);
    expect(ids).not.toContain("gone");
    expect(ids).not.toContain("erased");
    expect(ids).not.toContain("ana");
    expect(ids).toEqual(expect.arrayContaining(["ben"]));
  });

  it("caps open blocking asks at three, and never caps the rest", async () => {
    for (const to of ["ben", "cai", "ben"]) expect((await ask(to, { blocking: true, link: `https://x.example/${Math.random()}` })).status).toBe(201);
    const fourth = await ask("cai", { blocking: true, link: "https://x.example/fourth" });
    expect(fourth.status).toBe(409);
    expect(fourth.body.error).toMatch(/3 asks marked as blocking/);
    expect((await ask("cai", { blocking: false, link: "https://x.example/fifth" })).status).toBe(201);

    // Closing one frees a place.
    me = PEOPLE.ben;
    const bens = await call("GET", "/api/asks");
    expect((await call("POST", `/api/asks/${bens.body.waitingOnYou[0].id}/done`)).status).toBe(200);
    me = PEOPLE.ana;
    expect((await ask("cai", { blocking: true, link: "https://x.example/again" })).status).toBe(201);
  });

  it("lets nobody outside the two members read or move an ask, and says nothing about it", async () => {
    const id = (await ask("ben")).body.ask.id;
    me = PEOPLE.cai;
    expect((await call("GET", "/api/asks")).body).toEqual({ waitingOnYou: [], yourAsks: [] });
    for (const door of ["done", "not-mine", "withdraw"]) {
      const r = await call("POST", `/api/asks/${id}/${door}`);
      expect(r.status).toBe(404);
      expect(r.body.error).toBe("There is no ask here for you.");
    }
    // Each member only on their own side: the asker cannot mark it done, the asked cannot withdraw it.
    me = PEOPLE.ana;
    expect((await call("POST", `/api/asks/${id}/done`)).status).toBe(404);
    me = PEOPLE.ben;
    expect((await call("POST", `/api/asks/${id}/withdraw`)).status).toBe(404);
    expect((await rows())[0].status).toBe("open");
    // Nobody signed in at all.
    me = null;
    expect((await call("GET", "/api/asks")).status).toBe(401);
  });

  it("hands an ask back once, tells the asker, and refuses sending the same link straight back", async () => {
    const id = (await ask("ben")).body.ask.id;
    notices.length = 0;
    me = PEOPLE.ben;
    expect((await call("POST", `/api/asks/${id}/not-mine`, { note: "Cai owns the docs" })).status).toBe(200);
    expect(notices).toEqual([expect.objectContaining({ userId: "ana", dedupeKey: `ask:${id}:handed-back:ana` })]);
    // A second tap finds it closed.
    expect((await call("POST", `/api/asks/${id}/not-mine`)).status).toBe(409);

    me = PEOPLE.ana;
    const mine = await call("GET", "/api/asks");
    expect(mine.body.yourAsks[0]).toMatchObject({ status: "handed_back", handBackNote: "Cai owns the docs" });
    const again = await ask("ben");
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already said this one is not theirs/);
    // Somebody else can take it, and Ben can still be asked about something else.
    expect((await ask("cai")).status).toBe(201);
    expect((await ask("ben", { link: "https://docs.example.org/d/2" })).status).toBe(201);
  });

  it("tells the asker when it is done, once", async () => {
    const id = (await ask("ben")).body.ask.id;
    notices.length = 0;
    me = PEOPLE.ben;
    expect((await call("POST", `/api/asks/${id}/done`)).status).toBe(200);
    expect((await call("POST", `/api/asks/${id}/done`)).status).toBe(409);
    expect(notices).toEqual([expect.objectContaining({ userId: "ana", dedupeKey: `ask:${id}:done:ana` })]);
  });

  it("refuses a link a click could turn against the member, and asking yourself", async () => {
    expect((await ask("ben", { link: "javascript:alert(1)" })).status).toBe(400);
    expect((await ask("ben", { link: "//evil.example" })).status).toBe(400);
    expect((await ask("ana")).status).toBe(400);
    expect(await rows()).toEqual([]);
  });

  it("erasing a member takes every ask they are on, and only those", async () => {
    await ask("ben");
    me = PEOPLE.ben;
    await ask("ana");
    await ask("cai", { link: "https://x.example/ben-cai" });
    me = PEOPLE.cai;
    await ask("ben", { link: "https://x.example/cai-ben" });
    await forgetAsksForMember(pool, "ana");
    const left = await rows();
    expect(left.map((r: any) => `${r.asker_user_id}>${r.asked_user_id}`).sort()).toEqual(["ben>cai", "cai>ben"]);
    await forgetAsksForMember(pool, "ana"); // a second pass matches nothing
    expect(await rows()).toHaveLength(2);
  });
});
