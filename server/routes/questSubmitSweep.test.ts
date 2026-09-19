/**
 * WHAT A FAILING BELL COSTS A MEMBER WHO HAS ALREADY HANDED IN THEIR WORK.
 *
 * `POST /api/game/quests/:id/submit` flips the claim to `submitted` under its
 * row lock, commits, and only then rings every steward who may consent. That
 * sweep used to await `notify` with nothing around it, inside the response
 * path, so one recipient whose notification threw answered 500 to a member
 * whose work HAD been handed in, and stopped the loop where it stood: every
 * steward after the failing one was never rung at all.
 *
 * The second half is what makes it stick. The member reads the 500, submits
 * again, and `notify`'s dedupe key correctly refuses to ring anybody twice, so
 * the stewards who were skipped the first time stay skipped for good. A bell
 * that never rings leaves no trace anywhere else in the product.
 *
 * WHY THE FAILING RECIPIENT IS IN THE MIDDLE. A failure on the last recipient
 * would pass against a loop that stops at the first failure, because there is
 * nobody after it. The one that fails here is second of three, so both the
 * steward before it and the steward after it have to be rung.
 *
 * Runs against the S5 harness. No TEST_DATABASE_URL and the suite skips loudly.
 */
import http from "node:http";
import os from "node:os";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { claimsRepo, questsRepo, type ClaimsRepo, type QuestsRepo } from "../repos/quests";
import { register as registerQuestRoutes } from "./quests";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[questSubmitSweep.test] TEST_DATABASE_URL not set, so this suite is SKIPPED.");
}

/** The member doing the work. */
const ADA = { id: "u-ada", name: "Ada Wren" };
/** Three stewards who may consent, in the order the sweep reads them. */
const MARA = { id: "u-mara", name: "Mara Voss" };
const TOMAS = { id: "u-tomas", name: "Tomas Reyes" };
const IRIS = { id: "u-iris", name: "Iris Nkemi" };

let db: TestDb;
let pool: mysql.Pool;
let server: http.Server;
let base = "";
let claims: ClaimsRepo;
let quests: QuestsRepo;

/** What the sweep is told, and what it manages to do. */
const ctl = {
  /** Who may consent. */
  recipients: [MARA.id, TOMAS.id, IRIS.id] as string[],
  /** The recipient whose bell throws, if any. */
  failFor: null as string | null,
  /** Whether every bell throws, which is the notification path being down. */
  failAll: false,
  /** Whether reading the recipients throws at all. */
  cannotRead: false,
  /** Every bell that actually rang. */
  rung: [] as string[],
};

const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, { // module-review-ok: the suite's own in-process server on 127.0.0.1, never an outbound call, so there is no correlation id to carry
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
};

const claimRow = async (id: string) => {
  const [rows]: any = await pool.query( // module-review-ok: reading back what the route wrote, on the S5 scratch schema this suite provisioned
    "SELECT status, note FROM quest_claims WHERE id = ?",
    [id],
  );
  return (rows[0] ?? null) as { status: string; note: string | null } | null;
};

/** Ada takes a quest and hands work in. Answers the submit response. */
const claimAndSubmit = async (questId: string) => {
  await quests.add({ id: questId, title: "Tend the swale", gratitude: "50-100", status: "Open", tags: [], order: 1 });
  const claimed = await call("POST", `/api/game/quests/${questId}/claim`);
  expect(claimed.status).toBe(200);
  const submitted = await call("POST", `/api/game/quests/${questId}/submit`, { note: "Dug the first ten metres." });
  return { claimId: String(claimed.body.id), submitted };
};

describe.skipIf(!configured)("what a failing bell costs a submission (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    claims = claimsRepo(pool);
    quests = questsRepo(pool);

    const deps: any = {
      isAdmin: async () => false,
      authedUser: async () => ADA,
      adminActor: () => null,
      getPool: () => pool,
      uploadsDir: os.tmpdir(),
      members: { all: async () => [], byId: async () => null, update: async () => null },
      questsRepo: quests,
      claimsRepo: claims,
      crewsRepo: {},
      firstName: (n: string) => String(n).split(" ")[0],
      notify: async (n: { userId: string }) => {
        if (ctl.failAll || n.userId === ctl.failFor) throw new Error(`the bell for ${n.userId} could not be delivered`);
        ctl.rung.push(n.userId);
      },
      stageOf: async () => "member",
      loadRoles: () => [],
      roleIdsFor: () => [],
      currentPatternId: () => null,
      questConsentRecipients: async () => {
        if (ctl.cannotRead) throw new Error("the roles table did not answer");
        return ctl.recipients;
      },
      overLimit: async () => false,
      clientIp: () => "127.0.0.1",
    };

    const app = express();
    app.use(express.json());
    registerQuestRoutes(app, deps);
    // The terminal handler the server installs, so an unguarded throw shows up
    // here as the 500 a member would really see instead of an open socket.
    app.use((_err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: "Internal server error" });
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }, 300_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(() => {
    ctl.recipients = [MARA.id, TOMAS.id, IRIS.id];
    ctl.failFor = null;
    ctl.failAll = false;
    ctl.cannotRead = false;
    ctl.rung = [];
  });

  it("rings every steward but the doer when nothing fails, which is what gives the rest meaning", async () => {
    // Ada is in the recipient list on purpose: the sweep skips the person who
    // just handed the work in, and that skip has to survive the guards.
    ctl.recipients = [MARA.id, ADA.id, TOMAS.id];
    const { submitted } = await claimAndSubmit("q-sweep-clean");
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe("submitted");
    expect(ctl.rung).toEqual([MARA.id, TOMAS.id]);
  });

  it("answers the member and rings the others when one steward's bell throws", async () => {
    ctl.failFor = TOMAS.id;
    const { claimId, submitted } = await claimAndSubmit("q-sweep-one-fails");

    // The work is in. It was in before the first bell rang.
    expect(submitted.status, "a bell is not the submission").toBe(200);
    expect(submitted.body.status).toBe("submitted");
    expect(await claimRow(claimId)).toEqual({ status: "submitted", note: "Dug the first ten metres." });

    // And the steward AFTER the failing one was still rung, which is the half
    // a loop that stops at the first failure gets wrong.
    expect(ctl.rung).toEqual([MARA.id, IRIS.id]);
  });

  it("answers the member when the village cannot say who to ring at all", async () => {
    ctl.cannotRead = true;
    const { claimId, submitted } = await claimAndSubmit("q-sweep-no-list");

    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe("submitted");
    expect(await claimRow(claimId)).toEqual({ status: "submitted", note: "Dug the first ten metres." });
    expect(ctl.rung).toEqual([]);
  });

  it("still answers the member when the whole notification path is down", async () => {
    // The pathological case, and the one that says the guards are not just
    // catching a single unlucky recipient: every bell throws, and the member's
    // work is still handed in with nothing about the claim different.
    ctl.failAll = true;
    const { claimId, submitted } = await claimAndSubmit("q-sweep-all-fail");

    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe("submitted");
    expect(await claimRow(claimId)).toEqual({ status: "submitted", note: "Dug the first ten metres." });
    expect(ctl.rung).toEqual([]);
  });
});
