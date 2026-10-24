/**
 * Live Sessions over HTTP: the advice process. Every door is the "Doors" list
 * in shared/sessionAdvice.ts, the contract, and every rule behind a door is
 * server/lib/sessionAdvice.ts:
 *
 *   GET  /api/sessions/advice/requests                  AdvicePayload
 *   POST /api/sessions/advice/requests                  { circleId, intent, context, decideBy } -> { request }
 *   PUT  /api/sessions/advice/requests/:id/advice       { advice } -> { request }
 *   POST /api/sessions/advice/requests/:id/decide       { decision } -> { request }
 *   POST /api/sessions/advice/requests/:id/withdraw     -> { request }
 *
 * BEHIND THE ROOM'S OWN GATES: server/routes/sessionDecisions.ts registers
 * this module (server/index.ts has no room for another counted line), after
 * server/routes/liveSessions.ts, so the module gate and the members-only gate
 * on `/api/sessions` stand in front of every door, and this module mounts the
 * module gate on its own prefix too. No door is read as a room's: each takes
 * three segments or more beginning `advice`.
 *
 * THE BELLS go here, after each write commits, and never fail the write: the
 * people asked hear they were asked, the asker hears the first advice from
 * each person, and the people asked hear what was decided. A withdrawal rings
 * nobody. Every bell names its actor (`actorUserId`: the asker, or the person
 * who advised), so when that person leaves the village the erasure rewrites
 * the bell in everybody else's inbox and their name and words go with them.
 */
import type { Express, Request, Response } from "express";
import type { AppDeps } from "../lib/appDeps";
import type { Outcome } from "../lib/liveSessions";
import { requireModule } from "../lib/modules";
import { adviceFor, askAdvice, decideAdvice, giveAdvice, withdrawAdvice, type AdviceDeps } from "../lib/sessionAdvice";
import { liveCircles } from "./sessionRhythm";
import { ADVICE_API, ADVICE_LIMITS, ADVICE_NOTICES, ADVICE_REFUSALS } from "../../shared/sessionAdvice";

/**
 * What this module touches, and why. `circlesRepo` says which circles are
 * live. `lapseContext` reads whose role terms still run, for standing.
 * `members` names people. `notify` rings the bells. `overLimit` bounds every
 * door that writes. `lifecycle` is the module's own, read live unless a suite
 * names it.
 */
type Deps = Pick<AppDeps, "authedUser" | "isAdmin" | "getPool" | "overLimit" | "circlesRepo" | "lapseContext" | "members" | "notify"> & {
  lifecycle?: () => string;
};

const HOUR_MS = 60 * 60 * 1000;

/** Where a bell takes its reader: the request itself on /sessions. */
const requestLink = (id: number): string => `/sessions#advice-${id}`;

export function register(app: Express, deps: Deps): void {
  const { authedUser, isAdmin, getPool, overLimit, circlesRepo, members, notify } = deps;
  const advice: AdviceDeps = {
    circles: () => liveCircles(circlesRepo),
    lapseContext: deps.lapseContext,
    lookup: async (userId) => (await members.byId(userId)) as Record<string, unknown> | null,
    lifecycle: deps.lifecycle,
  };

  app.use(ADVICE_API, requireModule("sessions"));

  const answer = <T>(res: Response, out: Outcome<T>, ok: (v: T) => unknown) =>
    out.ok ? res.json(ok(out.value)) : res.status(out.status).json({ error: out.error });

  const signedIn = async (req: Request, res: Response, limited: boolean) => {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required" });
      return null;
    }
    const userId = String(user.id);
    if (limited && (await overLimit(`sessions-advice:${userId}`, ADVICE_LIMITS.writesPerHour, HOUR_MS))) {
      res.status(429).json({ error: ADVICE_REFUSALS.slowDown });
      return null;
    }
    return { userId, admin: await isAdmin(req) };
  };

  /** One bell's sending, never failing the write it follows. */
  const quietly = async (sending: Promise<unknown>, what: string) => {
    try {
      await sending;
    } catch (e) {
      console.error(`[sessions] an advice notice did not go (${what})`, e);
    }
  };

  app.get(ADVICE_API, async (req, res) => {
    const who = await signedIn(req, res, false);
    if (!who) return;
    res.setHeader("Cache-Control", "private, no-cache");
    res.json(await adviceFor(getPool(), who, advice));
  });

  app.post(ADVICE_API, async (req, res) => {
    const who = await signedIn(req, res, true);
    if (!who) return;
    const out = await askAdvice(getPool(), who, req.body, advice);
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    const r = out.value.request;
    for (const userId of out.value.askedUserIds) {
      await quietly(
        notify({
          userId,
          type: "session_advice_asked",
          title: ADVICE_NOTICES.asked(r.askerName, r.circleName),
          body: r.intent,
          link: requestLink(r.id),
          actorUserId: who.userId,
          dedupeKey: `session-advice-asked:${r.id}:${userId}`,
        }),
        "asked",
      );
    }
    res.json({ request: r });
  });

  app.put(`${ADVICE_API}/:id/advice`, async (req, res) => {
    const who = await signedIn(req, res, true);
    if (!who) return;
    const out = await giveAdvice(getPool(), who, Number(req.params?.id), req.body, advice);
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    const r = out.value.request;
    if (out.value.askerUserId) {
      await quietly(
        notify({
          userId: out.value.askerUserId,
          type: "session_advice_given",
          title: ADVICE_NOTICES.given(out.value.advisorName),
          body: r.intent,
          link: requestLink(r.id),
          actorUserId: who.userId,
          dedupeKey: `session-advice-given:${r.id}:${who.userId}`,
        }),
        "given",
      );
    }
    res.json({ request: r });
  });

  app.post(`${ADVICE_API}/:id/decide`, async (req, res) => {
    const who = await signedIn(req, res, true);
    if (!who) return;
    const out = await decideAdvice(getPool(), who, Number(req.params?.id), req.body, advice);
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    const r = out.value.request;
    for (const userId of out.value.askedUserIds) {
      await quietly(
        notify({
          userId,
          type: "session_advice_decided",
          title: ADVICE_NOTICES.decided(out.value.askerName),
          body: r.decision ?? r.intent,
          link: requestLink(r.id),
          actorUserId: who.userId,
          dedupeKey: `session-advice-decided:${r.id}:${userId}`,
        }),
        "decided",
      );
    }
    res.json({ request: r });
  });

  app.post(`${ADVICE_API}/:id/withdraw`, async (req, res) => {
    const who = await signedIn(req, res, true);
    if (!who) return;
    answer(res, await withdrawAdvice(getPool(), who, Number(req.params?.id), advice), (v) => ({ request: v.request }));
  });
}
