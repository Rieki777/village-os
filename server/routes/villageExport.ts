/**
 * The whole village's database, as one gzipped SQL file (R071).
 *
 *   GET /api/admin/export/database   header x-village-admin-password: <ADMIN_PASSWORD>
 *
 * What the file holds, and what it never holds, is argued once in
 * server/repos/villageDump.ts. This file is the door.
 *
 * ── WHY THE ADMIN PASSWORD AND NOTHING ELSE ────────────────────────────────
 *
 * The coordinator's ruling of 2026-11-05: option (c), ADMIN_PASSWORD only. The
 * person who needs this is whoever runs the deployment, at the moment they are
 * leaving a host or rebuilding one, and that person holds the environment. An
 * admin's session does not open it: an admin account is something a village
 * hands out, and a stolen session should not be one request from every
 * member's data. The password lives where the database password lives, so it
 * gives nothing its holder could not already take.
 *
 * Which is also why ADMIN_PASSWORD now keeps one power after bootstrap. The
 * docs say so beside the variable, so an operator knows to rotate it when
 * someone who knew it leaves.
 *
 * ── WHY EVERY EXPORT IS ANNOUNCED ──────────────────────────────────────────
 *
 * A password is shared by whoever has read the environment, so the export
 * cannot name a person. What it can do is make sure nobody exports in
 * silence: every attempt that got through is written to the audit log (when,
 * how much, the address it came from) and told to every admin and every
 * seated steward (when and how much, never what was in it). An export that was
 * cut short is told too, because the rows that went out before the cut still
 * went out.
 *
 * ── THE REST OF THE SHAPE ──────────────────────────────────────────────────
 *
 * Unset or placeholder password: 503, naming the variable. Wrong password:
 * 401, rate-limited per address like the bootstrap door. A second export while
 * one runs: 409. A failure after the first byte destroys the socket, so the
 * client's `curl` exits non-zero instead of keeping a short file.
 */
import zlib from "zlib";
import { once } from "events";
import { finished } from "stream/promises";
import type { Express, Response } from "express";
import type { Pool } from "mysql2/promise";

import type { AppDeps } from "../lib/appDeps";
import { markAdminGate } from "../lib/adminGate";
import { recordEvent } from "../lib/events";
import { STEWARD_ROLE_ID } from "../lib/capabilityHolding";
import { holdingHasLapsed } from "../lib/stewardship";
import { holdingsForRoles } from "../repos/permissionHoldings";
import { estimateDumpBytes, streamVillageDump, type DumpOutcome } from "../repos/villageDump";

export const EXPORT_PASSWORD_HEADER = "x-village-admin-password";

/**
 * How long a client may stop reading before the export gives up. A caller that
 * connects and never reads would otherwise hold a database connection, an open
 * snapshot and this instance's one export slot until the process restarts:
 * the control for the refusal test found exactly that, as a 409 on the next
 * call. Two minutes is long past any real pause in a download.
 */
const STALL_MS = 2 * 60 * 1000;
export const EXPORT_NOTICE_TYPE = "village_export";

type Deps = Pick<AppDeps, "getPool" | "notify" | "members" | "overLimit" | "clientIp"> & {
  /** The deployment's ADMIN_PASSWORD, or null while it is unset or still the placeholder. */
  adminPassword(): string | null;
  /** The constant-time compare the bootstrap door uses. */
  secretEquals(provided: string | undefined, expected: string): boolean;
};

/** A byte count as a person reads it. */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/** Every admin, and every steward whose term has not lapsed. Examples never. */
async function exportWitnesses(deps: Deps): Promise<string[]> {
  const everyone = await deps.members.all();
  const real = new Map(everyone.filter((m: any) => m?.id && !m.isExample).map((m: any) => [String(m.id), m]));
  const out = new Set<string>();
  real.forEach((m: any, id) => {
    if (m.role === "admin" || m.role === "founder") out.add(id);
  });
  for (const h of await holdingsForRoles(deps.getPool(), [STEWARD_ROLE_ID])) {
    if (real.has(h.userId) && !holdingHasLapsed(h)) out.add(h.userId);
  }
  return Array.from(out);
}

/**
 * ONE EXPORT AT A TIME PER INSTANCE, whichever door asked for it: the
 * deployment's password here, or a vote the village carried
 * (server/routes/exportVotes.ts). Two dumps at once would hold two snapshots
 * and double the load for no reader's benefit.
 */
let inFlight = false;
export function takeExportSlot(): boolean {
  if (inFlight) return false;
  inFlight = true;
  return true;
}
export function giveBackExportSlot(): void {
  inFlight = false;
}

export interface ServedDump {
  outcome: DumpOutcome | null;
  sentBytes: number;
  failure: unknown;
}

/**
 * Stream the whole village's database to `res` as one gzipped SQL file, the
 * way both doors serve it: one snapshot, the size note in the headers, a stall
 * timeout, and a stop when the reader hangs up. Never throws; a failure is in
 * the result, and the response is ended or destroyed here.
 */
export async function serveVillageDump(res: Response, pool: Pool, takenAt: Date): Promise<ServedDump> {
  let outcome: DumpOutcome | null = null;
  let sentBytes = 0;
  let failure: unknown = null;
  try {
    const estimate = await estimateDumpBytes(pool);
    const day = takenAt.toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="village-export-${day}.sql.gz"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("x-village-export-taken-at", takenAt.toISOString());
    // The size note. Uncompressed and approximate, from the database's own
    // statistics; the file itself is gzip and usually far smaller.
    res.setHeader("x-village-export-estimate-bytes", String(estimate.bytes));
    res.setHeader("x-village-export-tables", String(estimate.tables));

    const gzip = zlib.createGzip();
    gzip.on("data", (chunk: Buffer) => {
      sentBytes += chunk.length;
    });
    gzip.pipe(res);
    // A client that hangs up mid-file must stop the read. Without this the
    // dump would wait forever for a drain that never comes, holding a
    // connection and a snapshot open.
    let hungUp = false;
    res.once("close", () => {
      if (!res.writableFinished) hungUp = true;
    });
    const gone = () => hungUp || res.destroyed;
    outcome = await streamVillageDump(
      pool,
      async (chunk) => {
        if (gone()) throw new Error("the client went away mid-export");
        if (gzip.write(chunk)) return;
        const stop = new AbortController();
        let stalled = false;
        const timer = setTimeout(() => {
          stalled = true;
          stop.abort();
        }, STALL_MS);
        try {
          await Promise.race([once(gzip, "drain", { signal: stop.signal }), once(res, "close", { signal: stop.signal })]);
        } catch (e) {
          if (!stalled) throw e;
        } finally {
          clearTimeout(timer);
          stop.abort();
        }
        if (stalled) throw new Error(`the client stopped reading for ${STALL_MS / 1000}s`);
        if (gone()) throw new Error("the client went away mid-export");
      },
      { takenAt },
    );
    gzip.end();
    await finished(res);
  } catch (e) {
    failure = e;
    console.error("[export] whole-village export failed", e);
    if (!res.headersSent) res.status(500).json({ error: "export failed" });
    else res.destroy();
  }
  return { outcome, sentBytes, failure };
}

export function register(app: Express, deps: Deps): void {
  app.get("/api/admin/export/database", async (req, res) => {
    // The gate here is the password, not a session, and it still has to say a
    // gate ran or the default-deny under /api/admin refuses its own success.
    markAdminGate(req);

    const expected = deps.adminPassword();
    if (!expected) {
      return res.status(503).json({
        error:
          "This deployment has no ADMIN_PASSWORD of its own, so there is nothing to authenticate an export against. " +
          "Set ADMIN_PASSWORD in the environment, redeploy, and try again.",
      });
    }
    const offered = req.headers[EXPORT_PASSWORD_HEADER];
    if (!deps.secretEquals(typeof offered === "string" ? offered : undefined, expected)) {
      if (await deps.overLimit(`village-export:${deps.clientIp(req)}`, 10, 60 * 60 * 1000)) {
        return res.status(429).json({ error: "Too many attempts." });
      }
      return res.status(401).json({ error: "auth_required" });
    }
    if (!takeExportSlot()) {
      return res.status(409).json({ error: "An export is already running on this instance." });
    }

    const pool = deps.getPool();
    const takenAt = new Date();
    const from = deps.clientIp(req);
    let served: ServedDump;
    try {
      served = await serveVillageDump(res, pool, takenAt);
    } finally {
      giveBackExportSlot();
    }
    const { outcome, sentBytes, failure } = served;

    const seconds = Math.round((Date.now() - takenAt.getTime()) / 100) / 10;
    const complete = outcome !== null && failure === null;
    const what = complete
      ? `${outcome!.tables} tables, ${outcome!.rows} rows, ${sizeWords(sentBytes)} gzipped`
      : `cut short after ${sizeWords(sentBytes)} gzipped`;
    console.log(`[export] whole-village export ${complete ? "served" : "cut short"}: ${what}, ${seconds}s`);
    // Audited: the /api/admin audit middleware skips GET, and this GET hands
    // out every member's data.
    void recordEvent(pool, {
      kind: "audit",
      text: `GET /api/admin/export/database with ADMIN_PASSWORD (${what}, ${seconds}s, from ${from})`,
      actorKind: "system",
      audience: "admin",
    });
    const when = takenAt.toISOString().replace("T", " ").slice(0, 16);
    const title = complete
      ? `The whole village's database was exported with the deployment's admin password (${sizeWords(sentBytes)}).`
      : `An export of the whole village's database was started with the deployment's admin password and cut short.`;
    const body =
      `Taken at ${when} UTC. ${complete ? `${outcome!.tables} tables, ${outcome!.rows} rows.` : `About ${sizeWords(sentBytes)} went out before it stopped.`} ` +
      "The file holds every member's data. If nobody running the deployment did this, change ADMIN_PASSWORD now. The audit log has the address it came from.";
    // Nothing left the building: a refusal before the first byte is in the
    // audit log and needs no bell.
    if (!complete && sentBytes === 0) return;
    try {
      for (const userId of await exportWitnesses(deps)) {
        await deps.notify({
          userId,
          type: EXPORT_NOTICE_TYPE,
          title,
          body,
          link: "/admin",
          dedupeKey: `village-export:${takenAt.getTime()}:${userId}`,
        });
      }
    } catch (e) {
      console.error("[export] could not tell the admins and stewards about an export", e);
    }
  });
}
