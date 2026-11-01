/**
 * Session card routes: `/api/session-card/**`, behind `requireModule("session-card")`.
 *
 *   GET   /api/session-card/:sessionId                         the session's cards, newest first, as this viewer sees them
 *   POST  /api/session-card/:sessionId                         pull a card: body `{ sky }`, the day's sky read in the browser
 *   POST  /api/session-card/:sessionId/cards/:cardId/share     share or unshare the viewer's own line: body `{ shared }`
 *
 * Every door needs a signed-in member who has joined the session (an admin
 * may read without joining). The rules live in server/lib/sessionCard.ts.
 */
import type { Express, Response } from "express";
import type { AppDeps } from "../lib/appDeps";
import { requireModule } from "../lib/modules";
import { registerJob } from "../lib/scheduler";
import { clearClosedCards, pullCard, readCards, shareLine, type CardDeps, type CardOutcome } from "../lib/sessionCard";
import { CARD_LIMITS } from "../../shared/sessionCard";

type Deps = Pick<AppDeps, "authedUser" | "isAdmin" | "getPool" | "overLimit" | "members">;

const HOUR_MS = 60 * 60 * 1000;
/** Shares and unshares one member may make in an hour. */
const SHARES_PER_HOUR = 120;
/**
 * Reads one member may make in an hour. The open card polls every 5 seconds
 * (720 an hour), so two open tabs fit and a loop does not.
 */
const READS_PER_HOUR = 1500;
export const CLEAR_JOB = "session-cards-clear-closed";

const idOf = (raw: unknown): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export function register(app: Express, deps: Deps): void {
  const { authedUser, isAdmin, getPool, overLimit, members } = deps;
  const card: CardDeps = {
    getPool,
    overLimit,
    nameOf: async (userId) => {
      const m = await members.byId(userId);
      return m && typeof m.name === "string" ? m.name : null;
    },
  };
  registerJob(CLEAR_JOB, HOUR_MS, async () => {
    const n = await clearClosedCards(getPool());
    return n ? `cleared ${n} cards of closed sessions` : undefined;
  });

  app.use("/api/session-card", requireModule("session-card"));

  const answer = <T>(res: Response, out: CardOutcome<T>) =>
    out.ok ? res.json(out.value) : res.status(out.status).json({ error: out.error });

  app.get("/api/session-card/:sessionId", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    if (await overLimit(`session-card-read:${String(me.id)}`, READS_PER_HOUR, HOUR_MS)) {
      return res.status(429).json({ error: "The card is being read very often. Try again in a little while." });
    }
    const sessionId = idOf(req.params.sessionId);
    if (sessionId == null) return res.status(404).json({ error: "That session is not here." });
    res.setHeader("Cache-Control", "private, no-cache");
    answer(res, await readCards(card, sessionId, String(me.id), await isAdmin(req)));
  });

  app.post("/api/session-card/:sessionId", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    const uid = String(me.id);
    if (await overLimit(`session-card-pull:${uid}`, CARD_LIMITS.perMemberHour, HOUR_MS)) {
      return res.status(429).json({ error: "That is a lot of cards for one hour. Sit with the last one a while." });
    }
    const sessionId = idOf(req.params.sessionId);
    if (sessionId == null) return res.status(404).json({ error: "That session is not here." });
    answer(res, await pullCard(card, sessionId, uid, req.body));
  });

  app.post("/api/session-card/:sessionId/cards/:cardId/share", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    if (await overLimit(`session-card-share:${String(me.id)}`, SHARES_PER_HOUR, HOUR_MS)) {
      return res.status(429).json({ error: "That is a lot of sharing for one hour. Try again a little later." });
    }
    const sessionId = idOf(req.params.sessionId), cardId = idOf(req.params.cardId);
    if (sessionId == null || cardId == null) return res.status(404).json({ error: "That card is not in this session." });
    answer(res, await shareLine(card, sessionId, cardId, String(me.id), req.body));
  });
}
