/**
 * Where a crash goes (PY6).
 *
 * Until now an unhandled error printed to stdout and vanished with the next
 * deploy. That is survivable for a website. It is not survivable for a
 * platform that moves money: a settle handler throwing at 3am, a scheduler job
 * dying silently, a boot invariant tripping on a fork nobody is watching — all
 * of it landed in a log stream nobody reads, and the first anyone heard was a
 * member saying "I paid and nothing happened".
 *
 * Deliberately NOT an SDK. A third-party error service is one more vendor,
 * one more key, one more thing that can be down, and — since exception
 * payloads carry request context — one more place village data ends up. The
 * shape here is a plain HTTPS POST that any of them accepts, plus two sinks
 * that need no vendor at all:
 *
 *   1. ALWAYS: an admin notification, so a crash is visible inside the app to
 *      the people responsible for it, whether or not anything else is set up.
 *   2. OPTIONAL: a webhook (`ERROR_WEBHOOK_URL`) — Sentry's store endpoint, a
 *      Slack incoming webhook, Discord, or a fork's own collector.
 *
 * Deduped by a fingerprint of the message and top frame, because the failure
 * mode of every alerting system is the same one: a loop that fires ten
 * thousand identical alerts and teaches everyone to mute the channel.
 */
import { guardedFetchJson } from "./toolcheck";

export interface ErrorContext {
  /** Where it happened, in words a steward can act on: "stripe webhook". */
  where: string;
  /** Anything safe to attach. NEVER tokens, bodies, or member PII. */
  detail?: Record<string, string | number | boolean | null>;
}

type Reporter = (title: string, dedupeKey: string) => Promise<void>;

/**
 * WHAT THE ALARM ACTUALLY DID, said out loud.
 *
 * An alerting call that returns `void` cannot be distinguished from an
 * alerting call that reached nobody, and the second is the normal state of a
 * fresh village: `ERROR_WEBHOOK_URL` is unset until an operator sets it, and
 * the admin sink needs a database that a boot failure has often just proved
 * unreachable. A caller that is about to exit the process needs to be able to
 * print whether anything left the building, so the log line at least names the
 * silence instead of implying delivery.
 */
export interface ErrorDelivery {
  /** Reported before, inside the dedupe window: the log has it, no sink was called. */
  suppressed: boolean;
  admins: "sent" | "failed" | "not wired";
  webhook: "sent" | "failed" | "not configured";
}

/** True when this report reached at least one place a person can look. */
export function reachedSomebody(d: ErrorDelivery): boolean {
  return d.admins === "sent" || d.webhook === "sent";
}

let notifyAdmins: Reporter | null = null;
let instanceLabel = "village";

/** Wired once at boot, so this module needs no import from index.ts. */
export function wireErrorReporting(opts: { notifyAdmins: Reporter; instanceLabel: string }): void {
  notifyAdmins = opts.notifyAdmins;
  instanceLabel = opts.instanceLabel;
}

/**
 * One line per distinct failure per window. The window is deliberately long:
 * the second identical crash tells you nothing the first did not, and the
 * cost of a noisy channel is that the loud one gets ignored too.
 */
const WINDOW_MS = 60 * 60 * 1000;
const lastSeen = new Map<string, number>();

/** Message + top stack frame. Stable across repeats, distinct across causes. */
function fingerprint(err: unknown, where: string): string {
  const e = err as any;
  const msg = String(e?.message ?? e ?? "unknown");
  const frame = String(e?.stack ?? "").split("\n")[1]?.trim() ?? "";
  return `${where}|${msg.slice(0, 120)}|${frame.slice(0, 120)}`;
}

export async function reportError(err: unknown, ctx: ErrorContext): Promise<ErrorDelivery> {
  const e = err as any;
  const message = String(e?.message ?? e ?? "unknown error");
  const key = fingerprint(err, ctx.where);
  const now = Date.now();
  const seen = lastSeen.get(key) ?? 0;
  const repeat = now - seen < WINDOW_MS;
  lastSeen.set(key, now);
  // Bounded: a pathological loop with unique messages must not become a leak.
  if (lastSeen.size > 500) lastSeen.clear();

  // The log always gets it, repeat or not — that is what a log is for.
  console.error(`[error] ${ctx.where}: ${message}`, ctx.detail ?? {}, e?.stack ?? "");
  if (repeat) return { suppressed: true, admins: "not wired", webhook: "not configured" };

  const delivery: ErrorDelivery = { suppressed: false, admins: "not wired", webhook: "not configured" };

  if (notifyAdmins) {
    try {
      await notifyAdmins(
        `Something broke in ${ctx.where}: ${message.slice(0, 200)}`,
        `error:${key.slice(0, 120)}`,
      );
      delivery.admins = "sent";
    } catch {
      /* an alarm that fails must not become the crash */
      delivery.admins = "failed";
    }
  }

  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return delivery;
  try {
    // Through the pinned-IP dialer, like every other outbound call: an
    // admin-settable URL is exactly the shape SSRF lives in.
    await guardedFetchJson(url, 5000, {
      method: "POST",
      body: {
        // A shape Slack, Discord and generic collectors all accept, with the
        // structured fields underneath for anything that reads them.
        text: `[${instanceLabel}] ${ctx.where}: ${message}`,
        instance: instanceLabel,
        where: ctx.where,
        message,
        stack: String(e?.stack ?? "").slice(0, 4000),
        detail: ctx.detail ?? {},
        at: new Date().toISOString(),
      },
    });
    delivery.webhook = "sent";
  } catch (sendErr) {
    console.error("[error] could not reach ERROR_WEBHOOK_URL", sendErr);
    delivery.webhook = "failed";
  }
  return delivery;
}

/**
 * REPORT, THEN GIVE UP ON REPORTING. For callers that are about to exit.
 *
 * `reportError` awaits two sinks that can both hang for longer than a dying
 * process should wait. The admin sink is a database write, and the failure
 * that most needs reporting, a boot that could not reach MySQL, is exactly
 * the one where that write sits on a connect timeout. So the caller gets a
 * deadline and an answer either way: the webhook needs no database and no
 * schema, which is what makes it the sink that survives the interesting
 * failures.
 *
 * On timeout the in-flight report is NOT cancelled; it is abandoned. If it
 * lands a moment later, good, and if the process exits first, the log line
 * already said the alarm did not confirm.
 */
export async function reportErrorWithin(
  budgetMs: number,
  err: unknown,
  ctx: ErrorContext,
): Promise<ErrorDelivery | "timed out"> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race<ErrorDelivery | "timed out">([
      reportError(err, ctx).catch((reportErr) => {
        // reportError swallows its own sink failures; anything reaching here
        // is a bug in the reporter, and a bug in the reporter must not become
        // the reason nobody hears about the original crash.
        console.error("[error] the error reporter itself threw", reportErr);
        return { suppressed: false, admins: "failed", webhook: "failed" } as ErrorDelivery;
      }),
      new Promise<"timed out">((resolve) => {
        timer = setTimeout(() => resolve("timed out"), budgetMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The last line of defence. Node's default for an unhandled rejection is to
 * crash the process; that is correct, but it must not happen QUIETLY.
 */
export function installCrashHandlers(): void {
  process.on("unhandledRejection", (reason) => {
    void reportError(reason, { where: "an unhandled promise" });
  });
  process.on("uncaughtException", (err) => {
    void reportError(err, { where: "an uncaught exception" });
    // Give the alert a moment to leave, then let the platform restart us. A
    // process that keeps running after an uncaught exception is in a state
    // nobody has reasoned about, and this one moves money.
    setTimeout(() => process.exit(1), 2000).unref();
  });
}

/*
 * ────────────────────────────────────────────────────────────────────────────
 * SHUTDOWN. What happens to the requests that were in the middle of happening.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Until this landed, this process handled `unhandledRejection` and
 * `uncaughtException` and NOTHING ELSE. No SIGTERM handler at all. Node's own
 * default for SIGTERM is to terminate immediately, so every deploy killed
 * whatever was in flight: a member's upload half-written, a settle handler
 * between two ledger writes, an admin's save that had answered nothing yet.
 * Railway redeploys on every push. This is not a rare path.
 *
 * ── WHAT DRAINING ACTUALLY REQUIRES, AND THE PART EVERY VERSION MISSES ───
 *
 * `server.close()` alone does not drain. It stops the listener and then waits
 * for every open connection to end, and a browser or a fetch client with
 * keep-alive holds its socket open for MINUTES after its last request. So the
 * naive version hangs until the platform's grace period runs out and SIGKILLs
 * it, which drops exactly the in-flight requests it was trying to save. The
 * two pieces that make it real are `closeIdleConnections()` (sockets with no
 * request on them go now) and, at the deadline, `closeAllConnections()`.
 *
 * ── ASK WHAT THE NUMBER READS WHEN THE CHECK DID NOT RUN ─────────────────
 *
 * A drain that cannot finish must still END. The deadline is not advisory: at
 * `drainMs` every remaining connection is cut and the process exits anyway,
 * and the outcome says `forced: true` so the log records that requests were
 * severed rather than implying a clean stop. "Waited politely forever" is the
 * same outcome as no handler at all, arrived at more slowly.
 *
 * ── WHY THE SEAMS ARE ARGUMENTS ──────────────────────────────────────────
 *
 * `exit` and the clock are injected so the behaviour can be tested against a
 * real HTTP server with a real in-flight request. They are not injected so
 * they can be mocked away: the tests drive a real `http.Server` and a real
 * socket, and only the final `process.exit` is stubbed, because a test that
 * exits the runner proves nothing to anybody.
 */

/** How long in-flight work gets before its connection is cut. */
export const DEFAULT_DRAIN_MS = 15_000;

export interface ShutdownOutcome {
  /** The signal or reason that started it. */
  reason: string;
  /** True when the deadline expired and open connections were severed. */
  forced: boolean;
  /** Milliseconds from first signal to exit. */
  ms: number;
  pool: "closed" | "failed" | "not wired";
}

export interface ShutdownDeps {
  /** The listening server. Node's http.Server satisfies this structurally. */
  server: {
    close(cb?: (err?: Error) => void): unknown;
    closeIdleConnections?: () => void;
    closeAllConnections?: () => void;
  };
  /** The database pool, so a redeploy does not leave connections behind. */
  closePool?: () => Promise<void>;
  /** Defaults to DEFAULT_DRAIN_MS, or SHUTDOWN_DRAIN_MS from the environment. */
  drainMs?: number;
  /** Defaults to `process.exit`. Stubbed in tests, never in production. */
  exit?: (code: number) => void;
}

/** True once a shutdown has begun. Idempotent guard, and readable by callers. */
let shuttingDown = false;
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/** Test-only reset. Module state that a suite cannot clear is a flaky suite. */
export function resetShutdownStateForTests(): void {
  shuttingDown = false;
}

function drainBudget(deps: ShutdownDeps): number {
  if (typeof deps.drainMs === "number") return deps.drainMs;
  const fromEnv = Number(process.env.SHUTDOWN_DRAIN_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_DRAIN_MS;
}

/**
 * Stop listening, let what is in flight finish, close the pool, exit.
 *
 * Returns the outcome rather than only logging it, for the same reason
 * `reportError` returns an `ErrorDelivery`: "we shut down cleanly" is a claim,
 * and a caller that cannot inspect it cannot tell a drain from a severing.
 */
export async function gracefulShutdown(
  deps: ShutdownDeps,
  reason: string,
): Promise<ShutdownOutcome> {
  const startedAt = Date.now();
  const budget = drainBudget(deps);
  let forced = false;

  console.log(`[shutdown] ${reason}: no longer accepting connections, draining up to ${budget}ms`);

  const closed = new Promise<void>((resolve) => {
    // `close` fires its callback when the LAST connection ends, which is the
    // event worth waiting for; the listener itself stops on the call.
    deps.server.close(() => resolve());
  });
  /*
   * Keep-alive sockets with nothing on them are not work in progress. Cutting
   * them is the difference between draining and hanging.
   *
   * ON A SWEEP, NOT ONCE. The single call was measured taking three seconds to
   * drain one request that finished in milliseconds: the socket was BUSY when
   * the sweep ran, went idle the instant the response was written, and then
   * nothing released it until the client felt like it. Every real deploy has
   * browsers and fetch clients holding exactly that kind of socket, so a
   * one-shot sweep spends the whole budget on connections with nothing left to
   * say. Sweeping releases each one on the tick after it goes quiet.
   */
  deps.server.closeIdleConnections?.();
  const sweep = setInterval(() => deps.server.closeIdleConnections?.(), 250);
  sweep.unref?.();

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<"forced">((resolve) => {
    timer = setTimeout(() => resolve("forced"), budget);
  });
  const outcome = await Promise.race([closed.then(() => "drained" as const), deadline]);
  if (timer) clearTimeout(timer);
  clearInterval(sweep);

  if (outcome === "forced") {
    forced = true;
    console.error(
      `[shutdown] ${budget}ms elapsed with requests still open; cutting them. ` +
        "Some in-flight work was severed.",
    );
    deps.server.closeAllConnections?.();
  } else {
    console.log("[shutdown] every in-flight request finished");
  }

  let pool: ShutdownOutcome["pool"] = "not wired";
  if (deps.closePool) {
    try {
      await deps.closePool();
      pool = "closed";
    } catch (e) {
      pool = "failed";
      console.error("[shutdown] the pool did not close cleanly", e);
    }
  }

  const result: ShutdownOutcome = { reason, forced, ms: Date.now() - startedAt, pool };
  console.log(
    `[shutdown] done in ${result.ms}ms (forced: ${result.forced}, pool: ${result.pool})`,
  );
  (deps.exit ?? ((code: number) => process.exit(code)))(0);
  return result;
}

/**
 * Wire SIGTERM and SIGINT to the drain above.
 *
 * SIGTERM is the platform's; SIGINT is the operator's Ctrl-C, and it gets the
 * same treatment because a local run that severs its own requests teaches the
 * wrong thing about what a deploy does.
 *
 * A SECOND signal does not start a second drain. It shortens the first one to
 * nothing: somebody pressing Ctrl-C twice means "now", and a handler that
 * ignored them would be one more reason to reach for `kill -9`.
 *
 * ON WINDOWS THIS WIRING CANNOT BE EXERCISED. Node on Windows terminates the
 * target process unconditionally for SIGTERM (measured: a listener registered
 * in a child never ran, and neither did one registered for a self-kill), so
 * the signal-delivery hop is provable only on the Linux container this
 * actually deploys to. Everything downstream of the listener is driven
 * directly by the tests, which is why `gracefulShutdown` is exported.
 */
export function installShutdownHandlers(deps: ShutdownDeps): void {
  const start = (signal: string) => {
    if (shuttingDown) {
      console.error(`[shutdown] ${signal} again: exiting now, without draining`);
      (deps.exit ?? ((code: number) => process.exit(code)))(1);
      return;
    }
    shuttingDown = true;
    void gracefulShutdown(deps, signal);
  };
  process.on("SIGTERM", () => start("SIGTERM"));
  process.on("SIGINT", () => start("SIGINT"));
}

/**
 * THE TERMINAL HANDLER'S WHOLE ANSWER, so `server/index.ts` keeps two lines.
 *
 * ── WHY A CONFLICT IS NOT AN INTERNAL ERROR ────────────────────────────────
 *
 * `replaceAll` in server/repos/store-db.ts throws `StaleSnapshotError` when the
 * snapshot a writer stamped has fallen out of the retained history, and NOTHING
 * WAS WRITTEN. It was caught nowhere in the codebase, so it reached the terminal
 * handler and answered 500. Whoever was seating a steward, or saving any other
 * whole-collection write, saw an unexplained server error on a request that had
 * done exactly the right thing and simply lost a race.
 *
 * It is answered from the ONE terminal handler rather than at the routes that
 * happen to have met it, because it is not that two routes forgot: every route
 * calling `replaceAll` can raise it, so catching it at two call sites would
 * leave the rest answering 500 while the defect looked closed.
 *
 * 409 CONFLICT, because the request disagreed with the current state and
 * retrying after a fresh read is exactly the right response. The error's own
 * message names the table and both version numbers, which belongs in the log
 * and never on a member's screen, so the sentence returned says what happened
 * and what to do and nothing about our schema.
 *
 * Matched on the `code` field rather than with `instanceof`, so this module
 * needs no dependency on the repo layer and a second copy of the class across a
 * bundle boundary cannot make the check silently miss.
 */
export interface TerminalAnswer {
  status: number;
  body: { error: string; code?: string };
  /** Which console channel this deserves. A lost race is not a fault. */
  level: "warn" | "error";
  /** What the log gets, which is always the full detail. */
  detail: string;
}

export function terminalAnswerFor(err: unknown): TerminalAnswer {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  if ((err as { code?: unknown } | null | undefined)?.code === "stale_snapshot") {
    return {
      status: 409,
      body: {
        error:
          "Somebody else changed this while you were working on it. Nothing was saved. " +
          "Reload and make the change again.",
        code: "stale_snapshot",
      },
      level: "warn",
      detail,
    };
  }
  return { status: 500, body: { error: "Internal server error" }, level: "error", detail };
}

/** Log it on the right channel and answer. The handler itself stays two lines. */
export function respondToTerminalError(
  err: unknown,
  res: { status(code: number): { json(body: unknown): unknown } },
): void {
  const answer = terminalAnswerFor(err);
  if (answer.level === "warn") console.warn("[route conflict]", answer.detail);
  else console.error("[route error]", answer.detail);
  res.status(answer.status).json(answer.body);
}
