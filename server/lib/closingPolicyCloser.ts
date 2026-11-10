/**
 * WHAT HAPPENS WHEN A VILLAGE CARRIES A CHANGE TO ITS CLOSING WORDS.
 *
 * After the Birthing the closing section of the exit policy changes only by a
 * `closing_policy` ballot at the structural tier (sweep decision D6, Rye
 * 2026-11-06), opened by `POST /api/governance/closing-policy-changes`
 * (server/routes/closingPolicy.ts). This file is that subject's executor,
 * built like server/lib/conflictAgreementCloser.ts.
 *
 * It reads what the ballot asked, never the markdown: the words wait under
 * the ballot's own key (`closingProposalKeyFor`), written in the transaction
 * that opened it, with the ballot's id beside it. A proposal carrying any
 * other id is some other vote's, so this holds and says why.
 *
 * It runs the check the open ran (`closingStatementProblem`) and writes inside
 * the exit policy's one lock through the cached handle, every other key of the
 * document exactly as stored, stamped `adoptedBy: "ballot:<id>"` so the record
 * says the village adopted the words.
 */
import type { Pool } from "mysql2/promise";
import type { BallotOutcome } from "../../shared/governanceEngine";
import { closingStatementProblem } from "../../shared/closingPolicies";
import type { BallotRow } from "./ballots";
import type { CloseRouting } from "./applyDue";
import { readConfigDocument } from "../repos/appConfigDocs";
import { withExitPolicyLock } from "./exitPolicyWrites";
import { adoptedByClosingBallot, closingProposalKeyFor } from "./closingPolicy";

export interface ClosingPolicyCloserDeps {
  getPool: () => Pool;
  /** The exit policy's cached handle, `exitPolicyRepo` in server/index.ts. */
  exitPolicy: { get(): any; put(doc: any): Promise<unknown> };
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
export function closingPolicyCloser(deps: ClosingPolicyCloserDeps) {
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
            : `${outcomeNote}\n\nWhat closing this village means stands as it was.`,
        link: deps.ballotLink(b),
        actorUserId: actorId,
        dedupeKey: `bal:${b.id}:closing-not-carried`,
      });
      return out;
    }

    const hold = async (why: string) => {
      out.held = why;
      await deps.notifyAdmins("governance", `A carried change to what closing means could not land: ${b.title}`, `bal:${b.id}:closing-held`);
      return out;
    };

    const asked =
      (await readConfigDocument<{ ballotId?: unknown; policyId?: unknown; statement?: unknown }>(deps.getPool(), closingProposalKeyFor(b.id))) ?? null;
    if (!asked || String(asked.ballotId ?? "") !== b.id) {
      return hold("the words this vote would adopt were not recorded against it, so there is nothing to write");
    }
    const policyId = String(asked.policyId ?? "").trim();
    const statement = String(asked.statement ?? "").trim();
    const problem = closingStatementProblem(policyId, statement);
    if (problem) return hold(problem);

    const now = deps.now?.() ?? new Date();
    await withExitPolicyLock(async () => {
      const stored = deps.exitPolicy.get() ?? {};
      await deps.exitPolicy.put({
        ...stored,
        closing: { policyId, statement, adoptedBy: adoptedByClosingBallot(b.id), adoptedAt: now.toISOString() },
      });
    });

    out.applied = ["closing-policy"];
    out.proposerTold = b.openedBy;
    await deps.notify({
      userId: b.openedBy,
      type: "governance",
      title: `The village carried this: ${b.title}`,
      body: "The exit policy says the new words about closing from today.",
      link: deps.ballotLink(b),
      actorUserId: actorId,
      dedupeKey: `bal:${b.id}:closing-carried`,
    });
    await deps.addActivity("governance", "The village adopted new words for what closing it means, by its own vote.", {
      actorUserId: actorId,
      entityType: "ballot",
      entityRef: b.id,
    });
    deps.recordAudit(`closing-policy:adopted-by-ballot:${b.id}`, actorId);
    return out;
  };
}
