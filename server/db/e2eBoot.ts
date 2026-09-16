/**
 * WAIT FOR THE BUILT SERVER TO ANSWER `/health`, AND SAY WHY IF IT NEVER DOES.
 *
 * Fifty-odd e2e files copy one loop: poll `GET /health` every 400ms, break on
 * `.ok`, swallow every error as "not up yet", and at the deadline throw
 * `server did not start in 120s` with the server's log attached. That log could
 * say the server HAD started, and the loop had already thrown away the one fact
 * that explained the contradiction.
 *
 * WHAT IT HID. `server/adminTokens.e2e.test.ts` failed CI three times this way
 * (runs 34402302295, 34909817840 and 34940009505, on three unrelated branches),
 * each time with `[startup] Server listening` in the log and each time about
 * 121s after the file began. The passing re-run of the same tree finished the
 * WHOLE file, seven tests included, in 2.1s, so boot was never the slow part.
 * The ports were 6679, 6669 and 6668. All three are on the Fetch standard's
 * "bad port" list (https://fetch.spec.whatwg.org/#port-blocking), and Node's
 * `fetch` rejects a URL on one of them with `TypeError: fetch failed`, cause
 * `bad port`, before it opens a socket. The server was up and healthy; the poll
 * could not dial it and filed every refusal under "not up yet" for two minutes.
 * `http.get` to the same port answers 200. `server/db/e2eBoot.test.ts`
 * reproduces exactly that.
 *
 * `scripts/check-e2e-ports.mjs` now refuses a port window holding one of those
 * ports, which removes the cause. This removes the silence. The error names the
 * last thing `/health` said (a status and its body, or the fetch error and its
 * cause), when "Server listening" appeared in the log, and it stops at once for
 * the two cases more waiting cannot fix: a port fetch refuses, and a server
 * process that has already exited.
 */
import type { ChildProcess } from "node:child_process";
import { E2E_BOOT_DEADLINE_MS } from "./testDb";

/** What `server/index.ts` prints from inside `server.listen`'s callback. */
export const LISTENING_LINE = "Server listening on";

/**
 * One poll's own ceiling. `/health` gives its database probe 3s
 * (`DB_PROBE_BUDGET_MS` in server/index.ts), so a poll silent for 10s is hung,
 * and a hung poll must not carry the wait past vitest's hook timeout, whose
 * message says only "Hook timed out" and drops the server log.
 */
const POLL_TIMEOUT_MS = 10_000;

export interface WaitForHealthOptions {
  /** Origin of the spawned server, e.g. `http://127.0.0.1:6700`. */
  base: string;
  /** The chunks the suite collects from the child's stdout and stderr. Re-read on every poll. */
  logs: readonly string[];
  /** The spawned process, so a server that has already died is reported at once. */
  child?: Pick<ChildProcess, "exitCode" | "signalCode"> | null;
  /** Defaults to `E2E_BOOT_DEADLINE_MS`. Only this helper's own test should pass anything else. */
  deadlineMs?: number;
  /** Defaults to 400ms, the interval every copied loop used. */
  intervalMs?: number;
}

export interface HealthAnswer {
  /** Milliseconds from the first poll to the 2xx. */
  ms: number;
  /** When the listening line was first seen, to within one poll, or null if it never was. */
  listeningAtMs: number | null;
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/** A fetch rejection in words. undici puts the actual reason on `cause`, never on the message. */
function describeFetchError(e: unknown): { text: string; badPort: boolean } {
  const err = e as { name?: string; message?: string; cause?: { message?: string; code?: string } } | undefined;
  const cause = String(err?.cause?.message ?? err?.cause?.code ?? "");
  const text = `fetch threw ${err?.name ?? "Error"}: ${err?.message ?? String(e)}${cause ? ` (cause: ${cause})` : ""}`;
  return { text, badPort: /\bbad port\b/i.test(cause) };
}

/**
 * Poll `${base}/health` until it answers 2xx. Resolves with how long that took;
 * throws, with the evidence, when it will not.
 */
export async function waitForHealth(opts: WaitForHealthOptions): Promise<HealthAnswer> {
  const deadlineMs = opts.deadlineMs ?? E2E_BOOT_DEADLINE_MS;
  const intervalMs = opts.intervalMs ?? 400;
  const url = `${opts.base}/health`;
  const started = Date.now();
  let listeningAtMs: number | null = null;
  let last = "no poll had finished";
  let lastAtMs = 0;

  const refuse = (headline: string): Error =>
    new Error(
      [
        headline,
        `  last /health poll, at ${seconds(lastAtMs)}: ${last}`,
        listeningAtMs === null
          ? `  "${LISTENING_LINE}" never appeared in the server log`
          : `  "${LISTENING_LINE}" appeared in the server log at ${seconds(listeningAtMs)}`,
        `  gave up at ${seconds(Date.now() - started)}`,
        "Server log:",
        opts.logs.join(""),
      ].join("\n"),
    );

  for (;;) {
    if (listeningAtMs === null && opts.logs.join("").includes(LISTENING_LINE)) {
      listeningAtMs = Date.now() - started;
    }
    const child = opts.child;
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw refuse(
        `server exited before /health answered (exit code ${child.exitCode}, signal ${child.signalCode})`,
      );
    }
    if (Date.now() - started > deadlineMs) {
      throw refuse(`server did not start in ${deadlineMs / 1000}s`);
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(POLL_TIMEOUT_MS) }); // module-review-ok: the e2e boot poll against the spawned local test server
      if (res.ok) {
        await res.arrayBuffer().catch(() => undefined);
        return { ms: Date.now() - started, listeningAtMs };
      }
      const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 300);
      last = `HTTP ${res.status}${body ? ` ${body}` : ""}`;
      lastAtMs = Date.now() - started;
    } catch (e) {
      const { text, badPort } = describeFetchError(e);
      last = text;
      lastAtMs = Date.now() - started;
      if (badPort) {
        throw refuse(
          `${url} is on a port the fetch API refuses to dial. The Fetch standard's "bad port" list blocks it ` +
            `before any socket opens, so the server can be up and healthy and this suite will still never ` +
            `reach it. Move the suite's port window off that port: node scripts/check-e2e-ports.mjs names ` +
            `the blocked ports in every window and the widest clean stretch left.`,
        );
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
