/**
 * "How much can you give right now?" (0383, lane E1).
 *
 *   GET  /api/me/commitment   { now: MemberCommitment | null, history: MemberCommitment[] }
 *   POST /api/me/commitment   { pct: 1..100, period?: season|moon|week, fromDate?: YYYY-MM-DD, note? }
 *
 * Private to the signed-in member: it only ever answers for them, and there is
 * no route that reads another member's word. A POST is a new row in the
 * history, never an edit of the last one (server/repos/memberCommitments.ts).
 *
 * "Today" is the member's own calendar day, in their saved time zone, else UTC,
 * so a word said late in the evening holds from the day the member is living.
 *
 * Store and display only. Nothing that pays reads it (shared/commitment.ts).
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { civilDateKey } from "../../shared/lunar";
import { readCommitmentInput } from "../../shared/commitment";
import { commitmentHistory, commitmentNow, recordCommitment } from "../repos/memberCommitments";
import { timeZoneOf } from "../repos/memberTimeZone";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "overLimit">;

/** The member's calendar day now, year-month-day. */
async function todayFor(deps: Deps, userId: string, now: Date): Promise<string> {
  let zone = "UTC";
  try {
    zone = (await timeZoneOf(deps.getPool(), userId)) ?? "UTC";
  } catch {
    zone = "UTC";
  }
  try {
    return civilDateKey(now, zone);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, overLimit } = deps;

  app.get("/api/me/commitment", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const today = await todayFor(deps, user.id, new Date());
    const [now, history] = await Promise.all([commitmentNow(getPool(), user.id, today), commitmentHistory(getPool(), user.id)]);
    res.json({ today, now, history });
  });

  app.post("/api/me/commitment", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (await overLimit(`commitment:${user.id}`, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Too many changes at once. Try again in a while." });
    }
    const today = await todayFor(deps, user.id, new Date());
    const input = readCommitmentInput(req.body, today);
    if (!input.ok) return res.status(400).json({ error: input.problem });
    await recordCommitment(getPool(), user.id, input.value);
    const [now, history] = await Promise.all([commitmentNow(getPool(), user.id, today), commitmentHistory(getPool(), user.id)]);
    res.json({ today, now, history });
  });
}
