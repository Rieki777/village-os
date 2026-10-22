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
 *
 * TWO TOKENS CROSS HERE NOW, THROUGH ONE PIECE OF CODE (0266). Earned equity
 * accrues in this ledger the way voice does and is claimed toward the `equity`
 * mirror on Hypha the way voice is claimed toward the `voice` mirror. Each token
 * is a LANE below: its own bridge, its own settled account, its own threshold
 * dial and its own key prefix, and everything else shared. The debit, the
 * compare-and-set, the refund by reversal, the window, the Hypha space and the
 * bridge gate are written once. A copied twin is how a fix lands in one and not
 * the other, so there is no `equityClaim.ts`.
 *
 * `voice_claims` already carried a `token_slug` column from 0072, which is what
 * makes one table enough. Every read below now filters on it, because before
 * there were two lanes "this member's open claim" and "what the bridge owes"
 * never had to say which token they meant.
 *
 * A SETTLEMENT FINDS ITS LANE FROM THE ROW, never from the caller. The webhook
 * and the cancel route name a claim id and nothing else, and the token comes
 * back out of the stored row exactly as the village, member and amount do.
 */
import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { numberVar, stringVar } from "./variables";
import { zonedTimeToUtc } from "../../shared/lunar";
import { villageTimezone } from "./villageReaders";
import { memberAccount, postTransfer, tokenDef } from "./ledger";
import {
  canSettleClaim,
  claimRefunds,
  EARNED_EQUITY,
  EQUITY_BRIDGE,
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

/** Where earned equity sits once Hypha has executed a claim. Seeded by 0266, and not a faucet either. */
export const EQUITY_SETTLED = "sys:equity-settled";

/** Which lane a claim travels in. A closed set: a third token is a third entry here, read on purpose. */
export type ClaimLaneId = "voice" | "equity";

/**
 * Everything that differs between one claimable token and another.
 *
 * Nothing here is a dial. The bridge, the settled account and the sources are
 * facts the migrations and the ledger already agree on, so a village cannot
 * point a claim at a different account by typing in a panel.
 */
export interface ClaimLane {
  id: ClaimLaneId;
  /** The platform token that accrues in this ledger. */
  token: string;
  /** The read-only Hypha mirror it is claimed toward, on Base. */
  mirror: string;
  /** Holds the amount against an open claim. NOT a faucet. */
  bridge: string;
  /** Where the amount goes once Hypha confirms. NOT a faucet. */
  settled: string;
  /** The dial that says how much a member gathers before claiming. */
  thresholdKey: string;
  /** Ledger source of the debit at request. */
  debitSource: string;
  /** Ledger source of the move from the bridge to the settled account. */
  settledSource: string;
  /** First segment of a claim row id, so a row says which lane it is at a glance. */
  idPrefix: string;
  /** The intent the bridge dispatches under. UNIQUE in 0072. */
  intentKey: (village: string, claimRowId: string) => string;
}

export const VOICE_LANE: ClaimLane = {
  id: "voice",
  token: VILLAGE_VOICE,
  mirror: "voice",
  bridge: VOICE_BRIDGE,
  settled: VOICE_SETTLED,
  thresholdKey: "economy.voice_claim_threshold",
  debitSource: "voice_claim",
  settledSource: "voice_claim_settled",
  idPrefix: "vc",
  intentKey: (v, id) => keys.voiceClaim(v, id),
};

export const EQUITY_LANE: ClaimLane = {
  id: "equity",
  token: EARNED_EQUITY,
  mirror: "equity",
  bridge: EQUITY_BRIDGE,
  settled: EQUITY_SETTLED,
  thresholdKey: "economy.equity_claim_threshold",
  debitSource: "equity_claim",
  settledSource: "equity_claim_settled",
  idPrefix: "ec",
  intentKey: (v, id) => keys.equityClaim(v, id),
};

/** Every lane, in the order a member's wallet lists them. */
export const CLAIM_LANES: readonly ClaimLane[] = [EQUITY_LANE, VOICE_LANE];

/** The lane a token is claimed through, or null when it never crosses. */
export function laneForToken(slug: string): ClaimLane | null {
  return CLAIM_LANES.find((l) => l.token === slug) ?? null;
}

/** The word a member reads for a lane's token, from the live registry. */
function laneName(lane: ClaimLane): string {
  return tokenDef(lane.token)?.name?.trim() || lane.token;
}

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
  /** The token this answer is about. */
  token: string;
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
 * What a member's chip for one claimable token should say, and whether it may
 * be pressed.
 *
 * The order of the messages is the contract: tell somebody the nearest true
 * thing. Being under the threshold is more useful than being told the window is
 * shut, when they could not have claimed either way.
 *
 * The sentences name no token on purpose. Every surface that shows one already
 * names the token beside it, from the registry, so a rename never leaves an old
 * word inside a sentence.
 */
export async function claimReadinessFor(
  pool: Pool,
  userId: string,
  lane: ClaimLane,
  bridgeReady: boolean = BRIDGE_DISPATCH_BUILT,
): Promise<ClaimReadiness> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `balance` FROM `token_balances` WHERE `account_id` = ? AND `token_type` = ?",
    [memberAccount(userId), lane.token],
  );
  const units = Number(rows[0]?.balance ?? 0);
  const balance = fromLedgerUnits(lane.token, units);
  const threshold = numberVar(lane.thresholdKey);
  const { open, nextOpens } = claimsWindow();
  const space = String(stringVar("economy.hypha_space") ?? "").trim();
  // `balance > 0` as well as the threshold, so a dial somebody set below one
  // can never offer a claim on nothing.
  const enough = balance > 0 && balance >= threshold;

  // ONE OPEN CLAIM PER MEMBER PER TOKEN. A voice claim and an equity claim are
  // two proposals about two different balances, and neither is sized against
  // the other, so the rule that stops a balance being spoken for twice is a
  // rule about one token.
  const [pending] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `amount`, `created_at` FROM `voice_claims` " +
      "WHERE `village_id` = ? AND `user_id` = ? AND `token_slug` = ? AND `state` = 'requested' LIMIT 1",
    [villageId(), userId, lane.token],
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
    token: lane.token,
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

/** The voice chip, which is the profile's `voice` block. */
export async function claimReadiness(
  pool: Pool,
  userId: string,
  bridgeReady: boolean = BRIDGE_DISPATCH_BUILT,
): Promise<ClaimReadiness> {
  return claimReadinessFor(pool, userId, VOICE_LANE, bridgeReady);
}

export type ClaimOutcome =
  | { ok: true; claimId: string; amount: number }
  | { ok: false; status: number; error: string };

/**
 * The two ledger keys a claim owns, built HERE and spelled out per lane.
 *
 * A conditional and not `${lane.prefix}`, so the key table in docs/ECONOMICS.md
 * (scripts/generate-economics-doc.mjs reads every `idempotencyKey:` site) can
 * print both real shapes, and so the voice keys stay byte for byte what they
 * were before there was a second lane. A claim that already posted under the
 * old key must come back as a duplicate on a retry, never as a second debit.
 */
const debitKeyFor = (lane: ClaimLane, claimId: string) =>
  lane.id === "voice"
    ? `voice-claim-debit:${villageId()}:${claimId}`
    : `equity-claim-debit:${villageId()}:${claimId}`;
const settledKeyFor = (lane: ClaimLane, claimId: string) =>
  lane.id === "voice"
    ? `voice-claim-settled:${villageId()}:${claimId}`
    : `equity-claim-settled:${villageId()}:${claimId}`;

/**
 * Ask to carry an accrued balance to Hypha, in one lane.
 *
 * Serializable, with the member's row locked, for the same reason a gift is: a
 * balance read outside the write is a check somebody can stand between.
 */
export async function requestClaim(
  pool: Pool,
  userId: string,
  lane: ClaimLane,
  bridgeReady: boolean = BRIDGE_DISPATCH_BUILT,
): Promise<ClaimOutcome> {
  const ready = await claimReadinessFor(pool, userId, lane, bridgeReady);
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
  if (!ready.windowOpen || ready.balance <= 0 || ready.balance < ready.threshold) {
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

    // ONE open claim per member per token. Two pending proposals for one
    // person's balance would each be sized against what the other has already
    // spoken for. Re-read inside the lock: the readiness check above decides
    // what to SAY.
    const [open] = await conn.query<RowDataPacket[]>(
      "SELECT `id` FROM `voice_claims` WHERE `village_id` = ? AND `user_id` = ? AND `token_slug` = ? " +
        "AND `state` = 'requested' LIMIT 1",
      [villageId(), userId, lane.token],
    );
    if (open.length) {
      await conn.rollback();
      return { ok: false, status: 409, error: "You already have a claim waiting on Hypha." };
    }

    const [bal] = await conn.query<RowDataPacket[]>(
      "SELECT `balance` FROM `token_balances` WHERE `account_id` = ? AND `token_type` = ? FOR UPDATE",
      [memberAccount(userId), lane.token],
    );
    amountUnits = Number(bal[0]?.balance ?? 0);
    if (amountUnits <= 0 || amountUnits < toLedgerUnits(lane.token, ready.threshold)) {
      await conn.rollback();
      return { ok: false, status: 409, error: `There is less ${laneName(lane)} here than the claim needs.` };
    }

    claimId = `${lane.idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await conn.query(
      "INSERT INTO `voice_claims` (`id`, `village_id`, `user_id`, `token_slug`, `amount`, `state`, " +
        "`debit_key`, `intent_key`, `hypha_space`) VALUES (?,?,?,?,?,'requested',?,?,?)",
      [
        claimId,
        villageId(),
        userId,
        lane.token,
        fromLedgerUnits(lane.token, amountUnits),
        debitKeyFor(lane, claimId),
        lane.intentKey(villageId(), claimId),
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
      to: lane.bridge,
      tokenType: lane.token,
      // ALREADY MINOR. DO NOT CONVERT. `amountUnits` is assigned once, from
      // `SELECT balance FROM token_balances ... FOR UPDATE` above, and nothing
      // between there and here multiplies or divides it. The threshold check
      // converts the OTHER side (`toLedgerUnits(lane.token, ready.threshold)`),
      // which is the correct direction, and the INSERT writes a SEPARATE human
      // value with `fromLedgerUnits` without rebinding this one.
      //
      // Same shape as `sweepBalances` in `server/lib/exit.ts`: minor in from
      // the balance cache, minor out to the ledger. Wrapping this would take a
      // hundred times the member's voice at the two decimals Voice now carries,
      // and would be invisible at zero.
      amount: amountUnits,
      source: lane.debitSource,
      sourceRef: claimId,
      description: `${laneName(lane)} claimed toward Hypha`,
      idempotencyKey: debitKeyFor(lane, claimId),
    });
  } catch (err: any) {
    res = { ok: false, duplicate: false, error: String(err?.message ?? err) };
  }
  if (!res.ok && !res.duplicate) {
    // The row exists and the debit did not. The claim is marked rather than
    // deleted: a claim with no debit behind it is repairable, and one that
    // vanished is not even findable. `rejected` refunds, and reversing a debit
    // that never posted is a no-op, so this cannot hand back anything.
    await pool.query(
      "UPDATE `voice_claims` SET `state` = 'rejected', `settled_at` = CURRENT_TIMESTAMP, " +
        "`note` = ? WHERE `id` = ? AND `state` = 'requested'",
      ["the ledger refused the debit", claimId],
    );
    return { ok: false, status: 500, error: res.error ?? "the ledger refused the debit" };
  }
  return { ok: true, claimId, amount: fromLedgerUnits(lane.token, amountUnits) };
}

/** Ask to carry accrued voice to Hypha. The voice lane of `requestClaim`. */
export async function requestVoiceClaim(
  pool: Pool,
  userId: string,
  bridgeReady: boolean = BRIDGE_DISPATCH_BUILT,
): Promise<ClaimOutcome> {
  return requestClaim(pool, userId, VOICE_LANE, bridgeReady);
}

/**
 * End a claim, and give the balance back unless Hypha confirmed it.
 *
 * ANY LANE. The token, and therefore the bridge and the settled account, is read
 * off the stored row, so the webhook and the member's cancel need to name only
 * the claim. A row naming a token no lane carries is refused BEFORE its state
 * moves, because a claim closed with nowhere to refund it would be a balance
 * stranded by the code meant to release it.
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
export type SettleFailure = "missing" | "terminal" | "raced" | "refund-failed" | "unknown-token";

export async function settleClaim(
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
  const lane = laneForToken(String(claim.token_slug));
  if (!lane) {
    return {
      ok: false,
      reason: "unknown-token",
      error: `that claim is for "${String(claim.token_slug)}", which no claim lane in this build carries`,
    };
  }

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
     * A confirmation. The balance has settled on Hypha, so it moves OFF the
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
      from: lane.bridge,
      to: lane.settled,
      tokenType: lane.token,
      // ALREADY CONVERTED. DO NOT CONVERT AGAIN. `voice_claims.amount` is
      // `decimal(18,4)` and holds a HUMAN number, written once at the INSERT in
      // `requestClaim` as `fromLedgerUnits(lane.token, amountUnits)`.
      // This is the matching multiply, and `toLedgerUnits` reads the registry's
      // `decimals` at CALL TIME, so this line is right at 0, 3 or 4 with no
      // edit. Headroom note: `decimal(18,4)` is exact at 4 decimals and
      // silently rounds at 5, so a ruling above 4 changes the column too.
      amount: toLedgerUnits(lane.token, Number(claim.amount)),
      source: lane.settledSource,
      sourceRef: claimId,
      description: `Settled on Hypha: ${claimId}`,
      idempotencyKey: settledKeyFor(lane, claimId),
    }).catch((err: any) => ({ ok: false, duplicate: false, error: String(err?.message ?? err) }));
    if (!moved.ok && !moved.duplicate) {
      console.error(`[${lane.id} claim] ${claimId} confirmed but did not leave the bridge: ${moved.error}`);
    }
    return { ok: true, refunded: false };
  }

  const back = await reverse(pool, String(claim.debit_key), {
    from: lane.bridge,
    to: memberAccount(String(claim.user_id)),
    tokenSlug: lane.token,
    // ALREADY CONVERTED, and it is an ASSERTION rather than an instruction.
    // `reverse` never posts this number: it reads the original row out of
    // `token_ledger` and mirrors THAT (see `reverse` in `server/lib/economy.ts`,
    // which says so on the line). This value is compared against the row's
    // minor amount, so it has to be minor, and converting it a second time
    // would turn every correct refund into a loud mismatch.
    //
    // Keep the assertion. It is the one place a registry flip done without
    // rescaling `token_ledger` surfaces as a failure somebody can read,
    // instead of a refund that silently moves the wrong amount.
    amount: toLedgerUnits(lane.token, Number(claim.amount)),
    note: note ?? `${laneName(lane)} returned: ${to}`,
  });
  if (!back.ok) {
    // The claim is terminal and the balance is still at the bridge. Re-entering
    // through this function cannot fix it, because `canSettleClaim` refuses
    // every transition out of a terminal state: that is what `retryRefund`
    // below is for, and the note is written so a human reading the row knows
    // the money is still here.
    await pool
      .query("UPDATE `voice_claims` SET `note` = ? WHERE `id` = ? AND `village_id` = ?", [
        `refund failed, ${lane.id} still held: ${String(back.error).slice(0, 200)}`,
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
 * The name every caller already used, from when voice was the only lane. It
 * settles a claim in ANY lane, because the lane comes off the row: the Hypha
 * receiver and the member's cancel route both reach earned equity through it.
 */
export const settleVoiceClaim = settleClaim;

/**
 * Give back a balance that a refunding claim closed over without releasing.
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
  const lane = laneForToken(String(claim.token_slug));
  if (!lane) return { ok: false, error: `no claim lane carries "${String(claim.token_slug)}"` };
  const state = String(claim.state) as ClaimState;
  if (!claimRefunds(state)) {
    return { ok: false, error: `a ${state} claim is not owed a refund` };
  }
  const back = await reverse(pool, String(claim.debit_key), {
    from: lane.bridge,
    to: memberAccount(String(claim.user_id)),
    tokenSlug: lane.token,
    // ALREADY CONVERTED, and an ASSERTION, exactly as in `settleClaim`
    // above. Worth knowing for the runbook: this is the repair path for the
    // failure that assertion produces, and it fails in the same place for the
    // same reason. The repair tool does not repair a units mismatch.
    amount: toLedgerUnits(lane.token, Number(claim.amount)),
    note: `${laneName(lane)} returned on repair: ${state}`,
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
 *
 * UNITS, and this one is a trap that has not been sprung yet. `held`, `owed`
 * and `drift` are all MINOR UNITS, while every other export in this file
 * returns human numbers. Nothing renders them today, so nothing is wrong; the
 * first admin panel, poller or alert threshold that reads `drift` will be
 * comparing a minor number against a human one. A threshold written as "alert
 * above 1" would fire on one ten-thousandth of a voice. Whoever gives this a
 * caller either renames the three fields to say `Units`, or divides all three
 * with `fromLedgerUnits` and moves the test's `toLedgerUnits` wrappers off.
 *
 * `owed` also rounds ONCE over the SQL sum while `held` is the sum of
 * individually rounded postings. At `decimal(18,4)` storage and decimals 4
 * every term is exact and the two agree. At 5 they diverge and `drift`
 * reports a number nothing did wrong.
 *
 * PER LANE, and the token filter on the claims is the whole of that. Without it
 * an open equity claim would count as voice the voice bridge owes, and the
 * check would report a drift in the one place nothing went wrong.
 */
export async function bridgeReconciliation(
  pool: Pool,
  lane: ClaimLane = VOICE_LANE,
): Promise<{ held: number; owed: number; drift: number; openClaims: number }> {
  const [balRows] = await pool.query<RowDataPacket[]>(
    "SELECT `balance` FROM `token_balances` WHERE `account_id` = ? AND `token_type` = ?",
    [lane.bridge, lane.token],
  );
  const held = Number(balRows[0]?.balance ?? 0);

  const [openRows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n, COALESCE(SUM(`amount`),0) AS total FROM `voice_claims` " +
      "WHERE `village_id` = ? AND `token_slug` = ? AND `state` = 'requested'",
    [villageId(), lane.token],
  );
  const owed = toLedgerUnits(lane.token, Number(openRows[0]?.total ?? 0));
  return { held, owed, drift: held - owed, openClaims: Number(openRows[0]?.n ?? 0) };
}

/** Every claim a member has made in one lane, newest first. For the profile. */
export async function claimHistory(pool: Pool, userId: string, limit = 20, lane: ClaimLane = VOICE_LANE) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `amount`, `state`, `hypha_ref`, `created_at`, `settled_at`, `note` " +
      "FROM `voice_claims` WHERE `village_id` = ? AND `user_id` = ? AND `token_slug` = ? " +
      "ORDER BY `created_at` DESC LIMIT ?",
    [villageId(), userId, lane.token, Math.min(100, Math.max(1, limit))],
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
