/**
 * A REJECTED ASYNC HANDLER MUST ANSWER, ON EVERY VERB THIS SERVER REGISTERS.
 *
 * THE DEFECT THIS PINS. `SEASON2_FLEET_LEDGER.md` carried an item saying an
 * async route handler that throws is an unhandled rejection instead of a 500,
 * so the caller's request is never answered at all. Under Express 4 that was
 * half true, and the half matters:
 *
 *   - `server/index.ts` patched `app.get/post/put/delete` at registration so a
 *     returned rejecting promise had `.catch(next)` attached. Those four verbs
 *     reached the terminal error handler and answered 500.
 *   - `app.patch` and `app.all` were NOT in that list. Measured against
 *     Express 4.22.2: a rejecting `app.patch` handler answered nothing at all
 *     and the socket stayed open until the client gave up, while
 *     `installCrashHandlers` reported the rejection to admins. Five `app.patch`
 *     routes and two `app.all` routes were live on that gap, `PATCH
 *     /api/forum/:kind/:id` and `PATCH /api/messages/:id` among them.
 *
 * Express 5 forwards a rejected handler promise to the error pipeline itself,
 * for every verb, which is what let the hand-rolled wrapper be deleted.
 *
 * WHY THIS TEST IS SHAPED LIKE THIS. The property worth guarding is not "the
 * repository still contains a wrapper", because the wrapper is gone and the
 * behaviour now comes from the dependency. It is "a handler that throws
 * produces a STATUS on every verb we register". That survives the wrapper's
 * deletion, it fails loudly if anyone pins Express back to 4, and it fails
 * loudly if a future verb is registered that the router treats differently.
 *
 * THE DEADLINE IS THE ASSERTION. A hung request and a slow request look
 * identical to a test that simply awaits, so every call below carries an
 * abort deadline and a timeout is recorded as the ledger's own symptom rather
 * than surfacing as an opaque suite timeout.
 *
 * Port 0, read back from the listener, so this file allocates no window and
 * can never collide with an e2e suite. See scripts/check-e2e-ports.mjs.
 */
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Every routing verb server/index.ts and server/routes/*.ts register on `app`. */
const VERBS = ["get", "post", "put", "patch", "delete", "all"] as const;

/** Stands in for the real throwers: StaleSnapshotError from dbCollection.replaceAll, and putSecret. */
class StandInStoreError extends Error {
  constructor() {
    super("snapshot is older than the versions the store retains");
    this.name = "StandInStoreError";
  }
}

let server: http.Server;
let base = "";
const seenByErrorHandler: string[] = [];

beforeAll(async () => {
  const app = express();

  for (const verb of VERBS) {
    // `all` needs its own path: it would otherwise answer every other verb's.
    app[verb](`/throws/${verb}`, async () => {
      throw new StandInStoreError();
    });
  }

  // The same shape as the terminal handler in server/index.ts.
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    seenByErrorHandler.push(`${req.method} ${req.path}`);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: "Internal server error" });
  });

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** The status, or the word the ledger used, so a regression names itself. */
async function statusWithin(method: string, path: string, ms = 3000): Promise<number | string> {
  try {
    const res = await fetch(base + path, { method, signal: AbortSignal.timeout(ms) }); // module-review-ok: the test client dialling its own in-process server on localhost, as every e2e suite does
    return res.status;
  } catch {
    return `HUNG: no answer in ${ms}ms`;
  }
}

describe("a rejected async route handler answers instead of hanging", () => {
  for (const verb of VERBS) {
    const method = verb === "all" ? "OPTIONS" : verb.toUpperCase();

    it(`answers 500 on app.${verb}, and the error middleware saw it`, async () => {
      const before = seenByErrorHandler.length;
      const status = await statusWithin(method, `/throws/${verb}`);
      expect(status).toBe(500);
      // The 500 has to come from the error pipeline. A handler that answered
      // 500 by itself would satisfy the line above and prove nothing.
      expect(seenByErrorHandler.length).toBe(before + 1);
    });
  }

  it("leaves no unhandled rejection behind on any verb", async () => {
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => seen.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      for (const verb of VERBS) {
        await statusWithin(verb === "all" ? "OPTIONS" : verb.toUpperCase(), `/throws/${verb}`);
      }
      // A rejection reaches the handler on the turn after the response, so let
      // the microtask queue drain before deciding nothing was left over.
      await new Promise((resolve) => setTimeout(resolve, 250));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(seen).toEqual([]);
  });

  it("covers PATCH, which is the verb the old wrapper missed", async () => {
    // Named on its own because it is the one that actually hung in production
    // code paths, and because a loop is easy to quietly narrow later.
    expect(VERBS).toContain("patch");
    expect(await statusWithin("PATCH", "/throws/patch")).toBe(500);
  });
});
