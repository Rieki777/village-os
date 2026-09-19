/**
 * A REDEMPTION DECIDED BY THE VILLAGE, and what happens to the held tokens at
 * every ending a ballot can reach.
 *
 * Rye, 2026-09-15: "a steward confirms but if there isn't a steward the village
 * can vote on these things". When nobody holds `redemption.confirm` the request
 * opens as a ballot instead, and this file is what that ballot DOES. The
 * decisions stay where they already live: `settleRedemption` moves the state as
 * a compare-and-set and posts, so a vote is one more caller of the door a
 * steward uses and never a second way to move value.
 *
 * ── THE FOUR ENDINGS, AND THE ONE RULE THEY SHARE ─────────────────────────
 *
 *   passed                 the village agrees the member was paid. The hold
 *                          burns to `sys:redeemed`, exactly as a confirmation.
 *   failed, no_quorum      nobody agreed. The hold is reversed and the tokens
 *                          are back in the member's wallet.
 *   withdrawn              the ballot was pulled. Reversed, same as above.
 *   vetoed, written_off    the decision never landed. Reversed. This is the
 *                          `onUnlanded` hook, which governance added to
 *                          `SubjectCloser` (server/lib/applyDue.ts) precisely
 *                          because a passed-then-stopped ballot otherwise left
 *                          a hold nobody would ever release.
 *
 * The rule they share: tokens held against a decision that did not confirm ALWAYS
 * come back. There is no ending of a ballot that leaves value in
 * `sys:redemption-hold` on purpose.
 *
 * ── WHY EVERY REVERSAL IS SAFE TO RUN TWICE ───────────────────────────────
 *
 * `releaseHold` reverses through `reverse`, which derives the mirror from the
 * stored posting and carries its own mirror key, so a second release writes one
 * mirror and answers `duplicate`. Above that, `settleRedemption` refuses to move
 * a terminal row at all. So a hook called twice, or called after a steward
 * already refused the same request, reverses once and reports success the second
 * time. That matters more here than anywhere else in this module: governance's
 * engine calls `onUnlanded` once and, when it throws, LOGS and never retries
 * (applyDue.ts), so a person is the retry, and a person re-running something
 * that already worked must not hand the member their tokens twice.
 *
 * ── WHAT A THROW MEANS, AND WHO FINDS IT ──────────────────────────────────
 *
 * This throws only when the tokens are genuinely still held: the ledger refused
 * the reversal, or the row could not be read. The message names the redemption,
 * the member and the repair, because the engine's own report is where it lands.
 *
 * AND THE REPORT HAS A GAP, said plainly rather than papered over: the
 * failed-actions tab keeps an attempt only while a landing is not_applicable,
 * pending, applying or stalled, and a vetoed or written-off row is neither, so a
 * stranded hold does NOT appear there. Two places do show it, and both are
 * reads a steward or an operator can run today: `unfinishedLandings`, and this
 * module's own `holdReconciliation`, which compares `sys:redemption-hold`
 * against the sum of open rows and reports the drift per token. The second is
 * the one that names the money, and it is the honest answer to "how would
 * anybody notice".
 */
import type { Pool } from "mysql2/promise";
import type { BallotRow } from "./ballots";
import type { CloseRouting, SubjectCloser } from "./applyDue";
import type { NotifyInput } from "./notify";
import { fromLedgerUnits } from "./economy";
import { formatMoney } from "../../shared/money";
import { tokenDef } from "./ledger";
import { redemptionById, retryRelease, settleRedemption } from "./redemptionStore";
import { openBallot, type OpenBallotResult } from "./ballots";
import type { BallotMethod } from "../../shared/governanceEngine";
import type { WeightMode } from "./governanceWeights";

/** The ballot subject type a redemption opens under. */
export const REDEMPTION_SUBJECT = "redemption";

export interface RedemptionCloserDeps {
  getPool: () => Pool;
  notify: (input: NotifyInput) => Promise<unknown>;
}

/** The member's own words for an amount, for every sentence below. */
function humanAmount(tokenSlug: string, amountUnits: number): string {
  const def = tokenDef(tokenSlug);
  return `${fromLedgerUnits(tokenSlug, amountUnits)} ${def?.name ?? tokenSlug}`;
}

export function redemptionCloser(deps: RedemptionCloserDeps): SubjectCloser {
  const { getPool, notify } = deps;

  /**
   * Give the tokens back, whatever brought us here, and say so once.
   *
   * A terminal row is NOT a failure: it means somebody already ended this
   * request. `retryRelease` is then the right call rather than a refusal,
   * because it is idempotent on the mirror key and repairs the one state that
   * would otherwise strand value (a row closed over a release that failed).
   */
  const giveBack = async (
    redemptionId: string,
    note: string,
    told: { type: string; title: (amount: string) => string; body: string },
  ): Promise<string | null> => {
    const pool = getPool();
    const row = await redemptionById(pool, redemptionId);
    if (!row) return null;
    const out = await settleRedemption(pool, { id: redemptionId, to: "refused", actorUserId: null, note });
    if (!out.ok && out.reason === "terminal") {
      // Already ended by a steward, a withdrawal, or an earlier call of this
      // hook. Make sure the tokens are actually back, then say nothing more.
      const repair = await retryRelease(pool, redemptionId);
      if (!repair.ok) {
        throw new Error(
          `redemption ${redemptionId} for member ${row.userId} is ${row.state} and its hold is still held: ` +
            `${repair.error}. Run retryRelease for this id, then check holdReconciliation for ${row.tokenSlug}.`,
        );
      }
      return row.userId;
    }
    if (!out.ok) {
      throw new Error(
        `redemption ${redemptionId} for member ${row.userId} could not be released: ${out.error}. ` +
          `The ${humanAmount(row.tokenSlug, row.amountUnits)} are still in sys:redemption-hold. ` +
          `Run retryRelease for this id, then check holdReconciliation for ${row.tokenSlug}.`,
      );
    }
    await notify({
      userId: row.userId,
      type: told.type,
      title: told.title(humanAmount(row.tokenSlug, row.amountUnits)),
      body: told.body,
      dedupeKey: `redemption:${redemptionId}:ballot-returned`,
      link: "/wallet",
    });
    return row.userId;
  };

  return {
    /**
     * The village decided. A pass BURNS, and it burns through the same door a
     * steward's confirmation uses, so every guard that door carries applies:
     * the compare-and-set, the ledger's check that the hold really posted, and
     * the row's own burn key, which makes a second close write no second
     * posting.
     */
    settle: async (b, outcome, outcomeNote): Promise<CloseRouting> => {
      const out: CloseRouting = { applied: [], held: null, proposerTold: null };
      const pool = getPool();
      const row = await redemptionById(pool, b.subjectRef);
      if (!row) {
        out.held = "the redemption this ballot names no longer exists";
        return out;
      }
      out.proposerTold = row.userId;

      if (outcome === "passed") {
        const done = await settleRedemption(pool, {
          id: b.subjectRef,
          to: "confirmed",
          actorUserId: null,
          note: outcomeNote?.trim() || "The village voted to confirm this redemption",
        });
        if (!done.ok && done.reason === "terminal") return out;
        if (!done.ok) {
          throw new Error(
            `the village passed redemption ${b.subjectRef} for member ${row.userId} and nothing was destroyed: ` +
              `${done.error}. Check holdReconciliation for ${row.tokenSlug} before pressing anything again.`,
          );
        }
        await notify({
          userId: row.userId,
          type: "redemption_confirmed",
          title: `The village confirmed your redemption, and the ${humanAmount(row.tokenSlug, row.amountUnits)} are gone`,
          body:
            "This says the village voted that you were paid. It does not say the payment arrived. If it has not, " +
            "tell a steward: the record of what was agreed is still here.",
          dedupeKey: `redemption:${b.subjectRef}:ballot-confirmed`,
          link: "/wallet",
        });
        return out;
      }

      await giveBack(
        b.subjectRef,
        outcomeNote?.trim() ||
          (outcome === "no_quorum"
            ? "Too few of the village voted for this to be decided, so the tokens came back"
            : "The village voted not to confirm this redemption"),
        {
          type: "redemption_refused",
          title: (amount) => `Your redemption was not confirmed, and your ${amount} are back in your wallet`,
          body:
            outcome === "no_quorum"
              ? "Too few members voted for the village to decide it. Nothing was destroyed and you may ask again."
              : "The village voted on it and did not confirm it. Nothing was destroyed.",
        },
      );
      return out;
    },

    /** The ballot was pulled before it decided. The tokens are not the ballot's to keep. */
    onWithdraw: async (b) => {
      await giveBack(b.subjectRef, "The ballot on this redemption was withdrawn, so the tokens came back", {
        type: "redemption_refused",
        title: (amount) => `The vote on your redemption was withdrawn, and your ${amount} are back in your wallet`,
        body: "Nothing was destroyed. You may ask again.",
      });
    },

    /**
     * THE VILLAGE SAID YES AND THE DECISION NEVER LANDED.
     *
     * A steward's veto inside the landing window, a council majority, or a
     * passed row written off after it stalled. Each is the village's yes being
     * stopped, and each would otherwise leave the tokens in the hold account
     * with no event left to release them: the ballot is over, so no closer runs
     * again, and the expiry reaper only looks at `requested` rows.
     */
    onUnlanded: async (b, reason) => {
      await giveBack(
        b.subjectRef,
        reason === "vetoed"
          ? "The village passed this redemption and a steward stopped it before it landed, so the tokens came back"
          : "The village passed this redemption and it ran out of time before it landed, so the tokens came back",
        {
          type: "redemption_refused",
          title: (amount) => `Your redemption did not go through, and your ${amount} are back in your wallet`,
          body:
            reason === "vetoed"
              ? "The village voted for it and a steward stopped it before it took effect. Nothing was destroyed."
              : "The village voted for it and it was not carried out in time. Nothing was destroyed.",
        },
      );
    },
  };
}

// ── Opening one ────────────────────────────────────────────────────────────

/**
 * Everything a village-wide vote needs, gathered by the caller.
 *
 * The shape `roleBallotSetup()` in server/index.ts already produces, because
 * the threshold arithmetic for a village-wide vote belongs in ONE place and a
 * second derivation here would eventually differ from it by a copy.
 */
export interface RedemptionBallotSetup {
  method: BallotMethod;
  dials: { unityPct: number; quorumPct: number };
  snapshot: { mode: WeightMode; token?: string | null };
  electorate: Array<{ userId: string; weight: number }>;
  durationDays: number;
}

/**
 * Put a member's redemption to the village.
 *
 * WHAT THE BALLOT SAYS IS WHAT THE MEMBER ALREADY AGREED TO, read off the row
 * and never off today's dials: the amount, what they asked for, and what the
 * village owes if it passes. The row was snapshotted at the ask (0213), so the
 * ballot and the request cannot disagree.
 *
 * ── THIS IS PUBLIC, AND THAT IS THE COST ──────────────────────────────────
 *
 * A ballot is served to anyone with the link and it is kept after it closes.
 * So the member is told BEFORE they ask (the panel's notice), and the text
 * that becomes public is only what they chose to write in `askedFor`, clipped.
 * Nothing else about them is copied in: no balance, no history, no other
 * request.
 */
export async function openRedemptionBallot(
  pool: Pool,
  setup: RedemptionBallotSetup,
  redemptionId: string,
): Promise<OpenBallotResult> {
  const row = await redemptionById(pool, redemptionId);
  if (!row) return { ok: false, error: "that redemption no longer exists" };
  const amount = humanAmount(row.tokenSlug, row.amountUnits);
  const asked = String(row.askedFor ?? "").trim().slice(0, 300);
  const worth = row.currency && row.grossMinor !== null
    ? `The village would pay ${formatMoney(row.netMinor ?? row.grossMinor, row.currency)}, off the platform.`
    : "The village and the member agreed what this is worth between them; no figure was put on it here.";
  const title = `Confirm a redemption: ${amount}`;
  return openBallot(pool, {
    subjectType: REDEMPTION_SUBJECT,
    subjectRef: row.id,
    title,
    docMarkdown: [
      `# ${title}`,
      "",
      `A member asked to turn ${amount} into: ${asked}`,
      "",
      worth,
      "",
      "A yes says the member HAS BEEN PAID off the platform, and destroys the tokens they asked to redeem.",
      "Vote yes only once the village has actually paid. A no, or too few votes, gives the tokens back in full.",
    ].join(String.fromCharCode(10)),
    method: setup.method,
    weightMode: setup.snapshot.mode,
    weightToken: setup.snapshot.token ?? null,
    unityPct: setup.dials.unityPct,
    quorumPct: setup.dials.quorumPct,
    durationDays: setup.durationDays,
    openedBy: row.userId,
    electorate: setup.electorate,
  });
}
