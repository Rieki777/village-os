/**
 * A CIRCLE'S TREASURY: REAL TOKENS, IN A REAL ACCOUNT, UNDER THE LEDGER'S OWN
 * RULES.
 *
 * `server/lib/circleBurn.ts` is the meter for the CAP model, which holds
 * nothing and derives everything. This file is the other model Rye ruled for,
 * where a village mints a circle a treasury up front and the circle keeps
 * whatever it does not spend.
 *
 * ── CONSERVATION SURVIVES THIS, AND THAT IS THE FIRST REQUIREMENT ──────────
 *
 * Per token, SUM(balance) over all accounts is identically zero, checked at
 * boot with a loud failure (`checkLedgerInvariants`). Nothing here writes a
 * ledger row: every movement goes through `postTransfer`, which recomputes
 * `token_balances` from `token_ledger` inside the same transaction. There is
 * no increment anywhere in this file and no INSERT into either table.
 *
 * A funding is `sys:mint` to the circle. A spend is the circle to a member. A
 * return is the circle back to `sys:mint`. Three postings, all through the one
 * primitive, all conserving by construction.
 *
 * ── WHAT HAPPENS WHEN A CIRCLE GOES DORMANT. RYE RULED IT ──────────────────
 *
 * "If a circle goes dormant the treasury is destroyed or sent back to a master
 * treasury (if there is one). To be reissued if that circle comes alive
 * again."
 *
 * So a dormant circle HOLDS NOTHING. `sweepDormantCircle` runs the instant the
 * status changes, empties every treasury the circle holds, and writes down
 * what left and where it went. That is the answer to the objection a design
 * pass raised against a per-circle account at all: `sys:` accounts are never
 * auto-created, circles can go dormant, and the member exit sweep touches only
 * `memberAccount(userId)`, so a circle account looked like somewhere value
 * could accumulate and never leave, the way `sys:event-escrow` does. It cannot
 * accumulate here, because the one state in which nobody is watching the
 * account is the state in which it is emptied.
 *
 * ── THE TWO DESTINATIONS, AND WHICH ONE SHIPS IS MEASURED ──────────────────
 *
 * MEASURED, not assumed: `sys:treasury` exists in every village, created by
 * `drizzle/0009_ledger_accounts_and_transfers.sql`, labelled "Treasury",
 * non-faucet. That is the master treasury, so it is where a dormant circle's
 * tokens go, and `masterTreasuryExists` reads `ledger_accounts` at the moment
 * of the sweep instead of trusting this paragraph.
 *
 * A village without that row destroys them instead, through `sys:redeemed`,
 * which is the account `postBurn` in server/lib/redemptionStore.ts already
 * burns to and the one `retiredSupply` reads. Destroyed therefore means
 * destroyed, and the retired figure the admin panel prints beside issuance
 * accounts for it with no second counter anywhere.
 *
 * A CONSEQUENCE THE VILLAGE SHOULD KNOW ABOUT, reported and not hidden:
 * `sys:treasury` is also the account the exchange sells from. `treasuryStock`
 * in server/lib/exchange.ts reads its raw balance, so tokens returned from a
 * dormant circle become stock the shop can sell unless the village decides
 * otherwise. Nothing here changes that, and nothing here invents a second
 * treasury to avoid it: this lane was told to measure whether a master
 * treasury exists and to use it, and a separate holding account is a decision
 * for Rye.
 *
 * ── REISSUING IS A NEW MINT, AND IT CAN BE REFUSED ─────────────────────────
 *
 * "To be reissued if that circle comes alive again" means a NEW funding, which
 * leaves `sys:mint`, which meets `mintCapGuard`. So a circle waking in a month
 * whose issuance is already spent CANNOT be refunded that period. That is not
 * a bug and it is not softened; it is said out loud by `revivalNote` on the
 * surface a steward meets when they set a circle active again, along with what
 * the circle held when it went dormant, because giving a circle back what it
 * had is a different act from funding it afresh.
 *
 * ── FUNDING IS ISSUANCE AND SPENDING IS NOT ────────────────────────────────
 *
 * A funding leaves `sys:mint`, so it creates tokens, so `mintCapGuard` binds
 * it exactly as it binds a hand-mint. Twelve circle treasuries spend the
 * village's issuance for that cycle, all at once, which is the point: it turns
 * a race between circles into one budget decision the village makes on
 * purpose.
 *
 * A spend leaves the CIRCLE'S account. Those tokens already exist. It touches
 * `sys:mint` on neither leg, so `readCycleIssuance`, whose whole WHERE clause
 * is `from_account = sys:mint OR to_account = sys:mint`, cannot see it. The
 * village-wide cap does not move when a circle spends, and that is asserted
 * rather than asserted-about.
 *
 * ── THE ATTRIBUTION KEY IS ITS OWN, AND THE REASON IS A BOUNDARY BUG ───────
 *
 * `circleSpendRef` (`circle:<id>`) is the CAP meter's key: rows carrying it
 * that leave a faucet are counted as issuance the circle made against its cap.
 * A treasury funding also leaves a faucet, so reusing that key would put
 * funding rows inside the cap meter's sums.
 *
 * That is not merely untidy, it is wrong at a boundary, and the boundary is
 * reachable by default. A mode change lands on the SEASON boundary, while the
 * cap meter's cycle window is a LUNATION, and the two coincide by accident and
 * never by construction. A circle funded on the 25th of August under a
 * treasury, moved to a cap when the season turns on 1 September, would have
 * that August funding row sitting inside the cycle window that straddles the
 * turn, counted against a cap it was never issued under. So the treasury takes
 * `circle-treasury:<id>` and the two namespaces never meet.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { CIRCLE_STATUSES, type CircleStatus } from "../../shared/draftKinds";
import { MAX_SOURCE_REF, fromLedgerUnits } from "./economy";
import { MINT_FAUCET, TREASURY, memberAccount, postTransfer, tokenDef } from "./ledger";
import { REDEEMED } from "./redemption";
import { mintCapGuard } from "./mintCap";
import {
  modeAt,
  treasuryTotalState,
  type BudgetMode,
  type PendingModeChange,
  type TreasuryTotal,
} from "../../shared/circleTreasury";

// ── The account, and the only place one is ever created ─────────────────────

/**
 * Where a circle's tokens live. Eleven characters, and the width is checked.
 *
 * `ledger_accounts.id` is varchar(80) (0009) and `circles.id` is varchar(64),
 * so the worst case is 11 + 64 = 75 with five to spare. Measured rather than
 * assumed, because MariaDB here runs STRICT_TRANS_TABLES and an over-width id
 * is a LOST ROW instead of a truncated one.
 */
export const CIRCLE_TREASURY_PREFIX = "sys:circle:";

/** `ledger_accounts.id` is varchar(80). Named once so the check cannot drift. */
export const MAX_ACCOUNT_ID = 80;

/** Where a treasury movement is attributed. See the header for why it is not `circle:`. */
export const TREASURY_REF_PREFIX = "circle-treasury:";

/** The three sources a treasury writes. Auditable, and distinct on purpose. */
export const TREASURY_FUND_SOURCE = "circle_treasury_fund";
export const TREASURY_SPEND_SOURCE = "circle_treasury_spend";
export const TREASURY_RETURN_SOURCE = "circle_treasury_return";

/** Why this circle cannot hold a treasury account, in words, or null. */
export function treasuryAccountProblem(circleId: string): string | null {
  const id = String(circleId ?? "");
  if (!id.trim()) return "a treasury has to belong to a circle";
  const width = CIRCLE_TREASURY_PREFIX.length + id.length;
  if (width > MAX_ACCOUNT_ID) {
    return (
      `a treasury for circle ${JSON.stringify(id.slice(0, 40))} needs ${width} characters of ` +
      `account id and ledger_accounts holds ${MAX_ACCOUNT_ID}. The account would be refused ` +
      "by strict MySQL and the tokens would have nowhere to go"
    );
  }
  const refWidth = TREASURY_REF_PREFIX.length + id.length;
  if (refWidth > MAX_SOURCE_REF) {
    return (
      `attributing a treasury movement to circle ${JSON.stringify(id.slice(0, 40))} needs ` +
      `${refWidth} characters of source_ref and the ledger column holds ${MAX_SOURCE_REF}`
    );
  }
  return null;
}

/** The one spelling of a circle's treasury account. Throws before it truncates. */
export function circleTreasuryAccount(circleId: string): string {
  const problem = treasuryAccountProblem(circleId);
  if (problem) throw new Error(problem);
  return `${CIRCLE_TREASURY_PREFIX}${circleId}`;
}

/** The circle an account belongs to, or null when it belongs to none. */
export function circleIdFromTreasuryAccount(accountId: string | null | undefined): string | null {
  const raw = String(accountId ?? "");
  if (!raw.startsWith(CIRCLE_TREASURY_PREFIX)) return null;
  const id = raw.slice(CIRCLE_TREASURY_PREFIX.length);
  return id.length > 0 ? id : null;
}

/** The one spelling of a treasury movement's attribution key. */
export function treasuryRef(circleId: string): string {
  const problem = treasuryAccountProblem(circleId);
  if (problem) throw new Error(problem);
  return `${TREASURY_REF_PREFIX}${circleId}`;
}

/**
 * THE ONE PLACE A CIRCLE ACCOUNT IS EVER CREATED, AND IT IS EXPLICIT.
 *
 * `postTransferOn` creates `mem:` accounts and refuses to post to any other
 * account that does not exist, which is the rule this respects instead of
 * bending. A treasury account is written here, by name, in its own statement,
 * before the posting that needs it, and only from `fundTreasury`. Creating one
 * costs nothing and holds nothing: an account with no rows has a balance of
 * zero and is invisible to every sum in the system.
 *
 * `INSERT IGNORE`, so a second funding finds the row it made the first time.
 * `faucet` is 0: a treasury holds tokens somebody else issued and may never
 * issue any of its own, which is also what keeps it inside the overdraft rule.
 */
export async function ensureTreasuryAccount(
  conn: Pool | PoolConnection,
  circleId: string,
  label: string,
): Promise<string> {
  const account = circleTreasuryAccount(circleId);
  await conn.query( // module-review-ok: the ledger's own INSERT IGNORE for an account, copied from postTransferOn in server/lib/ledger.ts so both creators write the row the same way; server/repos holds no reader for ledger_accounts
    "INSERT IGNORE INTO ledger_accounts (id, kind, user_id, label, faucet) VALUES (?,?,?,?,0)",
    [account, "circle", null, String(label || circleId).slice(0, 120)],
  );
  return account;
}

// ── The permission seam ─────────────────────────────────────────────────────

/** The four things somebody can do to a circle's money. */
export type TreasuryAction = "set_mode" | "fund" | "spend" | "return";

/**
 * WHO MAY DO THIS. A CHECK THIS FILE CALLS, NEVER A RULE IT HOLDS.
 *
 * A village-wide treasury badge and a circle-scoped treasury role are a
 * separate lane's work and are held pending a ruling. Nothing here decides
 * who: every operation below takes one of these, calls it first, and refuses
 * with whatever sentence it returns.
 *
 * The signature is the seam:
 *
 *     (action: TreasuryAction, circleId: string) => Promise<string | null> | string | null
 *
 * Null means allowed. A string is the refusal a person reads, and it comes
 * from the permission model, so a lane that later replaces
 * the declare gate with a badge check changes `permitFor` in one route module
 * and nothing in this file moves.
 *
 * It is REQUIRED rather than optional. An optional permit is a default of
 * "everybody", and a default of everybody is a permission model written by
 * omission.
 */
export type TreasuryPermit = (
  action: TreasuryAction,
  circleId: string,
) => Promise<string | null> | string | null;

// ── What a treasury holds ───────────────────────────────────────────────────

export interface TreasuryHoldings {
  /** The account. Named so an auditor has somewhere to look. */
  account: string;
  /** `token_balances.balance`, minor units. Recomputed, never incremented. */
  balanceMinor: number;
  /** Everything ever minted into it, minor. */
  fundedMinor: number;
  /** Everything ever spent out of it, minor. */
  spentMinor: number;
  /** Everything ever handed back to the faucet, minor. */
  returnedMinor: number;
  /** How many rows the account has ever carried. Zero is a fact worth having. */
  rows: number;
}

/**
 * One round trip. Balance from the cache, the three flows from the ledger.
 *
 * THE BALANCE IS READ FROM `token_balances` AND THE FLOWS FROM `token_ledger`,
 * on purpose. The cache is what conservation is checked against and what every
 * other surface prints, so a treasury that disagreed with it would be a second
 * opinion about the same money. The flows are history and have no cache.
 *
 * THE FLOWS ARE NOT WINDOWED. A treasury does not reset, so "since the window
 * began" would be the wrong question: what a circle has spent of what it was
 * given is a fact about the whole life of the treasury.
 */
export async function treasuryHoldings(
  conn: Pool | PoolConnection,
  circleId: string,
  tokenType: string,
): Promise<TreasuryHoldings> {
  const problem = treasuryAccountProblem(circleId);
  if (problem) throw new Error(problem);
  const account = circleTreasuryAccount(circleId);

  const [balRows] = await conn.query<RowDataPacket[]>( // module-review-ok: an aggregate read over the ledger's own tables; server/repos holds no reader for token_ledger or token_balances and a repo would be a second cache above the one conservation is checked against
    "SELECT balance FROM token_balances WHERE account_id = ? AND token_type = ?",
    [account, tokenType],
  );
  const [flowRows] = await conn.query<RowDataPacket[]>( // module-review-ok: an aggregate read over the ledger's own tables; server/repos holds no reader for token_ledger or token_balances and a repo would be a second cache above the one conservation is checked against
    `SELECT
       COALESCE(SUM(CASE WHEN to_account = ? AND from_account = ? THEN amount ELSE 0 END), 0) AS funded,
       COALESCE(SUM(CASE WHEN from_account = ? AND to_account <> ? THEN amount ELSE 0 END), 0) AS spent,
       COALESCE(SUM(CASE WHEN from_account = ? AND to_account = ? THEN amount ELSE 0 END), 0) AS returned,
       COUNT(*) AS n
     FROM token_ledger
     WHERE token_type = ? AND (from_account = ? OR to_account = ?)`,
    [
      account, MINT_FAUCET,
      account, MINT_FAUCET,
      account, MINT_FAUCET,
      tokenType, account, account,
    ],
  );
  const f = (flowRows as any[])[0] ?? {};
  return {
    account,
    balanceMinor: Number((balRows as any[])[0]?.balance ?? 0),
    fundedMinor: Number(f.funded ?? 0),
    spentMinor: Number(f.spent ?? 0),
    returnedMinor: Number(f.returned ?? 0),
    rows: Number(f.n ?? 0),
  };
}

// ── The three movements ─────────────────────────────────────────────────────

export interface TreasuryMoveResult {
  ok: boolean;
  /** The refusal, verbatim from whichever gate produced it. */
  error?: string;
  /** True when this exact movement was already on the books. */
  duplicate?: boolean;
  /** The treasury's balance after, minor units. Only on success. */
  balanceMinor?: number;
}

export interface FundTreasuryInput {
  circleId: string;
  /** The circle's own name, for the account label. */
  circleName: string;
  circleStatus: CircleStatus;
  tokenSlug: string;
  /** MINOR units. The caller converts; this file never guesses a scale. */
  amountMinor: number;
  /** Who asked, for the audit row. */
  actorId: string | null;
  /** The village's own words for why. */
  note: string;
  /** Unique per funding decision. A retry with the same one moves nothing twice. */
  idempotencyKey: string;
  permit: TreasuryPermit;
}

/**
 * MINT INTO A CIRCLE'S TREASURY. THIS IS ISSUANCE AND THE VILLAGE CAP BINDS.
 *
 * `mintCapGuard` runs inside the transfer's own transaction, after `sys:mint`
 * and the destination are locked FOR UPDATE, so two stewards funding two
 * circles at the same instant serialise on the faucet row and the second one
 * counts the first one's committed tokens. Funding eleven circles when ten
 * have used the room is refused by the same arithmetic that refuses an
 * eleventh hand-mint, and the refusal is the cap's own sentence.
 */
export async function fundTreasury(
  pool: Pool,
  input: FundTreasuryInput,
): Promise<TreasuryMoveResult> {
  const problem = treasuryAccountProblem(input.circleId);
  if (problem) return { ok: false, error: problem };

  const refused = await input.permit("fund", input.circleId);
  if (refused) return { ok: false, error: refused };

  /*
   * A DORMANT CIRCLE IS NOT FUNDED, AND THE REASON IS NOW MECHANICAL RATHER
   * THAN PRUDENT. Going dormant EMPTIES the treasury, so a funding landing
   * afterwards would put tokens into an account the sweep has already passed
   * over, and they would sit there until somebody noticed. Setting the circle
   * active first is the whole fix, and the refusal says so.
   */
  if (input.circleStatus === "dormant") {
    return {
      ok: false,
      error:
        "This circle is dormant and its treasury was swept when it went dormant. Set the " +
        "circle active first, then fund it: reviving a circle takes a new mint, and a new " +
        "mint meets the village's issuance cap for this cycle",
    };
  }

  const def = tokenDef(input.tokenSlug);
  if (!def) return { ok: false, error: `unknown token "${input.tokenSlug}"` };
  if (def.governance !== "platform") {
    return { ok: false, error: `${input.tokenSlug} is issued on Hypha and cannot be minted here` };
  }
  const units = Math.trunc(Number(input.amountMinor) || 0);
  if (units <= 0) return { ok: false, error: "A funding is a positive number of minor units" };

  // The account, by name, before the posting that needs it. See the header.
  await ensureTreasuryAccount(pool, input.circleId, input.circleName);

  const r = await postTransfer(
    pool,
    {
      from: MINT_FAUCET,
      to: circleTreasuryAccount(input.circleId),
      tokenType: input.tokenSlug,
      amount: units,
      source: TREASURY_FUND_SOURCE,
      sourceRef: treasuryRef(input.circleId),
      description: String(input.note ?? "").trim().slice(0, 500),
      idempotencyKey: input.idempotencyKey,
    },
    mintCapGuard(input.tokenSlug, units),
  );
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, duplicate: r.duplicate, balanceMinor: r.toBalance };
}

export interface SpendTreasuryInput {
  circleId: string;
  circleStatus: CircleStatus;
  tokenSlug: string;
  /** Who is being paid. A member id, never an account id. */
  toUserId: string;
  amountMinor: number;
  actorId: string | null;
  note: string;
  idempotencyKey: string;
  permit: TreasuryPermit;
}

/**
 * SPEND WHAT THE CIRCLE ALREADY HAS. THIS IS NOT ISSUANCE.
 *
 * No guard, because there is nothing to guard: the tokens exist, and the
 * ledger's own overdraft rule refuses a spend larger than the balance, since a
 * treasury account is not a faucet. `mintCapGuard` is deliberately absent and
 * `readCycleIssuance` cannot see this row, because neither leg touches
 * `sys:mint`.
 */
export async function spendTreasury(
  pool: Pool,
  input: SpendTreasuryInput,
): Promise<TreasuryMoveResult> {
  const problem = treasuryAccountProblem(input.circleId);
  if (problem) return { ok: false, error: problem };

  const refused = await input.permit("spend", input.circleId);
  if (refused) return { ok: false, error: refused };

  if (input.circleStatus === "dormant") {
    return {
      ok: false,
      error:
        // "is not spending. Its" trips check-voice's contrast frame, because
      // `it'?s` in that rule also matches the possessive "Its". Worded around
      // it rather than waived: the sentence reads the same either way.
      "This circle is dormant, so it has stopped spending. The treasury was emptied when " +
        "the circle went dormant, and reviving it takes a fresh funding",
    };
  }

  const units = Math.trunc(Number(input.amountMinor) || 0);
  if (units <= 0) return { ok: false, error: "A spend is a positive number of minor units" };
  if (!String(input.toUserId ?? "").trim()) return { ok: false, error: "A spend names who is paid" };

  const r = await postTransfer(pool, {
    from: circleTreasuryAccount(input.circleId),
    to: memberAccount(String(input.toUserId)),
    tokenType: input.tokenSlug,
    amount: units,
    source: TREASURY_SPEND_SOURCE,
    sourceRef: treasuryRef(input.circleId),
    description: String(input.note ?? "").trim().slice(0, 500),
    idempotencyKey: input.idempotencyKey,
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, duplicate: r.duplicate };
}

export interface ReturnTreasuryInput {
  circleId: string;
  tokenSlug: string;
  amountMinor: number;
  actorId: string | null;
  note: string;
  idempotencyKey: string;
  permit: TreasuryPermit;
}

/**
 * HAND A TREASURY BACK WHILE THE CIRCLE IS STILL AWAKE.
 *
 * The dormancy case is handled by `sweepDormantCircle` and goes to the master
 * treasury or to retirement, per Rye's ruling. This is the other direction: a
 * live circle deciding it does not need what it holds, or a village taking
 * back an over-funding before the season ends.
 *
 * IT GOES TO THE MINT FAUCET AND NOT TO THE MASTER TREASURY, which is the
 * difference from the sweep and it is deliberate. An awake circle handing back
 * an over-funding is undoing an issuance the village made this cycle, so the
 * room should come back with the tokens. A dormant circle's sweep is not an
 * undo: the circle had that treasury, the season happened, and the village is
 * taking custody of what is left.
 *
 * There is no `circleStatus` check here on purpose, so a circle that somehow
 * still holds tokens while dormant has a lever anybody can pull.
 *
 * The tokens go back to `sys:mint`, so they land on the RETURN leg of
 * `readCycleIssuance` inside whatever cycle this posting falls in, and the
 * village gets its issuance room back with them. That is the same subtraction
 * a member spending stay credits already produces, and it has a floor of zero
 * for the same stated reason: a return can cancel issuance this cycle made and
 * can never manufacture room the cycle did not have.
 */
export async function returnTreasury(
  pool: Pool,
  input: ReturnTreasuryInput,
): Promise<TreasuryMoveResult> {
  const problem = treasuryAccountProblem(input.circleId);
  if (problem) return { ok: false, error: problem };

  const refused = await input.permit("return", input.circleId);
  if (refused) return { ok: false, error: refused };

  const units = Math.trunc(Number(input.amountMinor) || 0);
  if (units <= 0) return { ok: false, error: "A return is a positive number of minor units" };

  const r = await postTransfer(pool, {
    from: circleTreasuryAccount(input.circleId),
    to: MINT_FAUCET,
    tokenType: input.tokenSlug,
    amount: units,
    source: TREASURY_RETURN_SOURCE,
    sourceRef: treasuryRef(input.circleId),
    description: String(input.note ?? "").trim().slice(0, 500),
    idempotencyKey: input.idempotencyKey,
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, duplicate: r.duplicate };
}

// ── Dormancy: a circle that stops holds nothing ─────────────────────────────

/** The source every dormancy sweep writes. One word, auditable. */
export const DORMANCY_SOURCE = "circle_treasury_dormant";

/** Where a dormant circle's tokens went. Recorded on the row, never inferred. */
export type DormancyDestination = "master_treasury" | "retired";

/**
 * DOES THIS VILLAGE HAVE A MASTER TREASURY? MEASURED AT THE SWEEP.
 *
 * `sys:treasury` is created by `drizzle/0009_ledger_accounts_and_transfers.sql`
 * in every village, so this returns true everywhere today. It is a query and
 * not a constant because Rye's ruling is conditional ("if there is one") and a
 * fork that dropped or never ran that row would otherwise have its dormant
 * circles' tokens posted to an account that does not exist, which
 * `postTransferOn` refuses with `account "sys:treasury" does not exist` and
 * which would leave the sweep failing at the moment nobody is watching.
 */
export async function masterTreasuryExists(conn: Pool | PoolConnection): Promise<boolean> {
  const [rows] = await conn.query<RowDataPacket[]>( // module-review-ok: an aggregate read over the ledger's own tables; server/repos holds no reader for token_ledger or token_balances and a repo would be a second cache above the one conservation is checked against
    "SELECT id FROM ledger_accounts WHERE id = ? LIMIT 1",
    [TREASURY],
  );
  return (rows as any[]).length > 0;
}

export interface DormancySweep {
  circleId: string;
  budgetId: string;
  tokenSlug: string;
  /** What left the circle's account. Zero when it held nothing. */
  movedMinor: number;
  destination: DormancyDestination;
  /** True when this exact sweep was already on the books. */
  duplicate: boolean;
  /** The ledger's own refusal, when the posting did not go through. */
  error?: string;
}

/**
 * EMPTY EVERY TREASURY A CIRCLE HOLDS, BECAUSE IT HAS GONE DORMANT.
 *
 * Rye's ruling, carried out. The destination is measured once for the whole
 * sweep, the posting goes through `postTransfer` like every other movement in
 * this file, and the amount that left is written onto the budget row so a
 * steward reviving the circle can be told what it had.
 *
 * ── THE KEY, AND THE ONE COLLISION IT CANNOT TELL FROM A RETRY ─────────────
 *
 * A circle can go dormant, be revived, be funded again and go dormant again,
 * and each of those is a real sweep of a different balance. Keying on the
 * circle alone would make the second sweep a duplicate and silently leave the
 * tokens in the account, which is the stranding this whole file exists to
 * prevent, arriving through the idempotency key.
 *
 * So the key carries the circle, the token, the DAY and the AMOUNT. A retried
 * status write repeats all four and posts once, which is the case that
 * actually happens. A second dormancy on a later day, or on the same day with
 * a different balance, differs and posts.
 *
 * WHAT IS LEFT, STATED RATHER THAN HIDDEN: a circle that goes dormant, is
 * revived, is funded to EXACTLY the same amount and goes dormant again ON THE
 * SAME DAY writes one row and leaves the second balance in the account. That
 * case is indistinguishable from a retry by anything the ledger records, and
 * it is why `dormantHoldings` exists and is reported by name: the net catches
 * what the key cannot.
 *
 * Width: 24 + 40 + 1 + 31 + 1 + 10 + 1 + 20 is 128 against the 160
 * `token_ledger.idempotency_key` holds, so the circle id is clipped at 40 the
 * way every other composite key here clips.
 *
 * ── A ZERO BALANCE IS NOT A FAILURE AND WRITES NO ROW ──────────────────────
 *
 * `postTransfer` refuses an amount of zero, correctly. A circle holding
 * nothing when it goes dormant is the ordinary case, so it is answered without
 * a posting and still writes the record, because "went dormant holding
 * nothing" is a fact a steward reviving the circle needs as much as any other.
 */
export async function sweepDormantCircle(
  pool: Pool,
  input: {
    circleId: string;
    budgets: ReadonlyArray<{ id: string; unit: string }>;
    tokenTypeFor: (unit: string) => string | null;
    at?: Date;
    actorId: string | null;
  },
): Promise<DormancySweep[]> {
  if (treasuryAccountProblem(input.circleId)) return [];
  const at = input.at ?? new Date();
  const destination: DormancyDestination = (await masterTreasuryExists(pool))
    ? "master_treasury"
    : "retired";
  const to = destination === "master_treasury" ? TREASURY : REDEEMED;
  const day = at.toISOString().slice(0, 10);

  const out: DormancySweep[] = [];
  for (const b of input.budgets) {
    const tokenSlug = input.tokenTypeFor(b.unit);
    if (!tokenSlug) continue;
    const held = await treasuryHoldings(pool, input.circleId, tokenSlug);
    let duplicate = false;
    let error: string | undefined;

    if (held.balanceMinor > 0) {
      const r = await postTransfer(pool, {
        from: held.account,
        to,
        tokenType: tokenSlug,
        amount: held.balanceMinor,
        source: DORMANCY_SOURCE,
        sourceRef: treasuryRef(input.circleId),
        description:
          destination === "master_treasury"
            ? "Circle went dormant: treasury returned to the village"
            : "Circle went dormant: treasury retired",
        idempotencyKey:
          `circle_treasury:dormant:${input.circleId.slice(0, 40)}:${tokenSlug}:${day}:${held.balanceMinor}`,
      });
      duplicate = !!r.duplicate;
      if (!r.ok) error = r.error;
    }

    if (!error) {
      await pool.query( // module-review-ok: circle_budgets is one of the resources module's three declaration tables, whose one enumerable home is this SQL (the structureRead pattern server/lib/resources.ts records); no cache sits above it
        "UPDATE circle_budgets SET dormant_held_minor = ?, dormant_at = ?, dormant_to = ? WHERE id = ?",
        [held.balanceMinor, at, destination, b.id],
      );
    }
    out.push({
      circleId: input.circleId,
      budgetId: b.id,
      tokenSlug,
      movedMinor: error ? 0 : held.balanceMinor,
      destination,
      duplicate,
      ...(error ? { error } : {}),
    });
  }
  return out;
}

/**
 * WHAT A STEWARD IS TOLD WHEN THEY BRING A CIRCLE BACK.
 *
 * Two facts, and the second one is the sharp edge. What the circle held when
 * it went dormant, so the steward can give it back what it had instead of
 * guessing. And that giving it back is a NEW MINT, which meets the village's
 * issuance cap for the cycle it happens in, so a circle waking in a month
 * whose room is already spent cannot be refunded until the next one.
 *
 * A circle that went dormant holding nothing gets the second half only. A
 * circle that never had a treasury gets nothing at all, because there is
 * nothing to say and a sentence about reissuing would invent a history.
 */
export function revivalNote(
  record: { heldMinor: number | null; at: string | null; destination: string | null },
  tokenSlug: string,
  circleName: string,
): string | null {
  if (!record.at) return null;
  const where = record.destination === "retired"
    ? "retired, so those tokens no longer exist"
    : "returned to the village treasury";
  const held = Number(record.heldMinor ?? 0);
  const had = held > 0
    ? `${circleName} held ${fromLedgerUnits(tokenSlug, held)} ${tokenSlug} when it went dormant on ` +
      `${record.at.slice(0, 10)}, and it was ${where}. `
    : `${circleName} held nothing when it went dormant on ${record.at.slice(0, 10)}. `;
  return (
    had +
    "Giving it a treasury again is a new mint, so it meets this village's issuance cap for " +
    "the cycle it happens in. A cycle whose room is already spent cannot fund it until the " +
    "next one."
  );
}

// ── What the room went on, when there is none left ──────────────────────────

export interface CircleFunding {
  circleId: string;
  fundedMinor: number;
}

/**
 * WHICH CIRCLES SPENT THE VILLAGE'S ISSUANCE THIS CYCLE.
 *
 * `capRefusal` names the DOORS that used the room, because the cap bounds
 * every door and the issuance that used it up was often nobody in the room.
 * That sentence stops one question short here. A founder funding an eleventh
 * circle treasury and being refused already knows the door: it was this one,
 * ten times. What they cannot see is WHICH TEN, and without it the refusal
 * sends them to read a ledger.
 *
 * So this reads the same window the guard reads, off the same rows, and
 * attributes them by `source_ref`, which is `circle-treasury:<id>` on every
 * funding this module has ever posted. Nothing here is a second counter: the
 * total the cap enforces is still `readCycleIssuance`'s, and this only says
 * how it was distributed.
 *
 * Returns to the faucet are subtracted per circle and floored at zero, for the
 * reason `mintCap.ts` records: a return can cancel issuance this window made
 * and can never manufacture room the window did not have.
 */
export async function circleFundingSince(
  conn: Pool | PoolConnection,
  tokenSlug: string,
  since: Date,
): Promise<CircleFunding[]> {
  const [rows] = await conn.query<RowDataPacket[]>( // module-review-ok: an aggregate read over the ledger's own tables; server/repos holds no reader for token_ledger or token_balances and a repo would be a second cache above the one conservation is checked against
    `SELECT source_ref,
       COALESCE(SUM(CASE WHEN from_account = ? THEN amount ELSE 0 END), 0) AS funded,
       COALESCE(SUM(CASE WHEN to_account = ? THEN amount ELSE 0 END), 0) AS returned
     FROM token_ledger
     WHERE token_type = ? AND at >= ? AND source_ref LIKE ?
       AND (from_account = ? OR to_account = ?)
     GROUP BY source_ref`,
    [MINT_FAUCET, MINT_FAUCET, tokenSlug, since, `${TREASURY_REF_PREFIX}%`, MINT_FAUCET, MINT_FAUCET],
  );
  const out: CircleFunding[] = [];
  for (const r of rows as any[]) {
    const circleId = String(r.source_ref ?? "").slice(TREASURY_REF_PREFIX.length);
    if (!circleId) continue;
    const net = Math.max(0, Number(r.funded ?? 0) - Number(r.returned ?? 0));
    if (net <= 0) continue;
    out.push({ circleId, fundedMinor: net });
  }
  return out.sort((a, b) => b.fundedMinor - a.fundedMinor || a.circleId.localeCompare(b.circleId));
}

/**
 * The clause a founder reads under the cap's own refusal, or an empty string.
 *
 * Empty when no treasury took any of this lunation's room, because a sentence
 * that said "0 went to circle treasuries" would be noise on a refusal a
 * steward is trying to act on.
 */
export function circleFundingClause(
  funding: readonly CircleFunding[],
  tokenSlug: string,
  circleName: (id: string) => string,
): string {
  if (funding.length === 0) return "";
  const total = funding.reduce((n, f) => n + f.fundedMinor, 0);
  const shown = funding.slice(0, 4);
  const named = shown
    .map((f) => `${circleName(f.circleId)} ${fromLedgerUnits(tokenSlug, f.fundedMinor)}`)
    .join(", ");
  const rest = funding.length > shown.length
    ? ` and ${funding.length - shown.length} more circles`
    : "";
  /*
   * THE LEADING FULL STOP IS LOAD BEARING. `capRefusal` ends without
   * punctuation in both of its shapes, so a clause beginning with a space read
   * as "already issued this lunation Of this lunation's issuance" in the first
   * end-to-end drive. Measured off the captured refusal, not reasoned about.
   */
  return (
    `. Of this lunation's issuance, ${fromLedgerUnits(tokenSlug, total)} went into circle ` +
    `treasuries: ${named}${rest}. Funding a treasury mints tokens, so every circle funded ` +
    "this cycle drew on the same room."
  );
}

// ── The enumeration that stops a treasury going quiet ───────────────────────

export interface TreasuryStanding {
  circleId: string;
  unit: string;
  tokenSlug: string;
  account: string;
  balanceMinor: number;
  circleStatus: CircleStatus;
}

/**
 * EVERY TREASURY WITH TOKENS IN IT, AND WHAT ITS CIRCLE'S STATUS IS.
 *
 * This is the answer to "a circle account strands value". A stranded pile is
 * one nothing lists. Every treasury has a `circle_budgets` row, the account id
 * is a pure function of the circle id, and this reads a balance for each. A
 * treasury this misses cannot exist, because `ensureTreasuryAccount` is the
 * only creator and it is keyed off the same row.
 *
 * `dormantHoldings` is the filtered view a steward is shown: value held by a
 * circle that has stopped. It is a report and never a refusal, because tokens
 * a circle owns are not a defect and a boot that failed on them would be
 * refusing to start over a village's own decision.
 */
export async function treasuryStandings(
  conn: Pool | PoolConnection,
  budgets: ReadonlyArray<{ circleId: string; unit: string; mode: BudgetMode }>,
  tokenTypeFor: (unit: string) => string | null,
  statusFor: (circleId: string) => CircleStatus,
): Promise<TreasuryStanding[]> {
  const out: TreasuryStanding[] = [];
  for (const b of budgets) {
    if (b.mode !== "treasury") continue;
    if (treasuryAccountProblem(b.circleId)) continue;
    const tokenSlug = tokenTypeFor(b.unit);
    if (!tokenSlug) continue;
    const held = await treasuryHoldings(conn, b.circleId, tokenSlug);
    out.push({
      circleId: b.circleId,
      unit: b.unit,
      tokenSlug,
      account: held.account,
      balanceMinor: held.balanceMinor,
      circleStatus: statusFor(b.circleId),
    });
  }
  return out;
}

/**
 * WHAT SITS UNSPENT IN CIRCLE TREASURIES, ACROSS THE WHOLE VILLAGE.
 *
 * Ruled by Rye and it is one number. Cap mode issues nothing and only permits;
 * treasury mode mints up front, and the incentive to save is deliberate, so
 * unspent balances persist and accumulate across seasons. Left unwatched that
 * becomes committed supply nobody is looking at.
 *
 * ── READ OFF THE BALANCES, NEVER OFF FUNDED MINUS SPENT ────────────────────
 *
 * `token_balances` is the cache conservation is checked against and the one
 * every other supply surface derives from. Reconstructing the same answer from
 * the flows would be a second counter over the same rows, and this codebase
 * has already paid for one: the mint guard read 600 while the admin panel read
 * 300 from the same table at the same instant.
 *
 * The prefix IS the definition of a circle treasury account. `sys:` accounts
 * are created by migrations and by `ensureTreasuryAccount` and by nothing
 * else, and that function is the only writer of this prefix, so the LIKE
 * cannot pick up an account that is not one.
 *
 * A slug narrows it to one token; omitting it returns every token, which is
 * what the admin surface needs to print the figure beside issued and retired.
 */
export async function treasuryHeldByToken(
  conn: Pool | PoolConnection,
  slug?: string,
): Promise<Record<string, { heldMinor: number; accounts: number }>> {
  const where = slug ? " AND token_type = ?" : "";
  const [rows] = await conn.query<RowDataPacket[]>( // module-review-ok: an aggregate read over the ledger's own tables; server/repos holds no reader for token_ledger or token_balances and a repo would be a second cache above the one conservation is checked against
    "SELECT token_type, COALESCE(SUM(balance), 0) AS held, " +
      "COUNT(CASE WHEN balance <> 0 THEN 1 END) AS accounts " +
      `FROM token_balances WHERE account_id LIKE ?${where} GROUP BY token_type`,
    slug ? [`${CIRCLE_TREASURY_PREFIX}%`, slug] : [`${CIRCLE_TREASURY_PREFIX}%`],
  );
  const out: Record<string, { heldMinor: number; accounts: number }> = {};
  for (const r of rows as any[]) {
    out[String(r.token_type)] = {
      heldMinor: Number(r.held ?? 0),
      accounts: Number(r.accounts ?? 0),
    };
  }
  return out;
}

/**
 * The whole figure for one token, with the state that says what a zero means.
 *
 * `budgetsOnTreasury` is the count of rows RUNNING on a treasury at `at`, so a
 * circle whose move to a treasury is queued for next season does not make this
 * village read `all_empty` today.
 */
export async function villageTreasuryTotal(
  conn: Pool | PoolConnection,
  opts: {
    moduleOn: boolean;
    slug: string;
    budgetsOnTreasury: number;
  },
): Promise<TreasuryTotal> {
  const byToken = await treasuryHeldByToken(conn, opts.slug);
  const held = byToken[opts.slug] ?? { heldMinor: 0, accounts: 0 };
  const state = treasuryTotalState(opts.moduleOn, held.accounts, opts.budgetsOnTreasury);
  return {
    state,
    heldMinor: state === "module_off" ? null : held.heldMinor,
    accountsHolding: held.accounts,
    budgetsOnTreasury: opts.budgetsOnTreasury,
  };
}

/**
 * A DORMANT CIRCLE HOLDING TOKENS IS A DEFECT REPORT, AND IT SHOULD BE EMPTY.
 *
 * `sweepDormantCircle` runs the instant a circle's status changes, so under
 * Rye's ruling this list is empty in a healthy village. It exists because the
 * sweep is a posting and a posting can fail: the ledger can refuse, a token
 * can be one this meter does not read, a fork can call the status writer
 * without the hook. Every one of those leaves value in an account nobody is
 * watching, which is precisely the failure a per-circle account was objected
 * to for, so it is enumerated by name instead of assumed away.
 */
export function dormantHoldings(standings: readonly TreasuryStanding[]): TreasuryStanding[] {
  return standings.filter((s) => s.circleStatus === "dormant" && s.balanceMinor > 0);
}

/** The sentence a steward reads about a dormant circle that still holds tokens. */
export function dormantSentence(
  standing: TreasuryStanding,
  circleName: string,
): string {
  const human = fromLedgerUnits(standing.tokenSlug, standing.balanceMinor);
  return (
    `${circleName} is dormant and its treasury still holds ${human} ${standing.tokenSlug}. ` +
    "A dormant circle should hold nothing here, so the sweep that empties it has not run for " +
    "this one. Hand the balance back to the village, which returns the issuance room with it."
  );
}

// ── The scheduled mode change ───────────────────────────────────────────────

export interface BudgetModeRow {
  id: string;
  circleId: string;
  unit: string;
  mode: BudgetMode;
  pending: PendingModeChange | null;
}

/**
 * QUEUE A MODE CHANGE. IT LANDS AT THE PERIOD BOUNDARY, NEVER NOW.
 *
 * The live `mode` column is untouched, so the circle finishes its period on
 * the model it started with. This is `queueRuleChange`'s shape exactly:
 * queueing over a queued change REPLACES it rather than stacking, because two
 * pending modes for one budget have no defined meaning and somebody would have
 * to invent one.
 *
 * The instant is computed by the CALLER from the same windows the burn meter
 * uses, so there is one definition of a season boundary in this codebase.
 */
export async function queueModeChange(
  pool: Pool,
  budgetId: string,
  mode: BudgetMode,
  from: Date,
  actorId: string | null,
): Promise<boolean> {
  const [res]: any = await pool.query( // module-review-ok: circle_budgets is one of the resources module's three declaration tables, whose one enumerable home is this SQL (the structureRead pattern server/lib/resources.ts records); no cache sits above it
    "UPDATE circle_budgets SET pending_mode = ?, pending_from = ?, pending_by = ?, " +
      "pending_at = UTC_TIMESTAMP() WHERE id = ?",
    [mode, from, actorId, budgetId],
  );
  return Number(res?.affectedRows ?? 0) > 0;
}

/** Withdraw a queued change. Clears all four columns in one write. */
export async function cancelModeChange(pool: Pool, budgetId: string): Promise<boolean> {
  const [res]: any = await pool.query( // module-review-ok: circle_budgets is one of the resources module's three declaration tables, whose one enumerable home is this SQL (the structureRead pattern server/lib/resources.ts records); no cache sits above it
    "UPDATE circle_budgets SET pending_mode = NULL, pending_from = NULL, pending_by = NULL, " +
      "pending_at = NULL WHERE id = ? AND pending_from IS NOT NULL",
    [budgetId],
  );
  return Number(res?.affectedRows ?? 0) > 0;
}

/**
 * PROMOTE EVERY QUEUED CHANGE WHOSE BOUNDARY HAS PASSED.
 *
 * One statement, so a run interrupted between rows cannot promote half of a
 * village's decision, and the same four columns are cleared in the write that
 * applies them. `applyPendingRules` in server/lib/economy.ts is the model.
 *
 * THIS IS A TIDY-UP AND NOT THE RULE. `modeAt` in shared/circleTreasury.ts
 * already answers which model is running at any instant from the stored mode
 * and the pending row, so a village whose scheduler is off still reads
 * correctly. If the promotion were the rule, a missed sweep would leave every
 * circle running last season's model with nothing anywhere saying so.
 */
export async function applyPendingModes(pool: Pool, at: Date = new Date()): Promise<number> {
  const [res]: any = await pool.query( // module-review-ok: circle_budgets is one of the resources module's three declaration tables, whose one enumerable home is this SQL (the structureRead pattern server/lib/resources.ts records); no cache sits above it
    "UPDATE circle_budgets SET mode = pending_mode, pending_mode = NULL, pending_from = NULL, " +
      "pending_by = NULL, pending_at = NULL " +
      "WHERE pending_from IS NOT NULL AND pending_mode IS NOT NULL AND pending_from <= ?",
    [at],
  );
  return Number(res?.affectedRows ?? 0);
}

/** The mode a budget row is running under at an instant. One call, one answer. */
export function budgetModeAt(row: BudgetModeRow, at: Date): BudgetMode {
  return modeAt(row.mode, row.pending, at);
}

// ── What server/index.ts calls, so the monolith holds none of the reasoning ──

const TOKEN_UNIT = /^token:([a-z0-9][a-z0-9-]{0,30})$/;

/**
 * Which ledger token a budget's unit is denominated in.
 *
 * `token:<slug>` is a token this ledger holds. An ISO 4217 code is a currency
 * whose movements live in `fiat_charges`, so it returns null and every reading
 * above reports `unmeasurable` instead of a zero nobody measured.
 *
 * ONE DEFINITION, here rather than in a route, because three callers need it:
 * the burn route, the treasury routes, and the circle-status hook in
 * server/index.ts. A copy in each is three chances to disagree about what a
 * unit means.
 */
export function treasuryTokenFor(unit: string): string | null {
  const m = TOKEN_UNIT.exec(String(unit ?? ""));
  if (!m) return null;
  return tokenDef(m[1]!) ? m[1]! : null;
}

/**
 * A CIRCLE'S LIFECYCLE, OFF THE REPO, WITH AN UNKNOWN CIRCLE READING DORMANT.
 *
 * Three routes need this and a copy in each is three chances to disagree. The
 * default matters: a circle this reader cannot find is reported `dormant` and
 * never `active`, because a dormant circle's treasury has been swept, so the
 * conservative answer is the one that does not imply a live balance under a
 * circle nobody can name.
 */
export function circleStatusReader(circlesRepo: { all(): unknown[] }): (id: string) => CircleStatus {
  const circles = circlesRepo.all() as Array<{ id?: string; status?: string }>;
  return (id: string) => {
    const found = circles.find((c) => c?.id === id);
    return CIRCLE_STATUSES.includes(found?.status as CircleStatus)
      ? (found!.status as CircleStatus)
      : "dormant";
  };
}

/** Per budget row, what its circle's treasury holds in that budget's unit. */
export async function budgetTreasuries(
  conn: Pool | PoolConnection,
  budgets: ReadonlyArray<{ id: string; circleId: string; unit: string; mode: BudgetMode }>,
): Promise<Record<string, { account: string; balanceMinor: number; slug: string }>> {
  /*
   * KEYED BY BUDGET ID AND NOT BY CIRCLE ID. A circle can hold budgets in two
   * units, and a map keyed by circle would silently show one of them for the
   * other, which is the `Record<string, T>` failure this codebase already
   * catches with `check-mirror-annotations` one layer up.
   */
  const out: Record<string, { account: string; balanceMinor: number; slug: string }> = {};
  for (const b of budgets) {
    if (b.mode !== "treasury") continue;
    const slug = treasuryTokenFor(b.unit);
    if (!slug || treasuryAccountProblem(b.circleId)) continue;
    const held = await treasuryHoldings(conn, b.circleId, slug);
    out[b.id] = { account: held.account, balanceMinor: held.balanceMinor, slug };
  }
  return out;
}

/**
 * THE THIRD FACT THE ADMIN TOKEN PANEL PRINTS, beside issued and retired.
 *
 * Issued, still in existence, not yet spent, and COMMITTED TO A CIRCLE. It is
 * netted into neither of the other two, for the reason `GET /api/admin/tokens`
 * already refuses to net retired into issuance: netting silently changes what
 * a word means. A founder reading issuance alone overstates what is loose in
 * the village by exactly this figure.
 *
 * The STATE is what stops a zero lying. `module_off` is an absence,
 * `none_on_treasury` is a measured zero because every circle chose a cap, and
 * `all_empty` is a measured zero with treasuries nobody has funded. `held`
 * wins over all three whenever tokens are actually there, the module's
 * lifecycle included, because the tokens are real either way.
 */
export async function treasuryFacts(
  conn: Pool | PoolConnection,
  budgets: ReadonlyArray<{ unit: string; mode: BudgetMode; pending: PendingModeChange | null }>,
  slugs: readonly string[],
  resourcesOn: boolean,
  at: Date = new Date(),
): Promise<{
  byToken: Record<string, TreasuryTotal>;
  totals: Record<string, { heldMinor: number; accounts: number }>;
}> {
  const totals = await treasuryHeldByToken(conn);
  const byToken: Record<string, TreasuryTotal> = {};
  for (const slug of slugs) {
    const held = totals[slug] ?? { heldMinor: 0, accounts: 0 };
    // The mode IN FORCE, so a circle whose move to a treasury is queued for
    // next season does not make this village read `all_empty` today.
    const onTreasury = budgets.filter(
      (b) => modeAt(b.mode, b.pending, at) === "treasury" && treasuryTokenFor(b.unit) === slug,
    ).length;
    const state = treasuryTotalState(resourcesOn, held.accounts, onTreasury);
    byToken[slug] = {
      state,
      heldMinor: state === "module_off" ? null : held.heldMinor,
      accountsHolding: held.accounts,
      budgetsOnTreasury: onTreasury,
    };
  }
  return { byToken, totals };
}

/**
 * WHAT HAPPENS TO A CIRCLE'S MONEY WHEN ITS STATUS CHANGES. RYE'S RULING, IN
 * ONE FUNCTION, SO THE MONOLITH HOLDS A CALL AND NOT A POLICY.
 *
 * Going dormant sweeps the treasury to the master treasury or retires it.
 * Coming back tells the steward what the circle held and that giving it back
 * is a new mint, which meets the village's issuance cap for the cycle it
 * happens in and can therefore be refused.
 *
 * CALL IT AFTER THE STATUS ROW IS COMMITTED. The status change is what makes
 * the sweep lawful, so a sweep that ran first and then met a failed write
 * would have moved a live circle's money. The worst case in this order is a
 * dormant circle still holding tokens, which `GET /api/resources/treasuries`
 * reports by name and any steward can clear with the return route.
 */
export async function onCircleStatusChange(
  pool: Pool,
  circle: { id?: unknown; name?: unknown; status?: unknown },
  was: string,
  actorId: string | null,
  listBudgetsFor: (pool: Pool) => Promise<ReadonlyArray<{
    id: string; circleId: string; unit: string;
    dormant: { heldMinor: number; at: string; destination: string } | null;
  }>>,
): Promise<{ treasurySwept?: DormancySweep[]; treasuryNote?: string }> {
  const circleId = String(circle.id ?? "");
  const now = String(circle.status ?? "active");
  if (!circleId || was === now) return {};

  if (now === "dormant") {
    const mine = (await listBudgetsFor(pool)).filter((b) => b.circleId === circleId);
    if (mine.length === 0) return {};
    const treasurySwept = await sweepDormantCircle(pool, {
      circleId,
      budgets: mine.map((b) => ({ id: b.id, unit: b.unit })),
      tokenTypeFor: treasuryTokenFor,
      actorId,
    });
    return { treasurySwept };
  }

  if (was === "dormant") {
    const mine = (await listBudgetsFor(pool)).filter((b) => b.circleId === circleId && b.dormant);
    const record = mine[0];
    const slug = record ? treasuryTokenFor(record.unit) : null;
    if (!record?.dormant || !slug) return {};
    const note = revivalNote(record.dormant, slug, String(circle.name ?? circleId));
    return note ? { treasuryNote: note } : {};
  }
  return {};
}
