/**
 * Map walk log route (extracted from server/index.ts).
 *
 * One route:
 *
 *   POST /api/map/walk-log
 *
 * The running map posts its own walk log. Under `/api/map`, so it inherits
 * the module gate. Unauthenticated on purpose: a walk runs before anyone
 * signs in, which is exactly the person whose experience this measures.
 * Nothing here identifies anybody, the batch is capped, and a replayed post
 * dedupes on its idempotency key.
 */
import type { Express, Request } from "express";
import type { Pool } from "mysql2/promise";
import { WALK_LOG_PER_IP_HOURLY, recordWalkRows } from "../lib/walkLog";

export interface MapWalkLogDeps {
  getPool: () => Pool;
  overLimit: (key: string, limit: number, windowMs: number) => Promise<boolean>;
  clientIp: (req: Request) => string;
}

export function register(app: Express, deps: MapWalkLogDeps): void {
  const { getPool, overLimit, clientIp } = deps;

  app.post("/api/map/walk-log", async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length || (await overLimit(`walk-log:${clientIp(req)}`, WALK_LOG_PER_IP_HOURLY, 60 * 60 * 1000))) return res.json({ recorded: 0 });
    const session = typeof req.body?.sessionKey === "string" ? req.body.sessionKey : "";
    if (!session) return res.status(400).json({ error: "sessionKey required" });
    const lang = typeof req.body?.lang === "string" ? req.body.lang : null;
    const wrote = await recordWalkRows(
      getPool(),
      rows.map((r: any) => ({
        sessionKey: session, step: r?.step, atIndex: r?.at_index ?? r?.atIndex,
        tsSeq: r?.ts_seq ?? r?.tsSeq, lang,
      })),
      "live",
    );
    /*
     * `recorded` is the NEW rows, which is what the word has always implied
     * and did not mean: it used to be `affectedRows`, and MySQL counts an
     * ON DUPLICATE KEY update as two of those, so a replayed batch reported
     * more writes than a first send. `accepted` rides beside it for anyone
     * who wants to know the batch arrived whole.
     */
    res.json({ recorded: wrote.stored, accepted: wrote.accepted });
  });
}
