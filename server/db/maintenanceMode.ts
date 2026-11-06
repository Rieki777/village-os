/**
 * The page a founder or a member sees when a boot-time migration cannot
 * finish, instead of a bare 502 (item 3 of the data lane's Season 2 brief).
 *
 * WHY THIS EXISTS. `applyPending` (migrate.ts) is fail-loud on purpose: a
 * server that starts serving over a schema its own migrations could not
 * finish would be worse than a server that refuses to start at all. But
 * "refuses to start" today means the process throws before it ever binds a
 * port. Railway retries three times, gives up, and every member sees a bare
 * 502 with nothing behind it. A non-technical steward has no way to tell a
 * failed update from the site simply being down, and nothing tells them what
 * to do next.
 *
 * WHAT THIS DOES INSTEAD. `startMaintenanceServer` binds the same port the
 * real app would have bound, and answers every request with one plain page:
 * an honest sentence about what happened, a statement that no data was lost
 * (migrations stop at the first failed statement, by design, and nothing
 * after that point ever ran), and the exact technical detail to hand to
 * whoever operates this deployment. `/health` and `/api/platform/info`
 * answer with JSON instead of HTML, in roughly the same shape the real
 * `/health` route uses (see server/index.ts), so a Railway health check or
 * the fleet roller's prober sees a clear non-ok status rather than a 404.
 *
 * WHO WIRES THIS IN. This module is deliberately self-contained: it takes an
 * `ApplyFailureDetail` and a port, and does not import anything from
 * server/index.ts, which the data lane does not own. The intended call site
 * is `startServer`'s migration step in server/index.ts, catching the case
 * `applyPending` already reports (`result.failed`/`result.failedDetail`):
 * call `startMaintenanceServer` with that detail instead of letting the
 * process throw and exit. Filed as a blocker for the lane that owns that
 * file; see SEASON2_FLEET_LEDGER.md section 6.
 */
import http from "node:http";
import type { ApplyFailureDetail } from "./migrate";

/**
 * Why the server is refusing to come up normally: an update that stopped, or
 * (R132) a ledger that did not add up at boot. The ledger kind carries a count
 * and no account, because this page is public and the problem lines name
 * accounts; each one is in the server log under `[ledger invariant]`.
 */
export type MaintenanceDetail = ApplyFailureDetail | { kind: "ledger-invariant"; problems: number; message: string };

export interface MaintenanceServerOptions {
  /** Why the server is refusing to come up normally. */
  detail: MaintenanceDetail;
  /** Port to bind. Railway sets `PORT`; the caller decides how to read it. */
  port: number;
  /** Defaults to all interfaces, matching how the real app binds in production. */
  host?: string;
  /** Shown in the page and the JSON body. Defaults to a generic phrase. */
  instanceLabel?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** One honest headline and a couple of short, plain sentences, per failure kind. */
function humanSummary(detail: MaintenanceDetail): { headline: string; body: string[] } {
  switch (detail.kind) {
    case "ledger-invariant":
      return {
        headline: "The village's accounts did not add up when it started, so it stopped before serving anyone.",
        body: [
          "Every token's balances have to sum to zero, and only the accounts that issue a token may go below it. One of those checks failed, so the server refused to open the village on top of numbers it could not trust.",
          "Nothing was moved: the check runs before a single request is answered. Going back to the last version that worked does not fix the numbers, so send the detail below before anyone changes a balance by hand.",
        ],
      };
    case "migration-failed":
      return {
        headline: `An update stopped partway through, at step ${detail.statementIndex} of ${detail.statementsTotal} in ${detail.file}.`,
        body: [
          "Updates run one change at a time, in order, and stop the moment one of them fails. Nothing after that point ran.",
          "Your existing data is safe. No records were removed or changed by this.",
        ],
      };
    case "tamper-detected":
      return {
        headline: `An update file (${detail.file}) no longer matches this deployment's own record of it.`,
        body: [
          "This deployment keeps a record of every update file it has already run, and what each one contained at the time. The file on disk no longer matches that record, so the server stopped here instead of guessing which version is correct.",
          "Your existing data is safe. Nothing was changed by this check.",
        ],
      };
    case "lock-timeout":
      return {
        headline: "Another update appears to be running already, or one did not finish cleanly.",
        body: [
          "Two updates never run against the same database at the same time. This one waited its turn, and when the wait ran out it stopped here instead of starting alongside another one.",
          "Your existing data is safe. Nothing was changed by this wait.",
        ],
      };
  }
}

function renderHtml(opts: MaintenanceServerOptions): string {
  const { detail } = opts;
  const label = opts.instanceLabel ? escapeHtml(opts.instanceLabel) : "This village";
  const { headline, body } = humanSummary(detail);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${label} is temporarily unavailable</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #f6f3ee; color: #26221c;
         margin: 0; padding: 2.5rem 1.25rem; line-height: 1.55; }
  main { max-width: 42rem; margin: 0 auto; background: #fff; border-radius: 12px; padding: 2rem 2.25rem;
         box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  h1 { font-size: 1.35rem; margin: 0 0 1rem; }
  p { margin: 0 0 1rem; }
  .detail { background: #f0ede6; border-radius: 8px; padding: 1rem 1.1rem; font-size: 0.85rem;
            font-family: ui-monospace, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
  .send { font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1>${label} is temporarily unavailable</h1>
  <p>${escapeHtml(headline)}</p>
  ${body.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n  ")}
  <p class="send">Send this to whoever operates this deployment:</p>
  <div class="detail">${escapeHtml(detail.message)}</div>
</main>
</body>
</html>
`;
}

function jsonBody(opts: MaintenanceServerOptions) {
  return {
    status: "maintenance",
    build: null,
    timestamp: new Date().toISOString(),
    error: { kind: opts.detail.kind, message: opts.detail.message },
  };
}

/**
 * Binds an HTTP server that answers every request with the maintenance page
 * (or JSON, for `/health` and `/api/platform/info`) and a 503. Returns the
 * server so the caller can close it, though in the intended use (a process
 * that refused to boot normally) there is usually nothing to close it for:
 * the operator fixes the underlying problem and restarts the container.
 */
export function startMaintenanceServer(opts: MaintenanceServerOptions): http.Server {
  const html = renderHtml(opts);
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/health" || url === "/api/platform/info") {
      const payload = Buffer.from(JSON.stringify(jsonBody(opts)));
      res.writeHead(503, { "content-type": "application/json; charset=utf-8", "content-length": payload.length });
      res.end(req.method === "HEAD" ? undefined : payload);
      return;
    }
    const payload = Buffer.from(html);
    res.writeHead(503, { "content-type": "text/html; charset=utf-8", "content-length": payload.length });
    res.end(req.method === "HEAD" ? undefined : payload);
  });
  server.listen(opts.port, opts.host ?? "0.0.0.0");
  return server;
}

/** Exposed for a caller (or a test) that wants the page without standing up a server. */
export function renderMaintenanceHtml(opts: MaintenanceServerOptions): string {
  return renderHtml(opts);
}
