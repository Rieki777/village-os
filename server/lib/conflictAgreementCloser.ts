/**
 * WHAT HAPPENS WHEN A VILLAGE CARRIES A CHANGE TO ITS CONFLICT AGREEMENT.
 *
 * After the Birthing the agreement changes by a ballot at the structural tier
 * (plan section 2.3, the consequence pen), opened by
 * `POST /api/governance/conflict-agreement-changes`. This file is that
 * subject's whole executor, built like server/lib/gpsChangeCloser.ts.
 *
 * ── IT READS WHAT THE BALLOT ASKED, NEVER THE DOCUMENT ────────────────────
 *
 * The agreement being adopted was written under this ballot's own key
 * (`proposalKeyFor`, `conflict-agreement-proposal:<ballot id>`) inside the
 * transaction that opened the ballot, with the ballot's id beside it. A key
 * per ballot, because a carried change waits for its landing date after the
 * close has freed the subject, and a second change opened in that window used
 * to overwrite the one shared key. A proposal carrying any other id is some
 * other vote's, so this holds and says why instead of adopting it. The
 * markdown members read is copy and is never parsed back.
 *
 * ── IT RUNS THE SAME CHECKS THE OPEN RAN ──────────────────────────────────
 *
 * `agreementForAdoption`, which the admin's adoption and the ballot's open
 * both call. A role deleted while the vote ran, or a review date the vote
 * outlived, holds the change with the reason, and the admins are told.
 *
 * ── IT WRITES THROUGH THE CACHED HANDLE ───────────────────────────────────
 *
 * The exit policy reads through the agreement on every read, from the
 * `dbDocument` server/index.ts loads at boot. A write around that handle
 * would leave every page printing the old agreement until the next restart.
 */
import type { Pool } from "mysql2/promise";
import type { BallotOutcome } from "../../shared/governanceEngine";
import { agreementOf } from "../../shared/conflictAgreement";
import type { BallotRow } from "./ballots";
import type { CloseRouting } from "./applyDue";
import { readConfigDocument } from "../repos/appConfigDocs";
import { DEFAULT_EXIT_POLICY } from "./exitPolicy";
import { adoptedByBallot, agreementForAdoption, proposalKeyFor } from "./conflictAgreement";

export interface ConflictAgreementCloserDeps {
  getPool: () => Pool;
  /** The agreement's cached handle, `conflictAgreementRepo` in server/index.ts. */
  agreement: { get(): unknown; put(doc: any): Promise<unknown> };
  loadRoles: () => ReadonlyArray<{ id: string }>;
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
  now?: () => Date;
}

/** The body `twoPhase` wraps: settle on a failure, execute on a pass. */
export function conflictAgreementCloser(deps: ConflictAgreementCloserDeps) {
  return async (b: BallotRow, outcome: BallotOutcome, outcomeNote: string, actorId: string): Promise<CloseRouting> => {
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
            ? "Nothing has changed. The change can go to the village again whenever it is more gathered."
            : `${outcomeNote}\n\nThe conflict agreement stands as it was.`,
        link: deps.ballotLink(b),
        actorUserId: actorId,
        dedupeKey: `bal:${b.id}:agreement-not-carried`,
      });
      return out;
    }

    const hold = async (why: string) => {
      out.held = why;
      await deps.notifyAdmins("governance", `A carried change to the conflict agreement could not land: ${b.title}`, `bal:${b.id}:agreement-held`);
      return out;
    };

    const asked = (await readConfigDocument<{ ballotId?: unknown; agreement?: unknown }>(deps.getPool(), proposalKeyFor(b.id))) ?? null;
    if (!asked || String(asked.ballotId ?? "") !== b.id) {
      return hold("the agreement this vote would adopt was not recorded against it, so there is nothing to write");
    }
    const now = deps.now?.() ?? new Date();
    const roleIds = deps.loadRoles().map((r) => r.id);
    const checked = agreementForAdoption(asked.agreement, {
      roleIds,
      platformSteps: DEFAULT_EXIT_POLICY.restorative.steps,
      now,
    });
    if (!checked.ok) return hold(checked.error);

    const standing = agreementOf(deps.agreement.get(), roleIds);
    await deps.agreement.put(adoptedByBallot(checked.content, standing, b.id, now));

    out.applied = ["conflict-agreement"];
    out.proposerTold = b.openedBy;
    await deps.notify({
      userId: b.openedBy,
      type: "governance",
      title: `The village carried this: ${b.title}`,
      body: "The conflict agreement reads the new way from today, and so does the restorative path on the exit policy.",
      link: deps.ballotLink(b),
      actorUserId: actorId,
      dedupeKey: `bal:${b.id}:agreement-carried`,
    });
    await deps.addActivity("governance", "The village adopted a new conflict agreement, by its own vote.", {
      actorUserId: actorId,
      entityType: "ballot",
      entityRef: b.id,
    });
    deps.recordAudit(`conflict-agreement:adopted-by-ballot:${b.id}`, actorId);
    return out;
  };
}
