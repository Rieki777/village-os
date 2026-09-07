/**
 * Notification routes (extracted from server/index.ts).
 *
 * Three routes:
 *
 *   GET  /api/notifications         list or count (?count=1 is the poll)
 *   POST /api/notifications/read    mark rows read
 *   POST /api/notifications/seen    quiet the bell (seen, not read)
 *
 * SEEN is not READ. Opening the bell quiets the badge and changes nothing
 * else: every row keeps its own read state. The cursor is one timestamp in
 * the member's prefs blob. No column, no migration, and unseen is computed
 * as a subset of unread, so something already dealt with can never come back
 * as new.
 */
import type { Express, Request } from "express";
import type { Pool } from "mysql2/promise";
import {
  markNotificationsRead,
  notificationPulse,
  notificationsFor,
} from "../lib/notify";

export interface NotificationDeps {
  authedUser: (req: Request) => Promise<any | null>;
  getPool: () => Pool;
  members: {
    update: (id: string, fn: (u: any) => void) => Promise<any | null>;
  };
}

export function register(app: Express, deps: NotificationDeps): void {
  const { authedUser, getPool, members } = deps;

  app.get("/api/notifications", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    // `?count=1` is the poll: unread count and the newest timestamp from one
    // indexed pass, no list built. The bell asks this every twenty-five
    // seconds while a member is on the page and only fetches the list when
    // the timestamp moves, which is how the poll got shorter AND cheaper.
    const seenAt = user?.prefs?.notify?.seenAt ?? null;
    if (String(req.query.count ?? "") === "1") {
      return res.json(await notificationPulse(getPool(), user.id, seenAt));
    }
    res.json(await notificationsFor(getPool(), user.id, 50, seenAt));
  });

  app.post("/api/notifications/read", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : undefined;
    const marked = await markNotificationsRead(getPool(), user.id, ids);
    res.json({ success: true, marked });
  });

  app.post("/api/notifications/seen", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const at = new Date().toISOString();
    await members.update(user.id, (u: any) => {
      u.prefs = { ...(u.prefs ?? {}), notify: { ...(u.prefs?.notify ?? {}), seenAt: at } };
    });
    res.json({ success: true, seenAt: at });
  });
}
