/**
 * THE E2E BOOT POLL, DRIVEN AGAINST REAL SOCKETS.
 *
 * Every case stands up an ordinary HTTP server on this machine. The defect this
 * file pins lived between `fetch` and the socket, so a stubbed `fetch` would
 * have passed while CI kept failing: on a port the Fetch standard blocks, Node's
 * `fetch` refuses before it connects, and the copied boot loop called that
 * refusal "not up yet" until its deadline. See ./e2eBoot.ts for the three runs.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { waitForHealth } from "./e2eBoot";

/** Fetch-blocked ports an unprivileged process can bind. One free one is enough. */
const FETCH_BLOCKED_HIGH_PORTS = [6668, 6669, 6679, 6665, 6666, 6667, 6697, 6566, 6000, 5060, 5061, 4190, 4045, 3659, 10080];

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((done) => {
          s.closeAllConnections();
          s.close(() => done());
        }),
    ),
  );
});

function listen(handler: http.RequestListener, port = 0): Promise<number | null> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.once("error", () => resolve(null));
    server.listen(port, "127.0.0.1", () => {
      servers.push(server);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

async function listenOnFetchBlockedPort(handler: http.RequestListener): Promise<number> {
  for (const candidate of FETCH_BLOCKED_HIGH_PORTS) {
    const port = await listen(handler, candidate);
    if (port !== null) return port;
  }
  throw new Error(`every one of ${FETCH_BLOCKED_HIGH_PORTS.join(", ")} is taken on this machine, so there is nothing to drive`);
}

/** A port nothing is listening on: bind an ephemeral one, read it, let it go. */
async function closedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

const statusOverHttp = (port: number): Promise<number> =>
  new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: "/health" }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      })
      .on("error", reject);
  });

const healthy: http.RequestListener = (_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" }).end('{"status":"ok"}');
};

const degraded: http.RequestListener = (_req, res) => {
  res
    .writeHead(503, { "Content-Type": "application/json" })
    .end(JSON.stringify({ status: "degraded", database: { ok: false, error: "the database did not answer within 3000ms" } }));
};

const failure = (p: Promise<unknown>): Promise<Error> =>
  p.then(
    () => { throw new Error("expected the wait to throw, and it resolved"); },
    (e: unknown) => e as Error,
  );

describe("the e2e boot poll", () => {
  it("THE CI FAILURE: the copied loop reads a healthy server on a fetch-blocked port as a server that never started", async () => {
    const port = await listenOnFetchBlockedPort(healthy);
    expect(await statusOverHttp(port), "the server is up, and http.get reaches it").toBe(200);

    // The loop the e2e files carried, verbatim apart from a short deadline.
    const deadline = Date.now() + 1_500;
    let started = false;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) { started = true; break; } // module-review-ok: reproducing the copied boot poll against a local fixture server
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(started, "fetch never dials it, so the old loop waits out its whole deadline over a live server").toBe(false);
  });

  it("stops at once on a fetch-blocked port, and names the cause", async () => {
    const port = await listenOnFetchBlockedPort(healthy);
    const began = Date.now();
    const err = await failure(
      waitForHealth({
        base: `http://127.0.0.1:${port}`,
        logs: [`[startup] Server listening on 0.0.0.0:${port}\n`],
        deadlineMs: 60_000,
      }),
    );
    expect(Date.now() - began, "a wait that cannot help is not waited out").toBeLessThan(10_000);
    expect(err.message).toContain("refuses to dial");
    expect(err.message).toContain("(cause: bad port)");
    expect(err.message).toMatch(/"Server listening on" appeared in the server log at \d+\.\ds/);
  });

  it("reports a non-2xx answer with its status and the body the server sent", async () => {
    const port = await listen(degraded);
    const err = await failure(
      waitForHealth({ base: `http://127.0.0.1:${port}`, logs: [], deadlineMs: 600, intervalMs: 50 }),
    );
    expect(err.message).toMatch(/^server did not start in 0\.6s/);
    expect(err.message).toContain("HTTP 503");
    expect(err.message).toContain("the database did not answer within 3000ms");
    expect(err.message).toContain('"Server listening on" never appeared in the server log');
  });

  it("says when the listening line appeared, so a slow boot and a deaf poll read differently", async () => {
    const port = await listen(degraded);
    const logs: string[] = ["[seed] 8 circle(s) seeded\n"];
    setTimeout(() => logs.push("[startup] Server listening on 0.0.0.0:1\n"), 150);
    const err = await failure(
      waitForHealth({ base: `http://127.0.0.1:${port}`, logs, deadlineMs: 1_000, intervalMs: 50 }),
    );
    expect(err.message).toMatch(/"Server listening on" appeared in the server log at \d+\.\ds/);
    expect(err.message).toContain("[seed] 8 circle(s) seeded");
  });

  it("reports a refused connection as the fetch error and its cause", async () => {
    const port = await closedPort();
    const err = await failure(
      waitForHealth({ base: `http://127.0.0.1:${port}`, logs: [], deadlineMs: 300, intervalMs: 50 }),
    );
    expect(err.message).toContain("fetch threw TypeError: fetch failed");
    expect(err.message).toContain("ECONNREFUSED");
  });

  it("ends the wait at once when the server process has already exited", async () => {
    const port = await closedPort();
    const began = Date.now();
    const err = await failure(
      waitForHealth({
        base: `http://127.0.0.1:${port}`,
        logs: ["[startup] refusing to serve: boom\n"],
        child: { exitCode: 1, signalCode: null },
        deadlineMs: 60_000,
      }),
    );
    expect(Date.now() - began).toBeLessThan(5_000);
    expect(err.message).toContain("server exited before /health answered (exit code 1, signal null)");
    expect(err.message).toContain("refusing to serve: boom");
  });

  it("resolves on the first 2xx and says how long it took", async () => {
    let asked = 0;
    const port = await listen((req, res) => {
      asked += 1;
      if (asked < 3) degraded(req, res);
      else healthy(req, res);
    });
    const answer = await waitForHealth({ base: `http://127.0.0.1:${port}`, logs: [], deadlineMs: 5_000, intervalMs: 20 });
    expect(asked).toBe(3);
    expect(answer.ms).toBeGreaterThanOrEqual(0);
    expect(answer.listeningAtMs).toBeNull();
  });
});
