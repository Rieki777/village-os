/**
 * WHAT A BALLOT LEFT BEHIND, in words, out of the page that renders them.
 *
 * `client/src/pages/GameMechanics.tsx` is one of four client files under the
 * monolith ratchet (`scripts/check-file-lines.mjs`), and this reading is copy
 * rather than page machinery: it is read by two components and by
 * `gameMechanicsStates.test.ts`, and it moved here whole when it stopped being
 * a constant and became a function of the village's own word for whoever runs
 * it. Nothing about the words changed in the move.
 */
import type { BallotStatus } from "./GameMechanics";

/**
 * WHY A PROPOSAL IS SITTING WHERE IT IS SITTING.
 *
 * A proposal back at `open` while holding a ballot id has BEEN to a vote and
 * come back, and until the close route was fixed there was no such thing: a
 * missed quorum wrote `failed` on the subject, so "too few of us were here"
 * went on the record as "the village rejected this". Two facts, and the second
 * one was false.
 *
 * Both ways back settle NOTHING, and the words have to carry that or the fix
 * only reached the database. The vocabulary is the bell's, deliberately:
 * `ballot_no_quorum` says too few of the roll answered and the question
 * stands, `ballot_withdrawn` says a vote was called off before it closed. One
 * event, one set of words, however a member meets it.
 *
 * `passed` and `failed` are here for the record only. The proposal's own
 * status already says what happened, so this adds the link and stays quiet.
 */
export type BallotReturnReading = Record<BallotStatus, { chip: string | null; cls: string; line: string | null; tip: string | null }>;

/*
 * A FUNCTION OF THE VILLAGE'S WORD FOR WHOEVER RUNS IT, and it used to be a
 * plain const. The withdrawal tip names that person, so the reading cannot be
 * fixed at module scope any more than the currency name can. Still keyed by
 * `BallotStatus`, so a status added to the union is a compile error here and
 * not an empty tooltip on somebody's card.
 */
export function ballotReturn(catalyst: string): BallotReturnReading {
  return {
    open: { chip: null, cls: "", line: null, tip: null },
    passed: { chip: null, cls: "", line: null, tip: null },
    failed: { chip: null, cls: "", line: null, tip: null },
    no_quorum: {
      chip: "too few spoke",
      cls: "bg-stone-100 text-stone-600",
      line: "Too few of the village voted for that ballot to settle anything. This stands where it stood, holding its supporters and every word of it, and it can go to a vote again.",
      tip: "A vote settles something only when enough of the village answers it. Too few did, so that ballot decided nothing and this went back where it was. Going again means a new vote, frozen fresh on the day it opens.",
    },
    withdrawn: {
      chip: "its vote was called off",
      cls: "bg-stone-100 text-stone-600",
      line: "The vote on this was called off before it closed, so nothing was decided. It holds its supporters and every word of it, and the reason is on that vote's record.",
      tip: `Whoever opens a vote can call it off while nobody has answered it. Once even one vote stands, calling it off takes a proposal.decide holder or ${catalyst}, because cast votes belong to the people who cast them.`,
    },
  };
}
