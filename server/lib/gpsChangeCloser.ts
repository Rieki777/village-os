/**
 * WHAT HAPPENS WHEN A VILLAGE CARRIES A CHANGE OF PURPOSE (0217).
 *
 * `server/lib/mechanics.ts` moves Ring-2 game variables and cannot touch an
 * `app_config` document, so the governing purpose statement needed a subject
 * of its own rather than a dial. This file is that subject's whole executor.
 *
 * ── IT CALLS THE SAME VALIDATOR THE FOUNDER'S WRITE CALLS ──────────────────
 *
 * Both go through `writeGoverningPurpose`, which asks
 * `purposeStatementProblem`. The two paths land years apart, so a second
 * standard here would not surface until a village actually voted one through,
 * and by then both answers would look deliberate.
 *
 * ── IT READS A ROW, NEVER THE DOCUMENT ─────────────────────────────────────
 *
 * The statement being adopted comes from `gps_change_proposals`, keyed by the
 * ballot. The markdown the village reads is copy, written for people, and
 * somebody will improve its wording; a closer that recovered the sentence by
 * finding a heading would write the wrong one into the document every later
 * upgrade is judged against, silently, on the one path nobody has ever run.
 *
 * ── DORMANT ON EVERY VILLAGE ALIVE TODAY ───────────────────────────────────
 *
 * The route that opens one refuses while the founder holds the pen, and no
 * village has completed a handover. Everything green about this file is green
 * against a seeded fixture.
 *
 * ── WHY IT IS A FILE AND NOT A BLOCK IN server/index.ts ────────────────────
 *
 * The subject table lives in that file and this keeps one line there. The
 * ratchet is the immediate reason, and the better one is that a closer's
 * dependencies are then declared rather than closed over: everything it
 * touches is in the `Deps` below, and a reader can see the whole of what a
 * carried purpose change does without reading twenty-seven thousand lines of
 * surrounding scope.
 */
import type { Pool } from "mysql2/promise";
import type { BallotOutcome } from "../../shared/governanceEngine";
import type { BallotRow } from "./ballots";
import type { CloseRouting } from "./applyDue";
import { gpsChangeProposalFor } from "../repos/gpsChangeProposals";
import { writeGoverningPurpose } from "./governingPurpose";

export interface GpsChangeCloserDeps {
  getPool: () => Pool;
  notify: (input: {
    userId: string;
    type: string;
    title: string;
    body: string;
    link?: string | null;
    actorUserId?: string | null;
    dedupeKey: string;
  }) => Promise<unknown>;
  notifyAdmins: (kind: string, text: string, dedupeKey: string) => Promise<unknown>;
  addActivity: (
    kind: string,
    text: string,
    extra?: { actorUserId?: string | null; entityType?: string | null; entityRef?: string | null },
  ) => Promise<unknown>;
  recordAudit: (text: string, actorId: string) => void;
  ballotLink: (b: BallotRow) => string;
}

/** The body `twoPhase` wraps: settle on a failure, execute on a pass. */
export function gpsChangeCloser(deps: GpsChangeCloserDeps) {
  return async (
    b: BallotRow,
    outcome: BallotOutcome,
    outcomeNote: string,
    actorId: string,
  ): Promise<CloseRouting> => {
    const out: CloseRouting = { applied: [], held: null, proposerTold: null };

    if (outcome !== "passed") {
      out.proposerTold = b.openedBy;
      await deps.notify({
        userId: b.openedBy,
        type: "governance",
        title:
          outcome === "no_quorum"
            ? `Too few of the village voted: ${b.title}`
            : `The village did not carry this one: ${b.title}`,
        body:
          outcome === "no_quorum"
            ? "Nothing has changed. The ask can go to the village again whenever it is more gathered."
            : `${outcomeNote}\n\nThe statement stands as it was.`,
        link: deps.ballotLink(b),
        actorUserId: actorId,
        dedupeKey: `bal:${b.id}:gps-not-carried`,
      });
      return out;
    }

    const asked = await gpsChangeProposalFor(deps.getPool(), b.id);
    if (!asked) {
      out.held = "the statement this vote would adopt was not recorded, so there is nothing to write";
      await deps.notifyAdmins("governance", `A carried purpose change could not land: ${b.title}`, `bal:${b.id}:gps-held`);
      return out;
    }

    const written = await writeGoverningPurpose(deps.getPool(), { statement: asked.statement, writtenBy: b.id });
    if (!written.ok) {
      out.held = written.error;
      await deps.notifyAdmins("governance", `A carried purpose change could not land: ${b.title}`, `bal:${b.id}:gps-held`);
      return out;
    }

    out.applied = ["gps"];
    out.proposerTold = b.openedBy;
    await deps.notify({
      userId: b.openedBy,
      type: "governance",
      title: `The village carried this: ${b.title}`,
      body: "The governing purpose statement reads the new way from today, and every proposal opened after this answers to it.",
      link: deps.ballotLink(b),
      actorUserId: actorId,
      dedupeKey: `bal:${b.id}:gps-carried`,
    });
    await deps.addActivity("governance", "The village changed what it is for, by its own vote.", {
      actorUserId: actorId,
      entityType: "ballot",
      entityRef: b.id,
    });
    deps.recordAudit(`gps:changed-by-ballot:${b.id}`, actorId);
    return out;
  };
}
