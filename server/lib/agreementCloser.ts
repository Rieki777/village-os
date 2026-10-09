/**
 * WHAT HAPPENS WHEN A VILLAGE VOTES ON AN AGREEMENT (defect 9; Wave 4).
 *
 * The `agreement` subject's whole executor, in the shape `SUBJECT_CLOSERS`
 * wants (server/lib/applyDue.ts): settle at the close, execute at the landing,
 * and put the agreement down when its vote is withdrawn or stopped.
 *
 *   carried     nothing at the close; at the landing, after the veto window
 *               like every Game change (`kindOfSubject` answers game_change),
 *               the stored agreement becomes ACTIVE, the proposer is told and
 *               the village's pulse carries one line
 *   not carried the agreement is marked not adopted and the proposer is told
 *               why, in the closer's own note
 *   withdrawn   marked withdrawn; the words stay on record
 *   stopped     a steward's veto or a written-off landing: not adopted
 *
 * IT READS THE STORED AGREEMENT, NEVER THE DOCUMENT. The words the village
 * adopts are the ones written beside the ballot when it opened
 * (server/lib/agreements.ts), for the reason server/lib/gpsChangeCloser.ts
 * gives: the ballot's markdown is copy, and a closer that recovered the words
 * by finding a heading would adopt the wrong ones the day somebody improved
 * that copy.
 *
 * WHY A FILE AND NOT A BLOCK IN server/index.ts: the subject table lives there
 * and this keeps it to one line, with every dependency declared below.
 */
import type { Pool } from "mysql2/promise";
import type { BallotRow } from "./ballots";
import type { CloseRouting, SubjectCloser } from "./applyDue";
import { markAgreement, readAgreement } from "./agreements";

export interface AgreementCloserDeps {
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
  notifyAdmins: (type: string, title: string, dedupeKey: string) => Promise<unknown>;
  addActivity: (
    kind: string,
    text: string,
    extra?: { actorUserId?: string | null; entityType?: string | null; entityRef?: string | null },
  ) => Promise<unknown>;
  ballotLink: (b: BallotRow) => string;
  now?: () => Date;
}

export function agreementCloser(deps: AgreementCloserDeps): SubjectCloser {
  const now = (): string => (deps.now?.() ?? new Date()).toISOString();
  const nothing = (): CloseRouting => ({ applied: [], held: null, proposerTold: null });

  return {
    settle: async (b, outcome, outcomeNote, actorId) => {
      // A carried vote changes nothing at the close: the landing does it.
      if (outcome === "passed") return nothing();
      await markAgreement(deps.getPool(), b.subjectRef, "not-adopted", now());
      await deps.notify({
        userId: b.openedBy,
        type: "governance",
        title:
          outcome === "no_quorum"
            ? `Too few of the village voted: ${b.title}`
            : `The village did not adopt this agreement: ${b.title}`,
        body:
          outcome === "no_quorum"
            ? "Nothing was adopted. The agreement can go to the village again whenever it is more gathered."
            : `${outcomeNote}\n\nNothing was adopted.`,
        link: deps.ballotLink(b),
        actorUserId: actorId,
        dedupeKey: `bal:${b.id}:agreement-not-adopted`,
      });
      return { applied: [], held: null, proposerTold: b.openedBy };
    },

    execute: async (b, actorId) => {
      const stored = await readAgreement(deps.getPool(), b.subjectRef);
      if (!stored) {
        await deps.notifyAdmins("governance", `A carried agreement could not land: ${b.title}`, `bal:${b.id}:agreement-held`);
        return { applied: [], held: "the agreement this vote would adopt was not recorded, so there is nothing to adopt", proposerTold: null };
      }
      await markAgreement(deps.getPool(), stored.id, "active", now());
      await deps.notify({
        userId: b.openedBy,
        type: "governance",
        title: `The village adopted this agreement: ${stored.title}`,
        body: stored.reviewAt
          ? `It binds from today, exactly as written. Its words name ${stored.reviewAt} as the day the village looks at it again, and nothing reminds anyone when that day comes yet, so put it on the calendar.`
          : "It binds from today, exactly as written. No review date is set.",
        link: deps.ballotLink(b),
        actorUserId: actorId,
        dedupeKey: `bal:${b.id}:agreement-adopted`,
      });
      await deps.addActivity("governance", `The village adopted an agreement by its own vote: ${stored.title}`, {
        actorUserId: actorId,
        entityType: "ballot",
        entityRef: b.id,
      });
      return { applied: [`agreement:${stored.id}`], held: null, proposerTold: b.openedBy };
    },

    onWithdraw: async (b) => {
      await markAgreement(deps.getPool(), b.subjectRef, "withdrawn", now());
    },

    onUnlanded: async (b) => {
      await markAgreement(deps.getPool(), b.subjectRef, "not-adopted", now());
    },
  };
}
