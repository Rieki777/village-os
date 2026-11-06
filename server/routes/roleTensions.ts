/**
 * RAISE A TENSION WITH A ROLE, over HTTP (player role card, PR 5 of 7). The
 * contract is shared/roleTensions.ts and the rules are server/lib/roleTensions.ts.
 *
 *   POST /api/roles/:id/tensions          { text } -> 201 { tension }, members only
 *   GET  /api/roles/:id/tensions          RoleTensionsPayload for whoever asks
 *   GET  /api/role-tensions/mine          { tensions: HeldTension[] }, members only
 *   POST /api/role-tensions/:id/respond   { action, note? } -> { tension }, live holders only
 *
 * MEMBERS, NEVER GUESTS. A signed-in account the village has not admitted is a
 * guest (`isAdmitted`, the rule the Live Sessions doors use), and a guest can
 * neither raise a tension nor read one. An admin passes either way, as there.
 *
 * Both writing doors are bounded per member per hour (`overLimit`). A refusal
 * is `{ error: <a sentence> }` with a 4xx status, every sentence one of
 * TENSION_REFUSALS.
 *
 * NO MODULE GATE. Roles are part of every village. Waiting on you, where a
 * holder answers, rides the governance read (server/routes/seatApplications.ts);
 * a bring to the circle asks whether Live Sessions is on, and refuses with a
 * sentence when it is off.
 *
 * THE REMINDER JOB REGISTERS HERE, beside the doors that answer what it
 * reminds people about: hourly, so a reminder lands within the hour after the
 * second business day.
 */
import type { Express, Request, Response } from "express";
import type { AppDeps } from "../lib/appDeps";
import { isAdmitted } from "../lib/admission";
import { effectiveLifecycle } from "../lib/modules";
import { registerJob } from "../lib/scheduler";
import {
  heldTensionsFor,
  raiseTension,
  remindTensionHolders,
  respondToTension,
  roleTensionsFor,
  type Outcome,
  type TensionDeps,
} from "../lib/roleTensions";
import { roleForTension } from "../repos/roleTensions";
import { GAME_CONFIG } from "../../shared/gameConfig";
import { MY_TENSIONS_URL, TENSION_ID, TENSION_LIMITS, TENSION_REFUSALS as R } from "../../shared/roleTensions";

type Deps = Pick<AppDeps, "authedUser" | "isAdmin" | "getPool" | "overLimit" | "notify" | "seasonState">;

const HOUR_MS = 60 * 60 * 1000;
export const TENSION_REMIND_JOB = "role-tension-reminders";

export function register(app: Express, deps: Deps): void {
  const { authedUser, isAdmin, getPool, overLimit, notify } = deps;
  const timeZone = (): string => {
    try {
      return deps.seasonState().timezone || "UTC";
    } catch {
      return "UTC";
    }
  };
  const tensions: TensionDeps = {
    notify,
    timeZone,
    sessionsOn: () => effectiveLifecycle("sessions") !== "off",
  };

  registerJob(TENSION_REMIND_JOB, HOUR_MS, async () => {
    const n = await remindTensionHolders({ pool: getPool(), notify, timeZone });
    return n ? `${n} reminders` : undefined;
  });

  const answer = <T>(res: Response, out: Outcome<T>, status: number, ok: (v: T) => unknown) =>
    out.ok ? res.status(status).json(ok(out.value)) : res.status(out.status).json({ error: out.error });

  /** The asker, and whether they are a member: admitted, or an admin. */
  const viewerOf = async (req: Request): Promise<{ userId: string; member: boolean } | null> => {
    const user = await authedUser(req);
    if (!user) return null;
    const member = isAdmitted(user, GAME_CONFIG.stages) || (await isAdmin(req));
    return { userId: String(user.id), member };
  };

  /** A signed-in member, or a refusal already sent. */
  const memberOnly = async (req: Request, res: Response): Promise<{ userId: string } | null> => {
    const who = await viewerOf(req);
    if (!who) {
      res.status(401).json({ error: R.signIn });
      return null;
    }
    if (!who.member) {
      res.status(403).json({ error: R.membersOnly });
      return null;
    }
    return who;
  };

  const roleIdOf = (req: Request): string | null => {
    const id = String(req.params?.id ?? "").trim();
    return id && id.length <= 64 ? id : null;
  };

  // ── Raise ─────────────────────────────────────────────────────────────────

  app.post("/api/roles/:id/tensions", async (req, res) => {
    const who = await memberOnly(req, res);
    if (!who) return;
    if (await overLimit(`role-tension-raise:${who.userId}`, TENSION_LIMITS.raisesPerHour, HOUR_MS)) {
      return res.status(429).json({ error: R.tooMany });
    }
    const roleId = roleIdOf(req);
    if (!roleId) return res.status(404).json({ error: R.noRole });
    answer(res, await raiseTension(getPool(), who, roleId, req.body, tensions), 201, (tension) => ({ tension }));
  });

  // ── Read ──────────────────────────────────────────────────────────────────

  /**
   * One role's tensions for whoever asks. A visitor and a guest read
   * `mayRaise: false` and nothing else; a member reads the counts and the
   * words they may read (`mayReadTensionWords`).
   */
  app.get("/api/roles/:id/tensions", async (req, res) => {
    const roleId = roleIdOf(req);
    const pool = getPool();
    if (!roleId || !(await roleForTension(pool, roleId))) return res.status(404).json({ error: R.noRole });
    const who = await viewerOf(req);
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await roleTensionsFor(pool, roleId, { userId: who?.userId ?? null, member: who?.member === true }, timeZone()));
  });

  /** The open tensions raised with the roles the asker holds now. */
  app.get(MY_TENSIONS_URL, async (req, res) => {
    const who = await memberOnly(req, res);
    if (!who) return;
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ tensions: await heldTensionsFor(getPool(), who.userId, { timeZone: timeZone() }) });
  });

  // ── Respond ───────────────────────────────────────────────────────────────

  app.post("/api/role-tensions/:id/respond", async (req, res) => {
    const who = await memberOnly(req, res);
    if (!who) return;
    if (await overLimit(`role-tension-respond:${who.userId}`, TENSION_LIMITS.respondsPerHour, HOUR_MS)) {
      return res.status(429).json({ error: R.respondsTooMany });
    }
    const id = String(req.params?.id ?? "");
    if (!TENSION_ID.test(id)) return res.status(404).json({ error: R.notFound });
    answer(res, await respondToTension(getPool(), who, id, req.body, tensions), 200, (tension) => ({ tension }));
  });
}
