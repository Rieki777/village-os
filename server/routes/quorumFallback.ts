/**
 * THE QUORUM FALLBACK'S DOORS AND ITS ANNOUNCEMENTS (Rye, 2026-11-06).
 *
 * Three things live here, and all three are the ruling's "recorded and
 * announced" half:
 *
 *  1. THE FAILSAFE DOOR. `POST /api/governance/quorum-fallback/failsafe`. A
 *     steward OR an admin may switch `governance.quorum_fallback` ON at any
 *     time. ON only: whether either may also switch it off is not decided, so
 *     the door refuses it and the dial's ordinary vote is the way off.
 *
 *     WHICH "STEWARD". The codebase's own notion, `holdsStewardSeat`
 *     (server/lib/stewardship.ts): a member holding a live, unlapsed seat on
 *     any role that carries `steward.veto`. That is the founding `steward`
 *     role (STEWARD_ROLE_ID) and any Steward Circle a village has given the
 *     veto, read from the roles plane on every call. It is the same test the
 *     veto routes count a steward's act by, so the person who can stop a
 *     carried decision is the person who can pull this failsafe, and nobody
 *     else is. A capability check on `steward.veto` was the other candidate
 *     and is the wrong one: the gate's admin short-circuit would answer it
 *     for an admin, which would blur the two doors this ruling names apart.
 *
 *  2. EVERY SWITCH, BY ANYONE, `announceQuorumFallbackSwitch`. The failsafe
 *     calls it, and `recordMechanicsChange` in server/index.ts calls it for the
 *     village's own vote on the dial. One audit event and one village feed line
 *     per switch.
 *
 *  3. WHAT A CLOSE DID, `quorumFallbackListener`. Registered on the ballot
 *     engine at boot (`setQuorumFallbackListener`), it writes the feed line,
 *     the audit event and the roll's notice when a re-run opens, and the feed
 *     line and audit event when a re-run is decided by the votes cast.
 */
import type { Express } from "express";
import type { Pool } from "mysql2/promise";
import type { AppDeps } from "../lib/appDeps";
import { setQuorumFallbackListener, type QuorumFallbackEvent } from "../lib/ballots";
import { decisionLink, notifyRollRows, type RollNotice } from "../lib/ballotNotices";
import { recordEvent } from "../lib/events";
import { holdsStewardSeat } from "../lib/stewardship";
import { setVariable, stringVar } from "../lib/variables";
import { recordMechanicsChangeRow } from "../lib/changeset";
import {
  QUORUM_FALLBACK_KEY,
  failsafeRefusal,
  majorityFeedLine,
  quorumFallbackOn,
  rerunFeedLine,
  switchFeedLine,
} from "../../shared/quorumFallback";

type Deps = Pick<AppDeps, "authedUser" | "isAdmin" | "getPool" | "notify">;

/** The ballot's closer, when a person closed it; the clock closes as `governance`. */
const actorOf = (closedBy: string): string | null => (closedBy && closedBy !== "governance" ? closedBy : null);

/**
 * One switch of the dial, recorded and announced. Says nothing when the value
 * did not move, because a press on a dial already on switched nothing.
 */
export async function announceQuorumFallbackSwitch(
  pool: Pool,
  input: { previous: unknown; value: unknown; by: "steward" | "admin" | "village"; actorUserId: string | null },
): Promise<void> {
  const was = quorumFallbackOn(input.previous);
  const on = quorumFallbackOn(input.value);
  if (was === on) return;
  const state = on ? "on" : "off";
  await recordEvent(pool, {
    kind: "audit",
    text: `quorum-fallback:${state}:${input.by}${input.by === "village" ? ":vote" : ":failsafe"}`,
    actorUserId: input.actorUserId,
    entityType: "variable",
    entityRef: QUORUM_FALLBACK_KEY,
    audience: "admin",
  });
  await recordEvent(pool, {
    kind: "governance",
    text: switchFeedLine(on, input.by),
    actorUserId: input.actorUserId,
    entityType: "variable",
    entityRef: QUORUM_FALLBACK_KEY,
  });
}

/** What the ballot engine tells the village when the fallback acts at a close. */
export function quorumFallbackListener(deps: Pick<AppDeps, "getPool" | "notify">) {
  return async (e: QuorumFallbackEvent): Promise<void> => {
    const pool = deps.getPool();
    const notifyRoll = (ballot: { id: string }, notice: RollNotice) =>
      notifyRollRows({ pool, notify: deps.notify, link: decisionLink }, ballot, notice);
    if (e.kind === "rerun_opened") {
      const line = rerunFeedLine(e.rerun.title, e.days);
      await recordEvent(pool, {
        kind: "governance",
        text: line,
        actorUserId: actorOf(e.closedBy),
        entityType: "ballot",
        entityRef: e.rerun.id,
      });
      await recordEvent(pool, {
        kind: "audit",
        text: `ballot:quorum-rerun:${e.first.id}:${e.rerun.id}:quorum-${e.rerun.quorumPct}`,
        actorUserId: actorOf(e.closedBy),
        entityType: "ballot",
        entityRef: e.first.id,
        audience: "admin",
      });
      await notifyRoll(e.rerun, {
        type: "ballot_rerun_opened",
        title: `Open again: ${e.rerun.title}`,
        body: line,
        keySuffix: "rerun-open",
      });
      return;
    }
    await recordEvent(pool, {
      kind: "governance",
      text: majorityFeedLine(e.ballot.title, e.outcome),
      actorUserId: actorOf(e.closedBy),
      entityType: "ballot",
      entityRef: e.ballot.id,
    });
    await recordEvent(pool, {
      kind: "audit",
      text: `ballot:quorum-rerun-majority:${e.ballot.id}:${e.outcome}`,
      actorUserId: actorOf(e.closedBy),
      entityType: "ballot",
      entityRef: e.ballot.id,
      audience: "admin",
    });
  };
}

export function register(app: Express, deps: Deps): void {
  setQuorumFallbackListener(quorumFallbackListener(deps));

  app.post("/api/governance/quorum-fallback/failsafe", async (req, res) => {
    const user = await deps.authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const pool = deps.getPool();
    const admin = await deps.isAdmin(req);
    const steward = admin ? false : await holdsStewardSeat(pool, String(user.id));
    const value = String(req.body?.value ?? "on");
    const refusal = failsafeRefusal({ isAdmin: admin, isSteward: steward }, value);
    if (refusal) return res.status(!admin && !steward ? 403 : 409).json({ error: refusal, proposeInstead: true });
    const previous = stringVar(QUORUM_FALLBACK_KEY);
    if (quorumFallbackOn(previous)) {
      return res.json({ success: true, value: "on", changed: false, message: "The quorum fallback is already on." });
    }
    const result = await setVariable(pool, QUORUM_FALLBACK_KEY, "on");
    if (!result.ok) return res.status(400).json({ error: result.error });
    const by = admin ? "admin" : "steward";
    await recordMechanicsChangeRow(
      pool,
      QUORUM_FALLBACK_KEY,
      result,
      String(user.id),
      "admin",
      null,
      by === "admin" ? "Switched on through the failsafe door by an admin" : "Switched on through the failsafe door by a steward",
    );
    await announceQuorumFallbackSwitch(pool, { previous, value: result.value, by, actorUserId: String(user.id) });
    res.json({ success: true, value: "on", changed: true, by });
  });
}
