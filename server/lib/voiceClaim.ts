/**
 * Carrying accrued voice to Hypha.
 *
 * Voice is earned here and settles there. This module is the whole crossing,
 * and it is deliberately separate from `economy.ts`: that file is the rules
 * between an event and a ledger post, and this one is a conversation with
 * somewhere else, which fails in completely different ways.
 *
 * THE DEBIT HAPPENS AT REQUEST, NOT AT CONFIRMATION. That is the claim shape
 * 0072 was built for: voice leaves the member's balance the moment they ask, so
 * it cannot be spent or claimed twice while a proposal is pending, and every
 * ending that is not a confirmation gives it back by REVERSING that debit
 * rather than by minting fresh. A refund that mints is a way to make voice.
 *
 * `sys:voice-bridge` holds it in between, and is deliberately NOT a faucet:
 * voice held against a claim came from a member, and a faucet there would let a
 * claim create the voice it claims.
 */
import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { numberVar, stringVar } from "./variables";
import { zonedTimeToUtc } from "../../shared/lunar";
import { villageTimezone } from "./villageReaders";
import { memberAccount, postTransfer } from "./ledger";
import {
  canSettleClaim,
  claimRefunds,
  fromLedgerUnits,
  keys,
  reverse,
  toLedgerUnits,
  VILLAGE_VOICE,
  VOICE_BRIDGE,
  villageId,
  type ClaimState,
} from "./economy";

/**
 * Where voice sits once Hypha has executed a claim.
 *
 * Not a faucet: this voice came from a member. Kept apart from the bridge so
 * `bridgeReconciliation` has something true to compare against. Seeded by 0076.
 */
export const VOICE_SETTLED = "sys:voice-settled";

/**
 * IS THERE ANYTHING AT THE OTHER END OF THE CROSSING YET?
 *
 * `false` until the bridge dispatch ships. It is a constant and not a dial
 * because it describes what this BUILD can do, and no village should be able to
 * turn it on by typing in an admin panel.
 *
 * Why this exists, which is the whole point: a claim debits the member's voice
 * at request and waits for Hypha to answer. Nothing here raises the proposal
 * yet, so Hypha is never told, so the webhook never fires, so the claim would
 * sit in `requested` forever with the member's balance reading zero. The only
 * way out would be the member happening to cancel it themselves.
 *
 * Naming the Hypha space is therefore NOT sufficient to open claims, even
 * though it is the last piece of configuration. The founder can fill the slug
 * in the moment they have it and nothing is armed by doing so.
 *
 * WHEN THE DISPATCH SHIPS: flip this to true in the same commit, and not
 * before. `docs/HYPHA_VOICE_CLAIM_HANDOFF.md` step 2 is the work.
 *
 * `claimReadiness` and `requestVoiceClaim` take it as a defaulted parameter so
 * the suite can still exercise the debit, the refund and the compare-and-set,
 * which are the parts that will matter most on the day the dispatch lands. The
 * ONLY caller that passes it is `server/voiceClaim.test.ts`; anything in
 * `server/index.ts` passing it would be turning claims on by hand, and a grep
 * for the name is enough to see that.
 */
export const BRIDGE_DISPATCH_BUILT = false;

/**
 * Is the claims window open, and when does it next open?
 *
 * Dates a year, each opening a window of `claims_week_days`. Blank dates mean
 * always open, which is a real answer for a village that would sooner not
 * batch. When it is shut the caller is told the NEXT opening, because "claims
 * are closed" with no date is a dead end.
 *
 * THIS WINDOW IS SOLAR, AND IT IS NOT THE CYCLE CLOCK. The dates are MM-DD
 * marks on the sun's year, the settlement runs on cycles, and a season is a
 * third object again. The registry copy used to say the default "is the same
 * rhythm the moon settlement already runs on", which was untrue and is now
 * corrected. Q5 asks for one clock, and the honest half of that answer that
 * this file can give is the DAY: the window opens at midnight where the
 * village lives rather than at midnight UTC, and its length is counted in
 * whole days of that same zone, so a village six hours behind UTC no longer
 * finds its Claims Week opening the evening before and closing the evening
 * before it should.
 */
export function claimsWindow(
  at: Date = new Date(),
  timeZone: string = villageTimezone(),
): { open: boolean; nextOpens: Date | null } {
  const raw = String(stringVar("economy.claims_week_starts") ?? "").trim();
  if (!raw) return { open: true, nextOpens: null };
  const days = Math.max(1, numberVar("economy.claims_week_days"));
  const starts: Date[] = [];
  // Three years of windows, so a date in late December finds the next opening
  // in January instead of being told claims never open again.
  for (const year of [at.getUTCFullYear() - 1, at.getUTCFullYear(), at.getUTCFullYear() + 1]) {
    for (const part of raw.split(",")) {
      /*
       * STRICTLY MM-DD, and a real day of a real month.
       *
       * The loose version was `split("-").map(Number)` with a truthiness check,
       * which read "2026-06-21" as month 2026 and quietly built a window in the
       * year 2194. `Date.UTC` rolls a month past twelve into later years rather
       * than rejecting it, so nothing threw: claims simply shut for a century
       * and a half, and members were shown that date as the next opening. A
       * full ISO date is the single most likely thing for somebody to paste
       * into a field labelled with dates.
       *
       * "02-30" is refused the same way, by reading the constructed date back
       * and requiring it to be the day that was asked for.
       */
      const match = /^(\d{1,2})-(\d{1,2})$/.exec(part.trim());
      if (!match) continue;
      const m = Number(match[1]);
      const d = Number(match[2]);
      if (m < 1 || m > 12 || d < 1 || d > 31) continue;
      const probe = new Date(Date.UTC(year, m - 1, d));
      if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) continue;
      // Midnight in the village's own zone, which is when a day starts for
      // the people the window is for.
      starts.push(zonedTimeToUtc(year, m, d, 0, 0, timeZone));
    }
  }
  // Dates were configured and NONE of them parsed. Falling through to "open all
  // year" here would read a typo as permission, so the window stays shut and
  // says so, which is the same direction every other guard in this file fails.
  if (!starts.length) return { open: false, nextOpens: null };
  starts.sort((a, b) => a.getTime() - b.getTime());
  const ms = days * 24 * 60 * 60 * 1000;
  for (const s of starts) {
    if (at >= s && at.getTime() < s.getTime() + ms) return { open: true, nextOpens: null };
  }
  return { open: false, nextOpens: starts.find((s) => s > at) ?? null };
}

export interface ClaimReadiness {
  balance: number;
  threshold: number;
  claimable: boolean;
  windowOpen: boolean;
  nextOpens: string | null;
  spaceConfigured: boolean;
  /** Whether this build can actually carry a claim to Hypha. */
  bridgeReady: boolean;
  openClaim: { id: string; amount: number; since: string } | null;
  /** One sentence for the chip. Never a button that would fail. */
  says: string;
}

/**
 * What a member's voice chip should say, and whether it may be pressed.
 *
 * The order of the messages is the contract: tell somebody the nearest true
 * thing. Being under the threshold is more useful than being told the window is
 * shut, when they could not have claimed either way.
 */
export async function claimReadiness(
  pool: Pool,
  userId: string,
  bridgeReady: boolean = BRIDGE_DISPATCH_BUILT,
): Promise<ClaimReadiness> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `balance` FROM `token_balances` WHERE `account_id` = ? AND `token_type` = ?",
    [memberAccount(userId), VILLAGE_VOICE],
  );
  const units = Number(rows[0]?.balance ?? 0);
  const balance = fromLedgerUnits(VILLAGE_VOICE, units);
  const threshold = numberVar("economy.voice_claim_threshold");
  const { open, nextOpens } = claimsWindow();
  const space = String(stringVar("economy.hypha_space") ?? "").trim();
  const enough = balance >= threshold;

  const [pending] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `amount`, `created_at` FROM `voice_claims` " +
      "WHERE `village_id` = ? AND `user_id` = ? AND `state` = 'requested' LIMIT 1",
    [villageId(), userId],
  );
  const openClaim = pending.length
    ? {
        id: String(pending[0].id),
        amount: Number(pending[0].amount),
        since: new Date(pending[0].created_at).toISOString(),
      }
    : null;

  const says = openClaim
    ? `${openClaim.amount} is with Hypha, waiting on a vote.`
    : !enough
      ? `${balance} gathered. Claims open at ${threshold}.`
      : !space
        ? `${balance} gathered, and ready. The village has not named its Hypha space yet.`
        : !bridgeReady
          ? `${balance} gathered, and ready. The connection to Hypha is still being finished.`
          : !open
            ? nextOpens
              ? `${balance} gathered, and ready. Claims open on ${nextOpens.toISOString().slice(0, 10)}.`
              : `${balance} gathered, and ready. Claims are closed just now.`
            : `${balance} ready to claim.`;

  return {
    balance,
    threshold,
    claimable: enough && open && !!space && bridgeReady && !openClaim,
    windowOpen: open,
    nextOpens: nextOpens ? nextOpens.toISOString() : null,
    spaceConfigured: !!space,
    bridgeReady,
    openClaim,
    says,
  };
}

export type ClaimOutcome =
  | { ok: true; claimId: string; amount: number }
  | { ok: false; status: number; error: string };

const debitKeyFor = (claimId: string) => `voice-claim-debit:${villageId()}:${claimId}`;

/**
 * Ask to carry accrued voice to Hypha.
 *
 * Serializable, with the member's row locked, for the same reason a gift is: a
 * balance read outside the write is a check somebody can stand between.
 */
export async function requestVoiceClaim(
  pool: Pool,
  userId: string,
  bridgeReady: boolean = BRIDGE_DISPATCH_BUILT,
): Promise<ClaimOutcome> {
  const ready = await claimReadiness(pool, userId, bridgeReady);
  // FIRST, and as a hard refusal: taking the debit with nothing able to raise
  // the proposal would strand the voice at the bridge with no event coming to
  // release it. The member's balance would read zero and only they could undo
  // it, by knowing to cancel something they were never told was stuck.
  if (!bridgeReady) {
    return {
      ok: false,
      status: 503,
      error: "The connection to Hypha is still being finished, so claims cannot be carried yet.",
    };
  }
  if (!ready.spaceConfigured) {
    return { ok: false, status: 409, error: "The village has not named its Hypha space yet." };
  }
  if (ready.openClaim) {
    return { ok: false, status: 409, error: "You already have a claim waiting on Hypha." };
  }
  if (!ready.windowOpen || ready.balance < ready.threshold) {
    return { ok: false, status: 409, error: ready.says };
  }

  const conn = await pool.getConnection();
  let claimId = "";
  let amountUnits = 0;
  try {
    await conn.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    await conn.beginTransaction();

    const [who] = await conn.query<RowDataPacket[]>(
      "SELECT `id` FROM `users` WHERE `id` = ? FOR UPDATE",
      [userId],
    );
    if (!who.length) {
      await conn.rollback();
      return { ok: false, status: 404, error: "no such member" };
    }

    // ONE open claim per member. Two pending proposals for one person's voice
    // would each be sized against a balance the other has already spoken for.
    // Re-read inside the lock: the readiness check above decides what to SAY.
    const [open] = await conn.query<RowDataPacket[]>(
      "SELECT `id` FROM `voice_claims` WHERE `village_id` = ? AND `user_id` = ? AND `state` = 'requested' LIMIT 1",
      [villageId(), userId],
    );
    if (open.length) {
      await conn.rollback();
      return { ok: false, status: 409, error: "You already have a claim waiting on Hypha." };
    }

    const [bal] = await conn.query<RowDataPacket[]>(
      "SELECT `balance` FROM `token_balances` WHERE `account_id` = ? AND `token_type` = ? FOR UPDATE",
      [memberAccount(userId), VILLAGE_VOICE],
    );
    amountUnits = Number(bal[0]?.balance ?? 0);
    if (amountUnits < toLedgerUnits(VILLAGE_VOICE, ready.threshold)) {
      await conn.rollback();
      return { ok: false, status: 409, error: "There is less voice here than the claim needs." };
    }

    claimId = `vc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await conn.query(
      "INSERT INTO `voice_claims` (`id`, `village_id`, `user_id`, `token_slug`, `amount`, `state`, " +
        "`debit_key`, `intent_key`, `hypha_space`) VALUES (?,?,?,?,?,'requested',?,?,?)",
      [
        claimId,
        villageId(),
        userId,
        VILLAGE_VOICE,
        fromLedgerUnits(VILLAGE_VOICE, amountUnits),
        debitKeyFor(claimId),
        keys.voiceClaim(villageId(), claimId),
        String(stringVar("economy.hypha_space") ?? "").trim(),
      ],
    );
    await conn.commit();
  } catch (err: any) {
    try {
      await conn.rollback();
    } catch {
      /* the connection is already gone */
    }
    return { ok: false, status: 500, error: String(err?.message ?? err) };
  } finally {
    conn.release();
  }

  // The debit, keyed on the claim row so a retry moves the voice once. Member
  // to the bridge, which is not a faucet.
  //
  // WRAPPED, because `postTransfer` rolls back and RETHROWS on any database
  // error (a lock wait, a dropped connection). The route wrapper would turn
  // that into a 500, but the claim row is already committed, so the throw would
  // leave a `requested` claim with no debit behind it: a row saying the member's
  // voice is held when it is still in their hands. Conservation would not
  // notice, because nothing was posted. Treating a throw exactly like a refusal
  // keeps the two failures on one path.
  let res: { ok: boolean; duplicate: boolean; error?: string };
  try {
    res = await postTransfer(pool, {
      from: memberAccount(userId),
      to: VOICE_BRIDGE,
      tokenType: VILLAGE_VOICE,
      amount: amountUnits,
      source: "voice_claim",
      sourceRef: claimId,
      description: "Voice claimed toward Hypha",
      idempotencyKey: debitKeyFor(claimId),
    });
  } catch (err: any) {
    res = { ok: false, duplicate: false, error: String(err?.message ?? err) };
  }
  if (!res.ok && !res.duplicate) {
    // The row exists and the debit did not. The claim is marked rather than
    // deleted: a claim with no debit behind it is repairable, and one that
    // vanished is not even findable. `rejected` refunds, and reversing a debit
    // that never posted is a no-op, so this cannot hand back voice.
    await pool.query(
      "UPDATE `voice_claims` SET `state` = 'rejected', `settled_at` = CURRENT_TIMESTAMP, " +
        "`note` = ? WHERE `id` = ? AND `state` = 'requested'",
      ["the ledger refused the debit", claimId],
    );
    return { ok: false, status: 500, error: res.error ?? "the ledger refused the debit" };
  }
  return { ok: true, claimId, amount: fromLedgerUnits(VILLAGE_VOICE, amountUnits) };
}

/**
 * End a claim, and give the voice back unless Hypha confirmed it.
 *
 * THE STATE MOVES FIRST, AS A COMPARE-AND-SET, AND THE REFUND FOLLOWS IT. A
 * cancel and a confirm can arrive at the same instant from two directions: the
 * member's browser and Hypha's callback. If the refund went first, both would
 * read `requested`, the cancel would hand the voice back, and the confirm would
 * then win the row, leaving somebody refunded here AND paid there. Only the
 * caller whose UPDATE actually changed a row is allowed to refund.
 *
 * The refund REVERSES the original debit, so it inherits every guard that debit
 * passed and cannot become a way to make voice. `reverse` is idempotent on its
 * mirror key, so a retry after a crash between the two steps settles correctly.
 */
export type SettleFailure = "missing" | "terminal" | "raced" | "refund-failed";

export async function settleVoiceClaim(
  pool: Pool,
  claimId: string,
  to: ClaimState,
  note?: string,
): Promise<{ ok: true; refunded: boolean } | { ok: false; reason: SettleFailure; error: string }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM `voice_claims` WHERE `id` = ? AND `village_id` = ?",
    [claimId, villageId()],
  );
  const claim = rows[0];
  if (!claim) return { ok: false, reason: "missing", error: "no such claim" };

  const verdict = canSettleClaim(String(claim.state) as ClaimState, to);
  if (!verdict.ok) {
    return { ok: false, reason: "terminal", error: verdict.error ?? "that claim cannot move" };
  }

  const [upd] = await pool.query<ResultSetHeader>(
    "UPDATE `voice_claims` SET `state` = ?, `settled_at` = CURRENT_TIMESTAMP, `note` = ? " +
      "WHERE `id` = ? AND `village_id` = ? AND `state` = ?",
    [to, note ?? null, claimId, villageId(), String(claim.state)],
  );
  if (upd.affectedRows !== 1) {
    // Somebody else moved it between the read and the write. Theirs stands, and
    // this caller must not refund against a state it no longer owns.
    return { ok: false, reason: "raced", error: "that claim was settled by something else a moment ago" };
  }

  if (!claimRefunds(to)) {
    /*
     * A confirmation. The voice has settled on Hypha, so it moves OFF the
     * bridge and onto the account that means "gone, and it went there".
     *
     * 0072 left it at the bridge and called that the truthful record. It was
     * truthful and unusable: the bridge balance became (open claims) plus
     * (every claim ever confirmed), which is a number nothing can be compared
     * against. Moving it makes `bridgeReconciliation` a real check.
     *
     * A failure here does NOT fail the settlement. The claim is confirmed on
     * Hypha whatever this ledger says, and the voice is still off the member's
     * balance either way, so the honest outcome is a confirmed claim and a
     * reconciliation drift somebody can see, rather than a 500 that invites a
     * retry against a terminal claim.
     */
    const moved = await postTransfer(pool, {
      from: VOICE_BRIDGE,
      to: VOICE_SETTLED,
      tokenType: VILLAGE_VOICE,
      amount: toLedgerUnits(VILLAGE_VOICE, Number(claim.amount)),
      source: "voice_claim_settled",
      sourceRef: claimId,
      description: `Settled on Hypha: ${claimId}`,
      idempotencyKey: `voice-claim-settled:${villageId()}:${claimId}`,
    }).catch((err: any) => ({ ok: false, duplicate: false, error: String(err?.message ?? err) }));
    if (!moved.ok && !moved.duplicate) {
      console.error(`[voice claim] ${claimId} confirmed but did not leave the bridge: ${moved.error}`);
    }
    return { ok: true, refunded: false };
  }

  const back = await reverse(pool, String(claim.debit_key), {
    from: VOICE_BRIDGE,
    to: memberAccount(String(claim.user_id)),
    tokenSlug: VILLAGE_VOICE,
    amount: toLedgerUnits(VILLAGE_VOICE, Number(claim.amount)),
    note: note ?? `Voice returned: ${to}`,
  });
  if (!back.ok) {
    // The claim is terminal and the voice is still at the bridge. Re-entering
    // through this function cannot fix it, because `canSettleClaim` refuses
    // every transition out of a terminal state: that is what `retryRefund`
    // below is for, and the note is written so a human reading the row knows
    // the money is still here.
    await pool
      .query("UPDATE `voice_claims` SET `note` = ? WHERE `id` = ? AND `village_id` = ?", [
        `refund failed, voice still held: ${String(back.error).slice(0, 200)}`,
        claimId,
        villageId(),
      ])
      .catch(() => {
        /* the note is a courtesy; the reconciliation below is the real record */
      });
    return { ok: false, reason: "refund-failed", error: `the claim closed but the refund failed: ${back.error}` };
  }
  return { ok: true, refunded: true };
}

/**
 * Give back voice that a refunding claim closed over without releasing.
 *
 * The repair path for `refund-failed`. It deliberately does NOT go through
 * `canSettleClaim`, because the claim is already in the state it should be in
 * and the state machine is right to refuse moving it: what failed was the
 * ledger post, not the transition.
 *
 * Safe to run against any refunding claim at any time. `reverse` is idempotent
 * on its mirror key, so a claim already refunded is a no-op, and a claim never
 * refunded is repaired. That makes this the correct thing for a poller, an
 * admin button, or an operator to call blindly over `openBridgeHoldings`.
 */
export async function retryRefund(
  pool: Pool,
  claimId: string,
): Promise<{ ok: true; refunded: boolean } | { ok: false; error: string }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM `voice_claims` WHERE `id` = ? AND `village_id` = ?",
    [claimId, villageId()],
  );
  const claim = rows[0];
  if (!claim) return { ok: false, error: "no such claim" };
  const state = String(claim.state) as ClaimState;
  if (!claimRefunds(state)) {
    return { ok: false, error: `a ${state} claim is not owed a refund` };
  }
  const back = await reverse(pool, String(claim.debit_key), {
    from: VOICE_BRIDGE,
    to: memberAccount(String(claim.user_id)),
    tokenSlug: VILLAGE_VOICE,
    amount: toLedgerUnits(VILLAGE_VOICE, Number(claim.amount)),
    note: `Voice returned on repair: ${state}`,
  });
  if (!back.ok) return { ok: false, error: back.error };
  return { ok: true, refunded: !back.duplicate };
}

/**
 * What the bridge should be holding, and what it is holding.
 *
 * The invariant 0076 made available: `sys:voice-bridge` holds voice against
 * OPEN claims and nothing else, so its balance must equal the sum of every
 * claim still in `requested`. A stranded claim, a refund that failed silently,
 * a debit posted against a claim that was then abandoned: each breaks this
 * equality, and none of them break conservation on their own, which is why
 * conservation alone was never going to catch them.
 */
export async function bridgeReconciliation(
  pool: Pool,
): Promise<{ held: number; owed: number; drift: number; openClaims: number }> {
  const [balRows] = await pool.query<RowDataPacket[]>(
    "SELECT `balance` FROM `token_balances` WHERE `account_id` = ? AND `token_type` = ?",
    [VOICE_BRIDGE, VILLAGE_VOICE],
  );
  const held = Number(balRows[0]?.balance ?? 0);

  const [openRows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n, COALESCE(SUM(`amount`),0) AS total FROM `voice_claims` " +
      "WHERE `village_id` = ? AND `state` = 'requested'",
    [villageId()],
  );
  const owed = toLedgerUnits(VILLAGE_VOICE, Number(openRows[0]?.total ?? 0));
  return { held, owed, drift: held - owed, openClaims: Number(openRows[0]?.n ?? 0) };
}

/** Every claim a member has made, newest first. For the profile. */
export async function claimHistory(pool: Pool, userId: string, limit = 20) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `amount`, `state`, `hypha_ref`, `created_at`, `settled_at`, `note` " +
      "FROM `voice_claims` WHERE `village_id` = ? AND `user_id` = ? ORDER BY `created_at` DESC LIMIT ?",
    [villageId(), userId, Math.min(100, Math.max(1, limit))],
  );
  return rows.map((r) => ({
    id: String(r.id),
    amount: Number(r.amount),
    state: String(r.state) as ClaimState,
    hyphaRef: r.hypha_ref ? String(r.hypha_ref) : null,
    requestedAt: new Date(r.created_at).toISOString(),
    settledAt: r.settled_at ? new Date(r.settled_at).toISOString() : null,
    note: r.note ? String(r.note) : null,
  }));
}

/**
 * Refuse to boot on a secret that is missing or borrowed.
 *
 * The dangerous state is a receiver that is REACHABLE with a weak secret rather
 * than one that is idle, so this runs at boot rather than at the first request.
 * An empty secret is not permission, and reusing the governance hub's secret
 * would mean anything able to sign a mechanics callback could also confirm a
 * claim on value.
 *
 * A village that has not named a Hypha space has not opened the crossing, and
 * should not be unable to boot because of a secret it has no use for yet.
 */
export function checkVoiceSecret(
  env: NodeJS.ProcessEnv = process.env,
): { ok: true } | { ok: false; fatal: boolean; error: string } {
  const secret = String(env.HYPHA_VOICE_WEBHOOK_SECRET ?? "").trim();
  if (!secret) {
    // NOT fatal. The receiver answers 503 with no secret, so an unsecured
    // village is unreachable rather than exposed, and killing the process here
    // would mean an admin naming their space could take the village down at the
    // next restart with no way back in.
    return {
      ok: false,
      fatal: false,
      error:
        "HYPHA_VOICE_WEBHOOK_SECRET is empty while economy.hypha_space is set. The claim receiver " +
        "will refuse every delivery until it is set.",
    };
  }
  if (secret.length < 32) {
    return {
      ok: false,
      fatal: true,
      error: "HYPHA_VOICE_WEBHOOK_SECRET is too short to be a real secret. Generate 32 bytes of hex.",
    };
  }
  const borrowed = [env.GOVERNANCE_HUB_SECRET, env.STRIPE_WEBHOOK_SECRET, env.JWT_SECRET, env.SESSION_SECRET]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
  if (borrowed.includes(secret)) {
    return {
      ok: false,
      fatal: true,
      error:
        "HYPHA_VOICE_WEBHOOK_SECRET matches another secret in this environment. One secret, one job: " +
        "anything able to sign that other callback could otherwise confirm a claim on value.",
    };
  }
  return { ok: true };
}

export function assertVoiceSecret(env: NodeJS.ProcessEnv = process.env): void {
  const space = String(stringVar("economy.hypha_space") ?? "").trim();
  if (!space) return;

  const verdict = checkVoiceSecret(env);
  if (verdict.ok) return;
  if (verdict.fatal) throw new Error(verdict.error);
  // Loud, and survivable. The admin who caused this is refused at the WRITE
  // (see the economy.hypha_space branch in PUT /api/admin/variables), so the
  // only way to reach it is an env change after the fact, which is repaired by
  // another env change rather than by a dead container.
  console.error(`[voice claim] ${verdict.error}`);
}
