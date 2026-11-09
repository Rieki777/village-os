/**
 * The village's own door to one copy of its database (Rye, 2026-11-06). The
 * rules and the closer are server/lib/exportVotes.ts; this file asks who is
 * asking and answers. The deployment's password door is
 * server/routes/villageExport.ts and stays; both serve the same file through
 * `serveVillageDump`, one at a time per instance.
 *
 *   GET  /api/governance/village-export/stewards              who may be named: the live stewards
 *   POST /api/governance/village-export/put-to-village        open the vote, naming one of them
 *   GET  /api/governance/village-export/:ballotId/standing    what a decision authorised, for this member
 *   GET  /api/governance/village-export/:ballotId/download    the one download, for the named steward
 *
 * ── WHO MAY ASK ────────────────────────────────────────────────────────────
 *
 * A member holding `proposal.open`, asked with `isAdmin: false`, the same knock
 * as a grant put to the village (server/routes/mintRequestVotes.ts): this is
 * the village's door, and the admin has the password door.
 *
 * ── WHO IS TOLD ────────────────────────────────────────────────────────────
 *
 * The whole roll when the vote opens. The named steward when it carries.
 * EVERY member when the copy is downloaded, which is the point: whoever holds
 * the file, the village knows it left and to whom.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import type { SubjectCloser } from "../lib/applyDue";
import type { RollNotice } from "../lib/ballotNotices";
import { decisionLink } from "../lib/ballotNotices";
import type { BallotSetup } from "../lib/ballotSetup";
import { STEWARD_ROLE_ID } from "../lib/capabilityHolding";
import { recordEvent } from "../lib/events";
import { holdingHasLapsed } from "../lib/stewardship";
import { deadlineInVillage } from "../lib/villageReaders";
import {
  claimVotedExport,
  DATABASE_EXPORT,
  exportStanding,
  exportVoteCloser,
  putExportToVillage,
  releaseVotedExport,
  stewardLabel,
  type ExportVoteDeps,
} from "../lib/exportVotes";
import { holdingsForRoles } from "../repos/permissionHoldings";
import { capabilityDecision } from "../../shared/capabilities";
import { EXPORT_NOTICE_TYPE, giveBackExportSlot, serveVillageDump, sizeWords, takeExportSlot, type ServedDump } from "./villageExport";

type Deps = Pick<AppDeps, "authedUser" | "capabilityCtx" | "getPool" | "overLimit" | "notify" | "members"> & {
  ballotSetup(): Promise<BallotSetup>;
  notifyRoll(b: { id: string }, input: RollNotice): Promise<number>;
  governanceOn(): boolean;
  /** The closer table. `database_export` is written into it here. */
  closers: Record<string, SubjectCloser>;
};

const ASKS_PER_WINDOW = 3;
const ASK_WINDOW_MS = 60 * 60 * 1000;

export function register(app: Express, deps: Deps): void {
  const { authedUser, capabilityCtx, getPool, overLimit, notify, members, ballotSetup, notifyRoll, governanceOn, closers } = deps;
  const voteDeps: ExportVoteDeps = {
    get pool() {
      return getPool();
    },
    members,
    notify: (input) => notify(input),
  };
  closers[DATABASE_EXPORT] = exportVoteCloser(voteDeps);

  app.get("/api/governance/village-export/stewards", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const live = (await holdingsForRoles(getPool(), [STEWARD_ROLE_ID])).filter((h) => !holdingHasLapsed(h));
    const out: Array<{ userId: string; label: string }> = [];
    for (const h of live) {
      const m = await members.byId(h.userId);
      if (m && !m.isExample && !out.some((o) => o.userId === h.userId)) out.push({ userId: String(m.id), label: stewardLabel(m) });
    }
    res.json({ stewards: out });
  });

  app.post("/api/governance/village-export/put-to-village", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to ask the village." });
    if (await overLimit(`export-to-village:${String(user.id)}`, ASKS_PER_WINDOW, ASK_WINDOW_MS)) {
      return res.status(429).json({ error: "too_many_asks", message: "That is several asks in an hour. Wait a little and try again." });
    }
    if (!governanceOn()) {
      return res.status(409).json({ error: "governance_off", message: "This village has not turned voting on, so there is nobody to ask yet." });
    }
    const ctx = await capabilityCtx(user);
    if (!capabilityDecision("proposal.open", { ...ctx, isAdmin: false }).allowed) {
      return res.status(403).json({ error: "Asking the village for an export is for a member who holds proposal.open" });
    }
    const opened = await putExportToVillage(voteDeps, {
      stewardUserId: String(req.body?.stewardUserId ?? ""),
      openedBy: String(user.id),
      reason: String(req.body?.reason ?? ""),
      setup: await ballotSetup(),
    });
    if (!opened.ok) return res.status(opened.status).json(opened.body);
    void notifyRoll(opened.ballot, {
      type: "ballot_opened",
      title: "The village is asked whether one steward may download a copy of its database",
      body: `It holds every member's data. Voting is open until ${deadlineInVillage(opened.ballot.closesAt)}.`,
      keySuffix: "open",
      except: [String(user.id)],
      roll: opened.electorate,
    });
    res.json({ success: true, ballot: { id: opened.ballot.id, closesAt: opened.ballot.closesAt, unityPct: opened.ballot.unityPct, quorumPct: opened.ballot.quorumPct } });
  });

  app.get("/api/governance/village-export/:ballotId/standing", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const s = await exportStanding(getPool(), String(req.params.ballotId), String(user.id));
    // Who it is for and when it went is the village's to know; nothing else is.
    res.json({ granted: s.granted, forYou: s.forYou, stewardLive: s.stewardLive, deliveredAt: s.delivered?.at ?? null });
  });

  app.get("/api/governance/village-export/:ballotId/download", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (await overLimit(`export-download:${String(user.id)}`, 10, 60 * 60 * 1000)) return res.status(429).json({ error: "Too many attempts." });
    const pool = getPool();
    const ballotId = String(req.params.ballotId);
    if (!takeExportSlot()) return res.status(409).json({ error: "An export is already running on this instance. Try again in a few minutes." });
    let served: ServedDump;
    const takenAt = new Date();
    try {
      const claimed = await claimVotedExport(pool, ballotId, String(user.id));
      if (!claimed.ok) return res.status(claimed.status).json({ error: claimed.error });
      served = await serveVillageDump(res, pool, takenAt);
    } finally {
      giveBackExportSlot();
    }
    const complete = served.outcome !== null && served.failure === null;
    if (!complete && served.sentBytes === 0) {
      // Nothing left the building, so the one download was not spent.
      await releaseVotedExport(pool, ballotId);
      return;
    }
    const steward = stewardLabel(user);
    const what = complete ? `${served.outcome!.tables} tables, ${served.outcome!.rows} rows, ${sizeWords(served.sentBytes)} gzipped` : `cut short after ${sizeWords(served.sentBytes)} gzipped`;
    void recordEvent(pool, {
      kind: "audit",
      text: `village-export:by-vote ${ballotId} to ${String(user.id)} (${what})`,
      actorUserId: String(user.id), entityType: "ballot", entityRef: ballotId, audience: "admin",
    });
    const title = complete
      ? `${steward} downloaded one copy of the village's database, as the village voted.`
      : `${steward} began downloading the copy the village voted for, and it was cut short.`;
    const body =
      "It holds every member's data. The vote allowed this one copy, once; another needs another vote. " +
      `Taken at ${takenAt.toISOString().replace("T", " ").slice(0, 16)} UTC.`;
    for (const m of await members.all()) {
      if (!m?.id || m.isExample) continue;
      try {
        await notify({ userId: String(m.id), type: EXPORT_NOTICE_TYPE, title, body, link: decisionLink({ id: ballotId }), dedupeKey: `village-export-vote:${ballotId}:${String(m.id)}` });
      } catch (e) {
        console.error("[export vote] could not tell a member the copy was downloaded", e);
      }
    }
  });
}
