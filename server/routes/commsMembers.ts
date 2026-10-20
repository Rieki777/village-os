/**
 * THE MEMBER'S VIEW OF THE VILLAGE'S EMAIL, `/api/comms/village` (the comms
 * build spec 5.13, ruling 2026-09-25): every journey, its steps, timing and
 * words, and the comms dials, read-only; and the "Propose a change" door.
 * Registered by one line in server/routes/commsPublic.ts.
 *
 *   GET  /api/comms/village           the page, rendered for the signed-in reader
 *   POST /api/comms/village/propose   { target, key, step?, change }  file a comms-change
 *
 * ── THE GATES ───────────────────────────────────────────────────────────────
 *
 * Both routes sit behind `requireModule("comms")`, one route at a time: with
 * the module off there is nothing to show, and at preview a village is trying
 * its email before it decides, which the identical-404 rule keeps from
 * everyone but the admins (the same rank test `/api/game/mechanics` applies to
 * the comms dials). Then a signed-in member, and a per-member `overLimit`
 * bucket on each, because the page renders every email and the door rings
 * every founder.
 *
 * NOTHING HERE CHANGES THE VILLAGE'S EMAIL. There is no write route for a
 * member: turning a journey on, editing a step or its words and setting a dial
 * stay behind `comms.manage` on the admin routes, or behind the village's vote
 * for a dial. The door only asks.
 *
 * ── WHERE A PROPOSAL GOES ───────────────────────────────────────────────────
 *
 * A dial the village may vote on is proposed on the Game Mechanics page, the
 * village's existing proposal path for dials (`mechanics_proposals`), and the
 * page links there. So this route refuses an open dial and names that page:
 * one dial, one way to propose it. Everything else (a journey, a step, an
 * email's words, a founder-held dial) becomes a `comms-change` row in
 * `submissions`, through the one `submissionsRepo` the server holds, so the
 * admin queue lists it at once (a second collection over the table would
 * cache on its own, server/routes/powerHands.ts says why), and the founders'
 * bell rings with a link to it.
 */
import type { Express } from "express";
import { COMMS_CHANGE, dialLink, readProposal } from "../../shared/comms/memberView";
import { ringOf, VARIABLES_BY_KEY } from "../../shared/gameVariables";
import type { AppDeps } from "../lib/appDeps";
import { buildMemberView, journeyTitle, knownTarget } from "../lib/comms/memberView";
import { requireModule } from "../lib/modules";
import type { DbCollection } from "../repos/store-db";

export type MemberDeps = Pick<AppDeps, "authedUser" | "getPool" | "overLimit" | "notifyAdmins"> & {
  submissionsRepo: Pick<DbCollection, "insert">;
  /** The village's own site, for the links in the sample emails. */
  deploymentOrigin(): string;
};

const MINUTE = 60_000;
/** Page reads per member per ten minutes: each one renders every email. */
const READS_PER_WINDOW = 30;
/** Proposals per member per hour: each one rings every founder. */
const PROPOSALS_PER_HOUR = 10;

const firstNameOf = (name: unknown): string => String(name ?? "").trim().split(/\s+/)[0] ?? "";

export function register(app: Express, deps: MemberDeps): void {
  const { authedUser, getPool, overLimit, notifyAdmins, submissionsRepo, deploymentOrigin } = deps;
  const moduleGate = requireModule("comms");

  app.get("/api/comms/village", moduleGate, async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to see how the village emails." });
    if (await overLimit(`comms-village:${user.id}`, READS_PER_WINDOW, 10 * MINUTE)) {
      return res.status(429).json({ error: "That's a lot of reloads. Wait a minute and try again." });
    }
    const view = await buildMemberView({ getPool, origin: deploymentOrigin }, { firstName: firstNameOf(user.name) });
    res.json(view);
  });

  app.post("/api/comms/village/propose", moduleGate, async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to propose a change." });
    const read = readProposal(req.body);
    if ("problem" in read) return res.status(400).json({ error: read.problem });
    const { target, key, step, change } = read.proposal;

    if (target === "dial") {
      const def = VARIABLES_BY_KEY[key];
      if (def && key.startsWith("comms.") && ringOf(def) === "open") {
        return res.status(409).json({
          error: "The village votes on this dial. Propose it on the Game Mechanics page.",
          link: dialLink(key),
        });
      }
    }
    if (!(await knownTarget({ getPool }, target, key, step))) {
      return res.status(404).json({ error: "That isn't one of the village's journeys, emails or dials." });
    }
    if (await overLimit(`comms-propose:${user.id}`, PROPOSALS_PER_HOUR, 60 * MINUTE)) {
      return res.status(429).json({ error: "That's a lot of proposals in an hour. Wait a little and try again." });
    }

    const about =
      target === "dial"
        ? VARIABLES_BY_KEY[key]?.label ?? key
        : target === "journey" || target === "step"
          ? journeyTitle(key)
          : key;
    const submittedAt = new Date().toISOString();
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: COMMS_CHANGE,
      status: "new",
      rewarded: false,
      data: { target, key, step, about, change, email: user.email ?? null, name: user.name ?? null },
      userId: String(user.id),
      userName: user.name ?? null,
      submittedAt,
    };
    await submissionsRepo.insert(entry);
    const who = firstNameOf(user.name) || "A member";
    await notifyAdmins("submission", `${who} proposed a change to the village's email: ${about}`, `${COMMS_CHANGE}:${entry.id}`, "/admin?tab=submissions");
    res.json({ filed: true, id: entry.id, submittedAt });
  });
}
