/**
 * The token ledger, S7 edition: transfer rows in MySQL, between ACCOUNTS.
 *
 * The JSON era recorded bare credits — "N appeared in X's balance" — which
 * makes issuance invisible. The keystone shape is double-entry-lite: every
 * movement is a transfer FROM one account TO another, amount strictly
 * positive. Ordinary accounts can never overdraft. Designated FAUCET accounts
 * (sys:gratitude-pool, sys:cycle-pool) may run negative, and their negative
 * balance IS the issued-to-date figure. Conservation is therefore a checkable
 * invariant, not a hope: for every token, SUM(balance) over all accounts ≡ 0.
 *
 * Disciplines carried forward from the JSON ledger, both learned at
 * regen-civics:
 *
 *  1. RECOMPUTE, NEVER INCREMENT. token_balances is a cache; every posting
 *     rewrites the two touched rows from SUM(transfers) inside the same
 *     transaction. A wrong cache is fixed by recomputation, not hand-patching.
 *  2. EVERY WRITE CARRIES AN IDEMPOTENCY KEY. The UNIQUE index is the dedupe:
 *     a retried request posts once because the second INSERT fails, not
 *     because a flag was checked.
 *
 * The registry now READS THE tokens TABLE (0006/0007) — the in-memory list
 * this file used to carry is gone, because two registries drift. It is loaded
 * at boot and refreshed whenever an admin creates a token (S9).
 *
 * `governance` is the guard that matters: 'platform' tokens are minted and
 * moved here; 'hypha' tokens (equity, voice) live on Base under Hypha and are
 * read-only mirrors — if this platform ever posted one it would quietly
 * become the source of truth for the cap table, which decision 5 says it must
 * never be. Boot invariants enforce that with a loud failure, not a comment.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { issuanceRefusal } from "./gameStart";

export type TokenType = string;

export interface TokenDef {
  slug: string;
  name: string;
  /** Levers-spec taxonomy: recognition | equity | voice | credit. */
  kind: string;
  /** 'platform' = this ledger mints and moves it; 'hypha' = read-only mirror. */
  governance: "platform" | "hypha";
  /** May members send it peer-to-peer? */
  transferable: boolean;
  /**
   * How many decimal places the token DISPLAYS. The ledger stores integers
   * only (`amount` is an INT with a positive CHECK, and `validateLeg` truncates
   * what it is handed), so a token that needs fractions rides in minor units
   * and this is the scale. The column has existed since 0006; the registry
   * simply never read it, which meant a 0.1 posting silently became 0.
   */
  decimals: number;
  active: boolean;
  /** Standing-example token: display-only, retires on the first real one. */
  isExample?: boolean;
}

/** The default recognition token. The others are read from chain. */
export const PLATFORM_TOKEN: TokenType = "gratitude";

/** System account ids the platform is born knowing (seeded by 0009). */
export const RECOGNITION_FAUCET = "sys:gratitude-pool";
export const CYCLE_POOL_FAUCET = "sys:cycle-pool";
export const TREASURY = "sys:treasury";
/** Seeded by 0011. Its negative balance IS each credit token's issued supply. */
export const MINT_FAUCET = "sys:mint";

/** The ledger account id that belongs to a member. */
export function memberAccount(userId: string): string {
  return `mem:${userId}`;
}

// ── Registry ────────────────────────────────────────────────────────────────

const registry = new Map<string, TokenDef>();

/**
 * Fill the in-memory registry from the tokens table. Called at boot (after
 * migrations) and after any admin change to the table. Handlers then use the
 * synchronous tokenDef() they always used.
 */
export async function loadTokenRegistry(pool: Pool): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT slug, name, kind, governance, transferable, decimals, active, is_example FROM tokens",
  );
  registry.clear();
  for (const r of rows) {
    registry.set(String(r.slug), {
      slug: String(r.slug),
      name: String(r.name),
      kind: String(r.kind),
      governance: r.governance === "hypha" ? "hypha" : "platform",
      transferable: !!r.transferable,
      decimals: Number(r.decimals ?? 0),
      active: !!r.active,
      isExample: Number(r.is_example ?? 0) === 1,
    });
  }
}

/** Look up a token. Undefined means "not a token" — callers must fail loud. */
export function tokenDef(slug: string): TokenDef | undefined {
  return registry.get(slug);
}

export function allTokens(): TokenDef[] {
  return Array.from(registry.values());
}

/**
 * TWO TOKENS MAY NOT SHARE A DISPLAY NAME (Rye, 2026-08-15).
 *
 * Returns a refusal sentence, or null when the name is free. Shared by the
 * create and rename routes, because guarding one leaves the other as an
 * unguarded door to the identical collision.
 *
 * The registry already refuses to RENAME a Hypha mirror: its name is a fact
 * about Base rather than a setting. That guarded one direction and left the
 * other open, and the open one is what actually bites. A platform token renamed
 * onto a Base token's name produces the same contradiction from the far end,
 * and leaves a member unable to tell which thing a balance means.
 *
 * Compared case-insensitively on the trimmed string, because "amora" and
 * "Amora " are the same word to whoever reads the chip.
 *
 * Deliberately an EXACT match and not a substring test. "Amora Credits" is not
 * blocked and should not be: refusing every name that merely CONTAINS a token's
 * name would refuse most of what a village would naturally choose, and a guard
 * that blocks the ordinary case gets removed rather than obeyed. This prevents
 * the collision, not the family resemblance.
 */
export function tokenNameClash(name: string, exceptSlug: string): string | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  const clash = allTokens().find(
    (t) => t.slug !== exceptSlug && t.name.trim().toLowerCase() === wanted,
  );
  if (!clash) return null;
  return clash.governance === "platform"
    ? `"${clash.name}" is already the name of the ${clash.slug} token. Two tokens sharing a name is a balance nobody can read`
    : `"${clash.name}" is what ${clash.slug} is called on Base, and Base is the source of truth for that name. Pick a name this village owns`;
}

/**
 * THE SLUG FREEZES ONCE SET (Rye, 2026-08-30).
 *
 * Returns a refusal sentence, or null when the request is not trying to move
 * a slug. Sits beside `tokenNameClash` because it is the same shape of thing:
 * the one place a rule about a token's identity is written down, so the route
 * cannot state it one way and a future caller another.
 *
 * WHY IT IS A REFUSAL AND NOT A NO-OP. PUT /api/admin/tokens/:slug only ever
 * wrote the name column, so a `slug` in the body was already ignored. Ignored
 * is not refused. The caller asked for a re-denomination, got a 200 and a
 * token still answering to the old key, which reads as success from every
 * side, and whatever they build next assumes it worked.
 *
 * WHY IT IS ONE-WAY. This schema carries no foreign keys at all (counted
 * 2026-08-31: zero across every table), so the slug is the only thread
 * holding a token's history together. `token_ledger.token_type`,
 * `token_balances.token_type`, `onchain_balances.token_slug` and every
 * idempotency key are written against it, and nothing would raise an error if
 * it moved out from under them. Every balance would quietly read zero.
 *
 * 0124 moved the seeded equity token's slug once, in the window when all of
 * those tables were provably empty. That window is what this guard closes.
 *
 * An ECHO of the token's own slug is not an attempt to move it: a client that
 * PUTs the record it just read is doing the ordinary thing, and refusing that
 * would make the guard something callers work around rather than obey.
 */
export function slugFreezeRefusal(asked: unknown, currentSlug: string): string | null {
  if (asked === undefined || asked === null) return null;
  if (String(asked) === currentSlug) return null;
  return (
    `A token's slug never changes. "${currentSlug}" is what every ledger row, balance and ` +
    `idempotency key for this token is written against, and moving it would orphan all of them ` +
    `without raising a single error. Change the display name instead: every surface follows it`
  );
}

/**
 * Create or update a token (S9 admin surface; module layer later). Writes the
 * table first, then refreshes the registry — the table is the truth.
 */
export async function registerToken(
  pool: Pool,
  // `decimals` is optional here and required on the read side: every caller
  // wants an answer to "what scale is this token" and almost none of them has
  // an opinion when creating one. Whole units is the right default and the
  // wrong thing to make ten call sites restate.
  def: Omit<TokenDef, "active" | "decimals"> & { active?: boolean; decimals?: number },
): Promise<void> {
  await pool.query(
    "INSERT INTO tokens (slug, name, kind, governance, transferable, decimals, active) VALUES (?,?,?,?,?,?,?) " +
      // The slug is the KEY of this upsert, which is what makes it the one
      // column here that cannot move: a `def.slug` nobody has used before
      // inserts a NEW token, and a slug that exists updates that token in
      // place. There is deliberately no path through this function, or any
      // other, that re-denominates an existing one. Every ledger row, balance
      // row and idempotency key is written against the slug and this schema
      // carries no foreign keys, so a moved slug orphans a token's whole
      // history in silence. PUT /api/admin/tokens/:slug refuses the attempt
      // out loud; 0124 did it once, in the one window when every one of those
      // tables was provably empty.
      //
      // decimals is deliberately ABSENT from this list. Re-registering a token
      // at boot must not silently rescale one that already holds a balance:
      // changing the scale under existing rows multiplies or divides everyone's
      // holdings by a thousand and no invariant would notice, because
      // conservation holds at any scale.
      "ON DUPLICATE KEY UPDATE name=VALUES(name), kind=VALUES(kind), governance=VALUES(governance), " +
      "transferable=VALUES(transferable), active=VALUES(active)",
    [
      def.slug,
      def.name,
      def.kind,
      def.governance,
      def.transferable ? 1 : 0,
      Math.max(0, Math.trunc(Number(def.decimals ?? 0))),
      def.active === false ? 0 : 1,
    ],
  );
  await loadTokenRegistry(pool);
}

// ── Posting ─────────────────────────────────────────────────────────────────

export interface TransferInput {
  from: string;
  to: string;
  tokenType?: TokenType;
  amount: number;
  /** Machine-readable origin, e.g. "quest_consent", "gratitude_received". */
  source: string;
  sourceRef?: string;
  description?: string;
  /** Unique. A repeat write with the same key is a no-op, not a second post. */
  idempotencyKey: string;
  /**
   * Permit this post to drive a NON-FAUCET account below zero. Only honored
   * when `source` is in ALLOW_NEGATIVE_SOURCES — a negative balance is the
   * truthful state after a grace-night burn, a chargeback clawback or a
   * correction of value already spent, never a convenience for ordinary
   * spending paths.
   */
  allowNegative?: boolean;
}

/**
 * The only sources that may legally drive a non-faucet account negative
 * (with allowNegative set): stay-night burns inside the grace window,
 * mechanical reversal legs after a refund/dispute, and `reversal`, the source
 * `reverse()` in server/lib/economy.ts stamps on every correction it writes.
 * Static ON PURPOSE — extending it is a one-line reviewed change to the
 * keystone, not a runtime registration that can race the boot invariant check.
 *
 * ── WHY A CORRECTION MAY TAKE SOMEBODY BELOW ZERO ───────────────────────
 *
 * A reversal claws back value that was posted in error, and the member may
 * already have spent it. Without this the clawback is simply REFUSED: the
 * mistaken credit stands, the ledger keeps reporting value the village never
 * meant to issue, and the only remaining fix is a hand-written row. With it,
 * the clawback completes and the member's balance goes negative by whatever
 * they had already spent.
 *
 * A negative balance is not a debt the platform collects. It is the honest
 * statement that this member holds less than nothing until new earnings bring
 * them back to zero, and the overdraft check below already refuses any further
 * spend that would take an account under water, so a member at -5 simply
 * cannot spend until they are back above it. It sits in the balance every
 * surface already reads rather than in a suspense account beside it, which is
 * the point: somebody has to be able to see it and ask.
 */
export const ALLOW_NEGATIVE_SOURCES: ReadonlySet<string> = new Set([
  "stay_night",
  "payment_reversal",
  "reversal",
]);

export interface TransferResult {
  ok: boolean;
  duplicate: boolean;
  error?: string;
  /** The recomputed balance of the RECEIVING account after this post. */
  toBalance: number;
}

async function recomputeBalance(conn: PoolConnection, accountId: string, tokenType: string): Promise<number> {
  await conn.query(
    "INSERT IGNORE INTO token_balances (account_id, token_type, balance) VALUES (?,?,0)",
    [accountId, tokenType],
  );
  await conn.query(
    "UPDATE token_balances tb SET tb.balance = (" +
      "SELECT COALESCE(SUM(CASE WHEN t.to_account = ? THEN t.amount ELSE -t.amount END), 0) " +
      "FROM token_ledger t WHERE t.token_type = ? AND (t.to_account = ? OR t.from_account = ?)" +
      ") WHERE tb.account_id = ? AND tb.token_type = ?",
    [accountId, tokenType, accountId, accountId, accountId, tokenType],
  );
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT balance FROM token_balances WHERE account_id = ? AND token_type = ?",
    [accountId, tokenType],
  );
  return Number(rows[0]?.balance ?? 0);
}

/**
 * Post one transfer, transactionally and idempotently.
 *
 * Inside the transaction: the transfer row is inserted (the UNIQUE
 * idempotency key rejects replays), both touched balances are RECOMPUTED from
 * the transfer table, and the sending account is checked for overdraft —
 * non-faucet accounts must never go negative; if this post would take one
 * below zero the whole transaction rolls back and nothing moved.
 *
 * Member accounts (mem:*) are created on first touch; system accounts must
 * already exist — a typo'd system id is a bug to hear about, not an account
 * to invent.
 */
/**
 * Everything true of a leg BEFORE any transaction opens. Extracted so the
 * single-leg and paired posters cannot drift apart: one validator, two
 * callers. Returns null when the leg is postable.
 */
function validateLeg(input: TransferInput): { tokenType: string; amount: number } | { error: string } {
  const tokenType = input.tokenType ?? PLATFORM_TOKEN;
  const amount = Math.trunc(Number(input.amount) || 0);

  if (!input.from || !input.to) return { error: "from and to accounts are required" };
  if (input.from === input.to) return { error: "an account cannot transfer to itself" };
  if (amount <= 0) return { error: "amount must be a positive integer" };
  if (!input.idempotencyKey) return { error: "idempotencyKey is required" };

  const def = tokenDef(tokenType);
  if (!def) {
    // Fail loud, never coerce: a typo that silently became 'gratitude' would
    // be a mint bug wearing a coercion costume.
    return { error: `unknown token "${tokenType}": register it in the token registry before posting` };
  }
  if (def.governance !== "platform") {
    return { error: `${tokenType} is issued on Hypha and only read here; the platform cannot move it` };
  }
  return { tokenType, amount };
}

/**
 * Did this exact posting ever land?
 *
 * The ledger's idempotency key is the only durable record that value actually
 * moved, so it is also the only honest answer to "was this delivered?" — a
 * status column on an order row is not, because the fiat modules set status
 * BEFORE attempting delivery, on purpose: money arriving is true the moment
 * the provider says so.
 *
 * That ordering leaves a real window holding a disputable charge and nothing
 * granted, and every reversal handler has to ask this question before clawing
 * anything back. It lives here rather than in a route so all of them ask it
 * the same way, against the same table, with no chance of a caller inventing
 * a looser test.
 */
export async function ledgerEntryExists(pool: Pool, idempotencyKey: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT 1 FROM token_ledger WHERE idempotency_key = ? LIMIT 1",
    [idempotencyKey],
  );
  return rows.length > 0;
}

/**
 * A veto that runs INSIDE a single transfer's transaction, after the accounts
 * are locked FOR UPDATE and before the ledger row is written.
 *
 * Same shape and same reason as {@link PairGuard}, for the same class of bug:
 * a limit that lives OUTSIDE the ledger — a per-cycle mint cap, for one — is
 * check-then-act when the caller reads the running total, decides, and posts
 * several awaits later. A concurrent request reads the same stale total and
 * also decides yes, and the cap is quietly exceeded with every individual
 * request looking lawful.
 *
 * Running the check under the lock that already orders the writes makes
 * deciding and writing one atomic step. The accounts are locked before the
 * guard runs, so two posts moving the same token between the same accounts
 * are serialised and the second one reads the first one's committed row.
 *
 * Return a human-readable reason to refuse, or null to proceed.
 */
export type TransferGuard = (conn: PoolConnection) => Promise<string | null>;

/**
 * ONE TRANSFER, ON A TRANSACTION SOMEBODY ELSE OPENED.
 *
 * Everything `postTransfer` does between `beginTransaction` and `commit`,
 * with no begin, no commit, no rollback and no release: the caller owns all
 * four. A refusal comes back as `{ ok: false }` for the caller to roll back,
 * and only a genuinely unexpected driver error throws.
 *
 * WHY IT EXISTS. A gratitude note is the CHARGE — the sending allowance is a
 * SUM over `gratitude_log`, so the row that records the gift is the row that
 * spends the budget — and the ledger posting is the DELIVERY. `give()` used
 * to commit the charge inside its lock and post the delivery afterwards in a
 * transaction of its own. Under real contention that second transaction
 * deadlocked and threw, which left the budget spent and nothing in the
 * recipient's hands: 18 of 40 gives, 36 units of a 100-unit allowance, on the
 * measured run that found it. Nothing was created out of balance, so
 * `checkLedgerInvariants` reported a clean economy over a real loss, and no
 * surface in the product could see it.
 *
 * Handing the caller's own connection to the posting makes charge and
 * delivery one commit. Both or neither, which is the same discipline
 * `postTransferPair` already applies to a swap's two legs.
 */
export async function postTransferOn(
  conn: PoolConnection,
  input: TransferInput,
  guard?: TransferGuard,
): Promise<TransferResult> {
  const checked = validateLeg(input);
  if ("error" in checked) return { ok: false, duplicate: false, toBalance: 0, error: checked.error };
  const { tokenType, amount } = checked;

  /*
   * Accounts: members materialize on first touch, system ids must exist.
   *
   * THE LOCK COMES FIRST AND THE `INSERT IGNORE` ONLY RUNS IF SOMETHING IS
   * GENUINELY MISSING, which is the opposite of how this was written.
   *
   * `INSERT IGNORE` on a row that already exists is not free: InnoDB takes a
   * SHARED lock on the row it collided with. Concurrent credits to one
   * recipient therefore all held S on that member's account row and then all
   * asked to upgrade it to X on the `FOR UPDATE` below, which is a deadlock by
   * construction — each is waiting for the others to release a lock none of
   * them will let go of before its own upgrade. The accounts almost always
   * exist, so almost all of that S-locking bought nothing.
   *
   * Measured on `server/economy.test.ts`, with the isolation level already
   * fixed and the retry already in place: twelve members thanking one person
   * at the same moment still lost three of the twelve to this alone, after
   * three retries each. Reverting just this line brings the failures back.
   *
   * Taking the exclusive lock first and creating only what is genuinely absent
   * keeps the behaviour identical and removes the upgrade. `ORDER BY id` for
   * the same reason the recompute below sorts: one lock order for everybody.
   *
   * `postTransferPairOnce` has done exactly this since S57, with a comment
   * saying why. The single-leg poster twenty lines above it never learned it,
   * and the single-leg poster is the one every recognition credit in the
   * village goes through.
   */
  const lockAccounts = async () => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT id, faucet FROM ledger_accounts WHERE id IN (?, ?) ORDER BY id FOR UPDATE",
      [input.from, input.to].sort(),
    );
    return new Map(rows.map((r) => [String(r.id), { faucet: !!r.faucet }]));
  };
  let accounts = await lockAccounts();
  const absent = [input.from, input.to].filter((a) => a.startsWith("mem:") && !accounts.has(a));
  if (absent.length) {
    for (const acct of absent) {
      await conn.query(
        "INSERT IGNORE INTO ledger_accounts (id, kind, user_id, label, faucet) VALUES (?,?,?,?,0)",
        [acct, "member", acct.slice(4), acct.slice(4)],
      );
    }
    accounts = await lockAccounts();
  }
  const fromAcct = accounts.get(input.from);
  if (!fromAcct || !accounts.get(input.to)) {
    const missing = !fromAcct ? input.from : input.to;
    return { ok: false, duplicate: false, toBalance: 0, error: `account "${missing}" does not exist` };
  }

  /*
   * ISSUANCE WAITS FOR THE VILLAGE (R67, lane GAMESTART).
   *
   * A posting out of a faucet creates tokens; every other posting moves
   * tokens that already exist. That distinction is this table's `faucet`
   * column, read one statement above for the overdraft rule, so the gate
   * costs nothing extra and sees every faucet there is instead of the one
   * the admin mint cap knows about.
   *
   * Before the launch ballot carries, a village may build its whole Game and
   * issue nothing. Spending, swapping and member-to-member sending are
   * untouched here on purpose: a village that has not started has nothing to
   * spend, so this takes nothing away from anybody.
   */
  if (fromAcct.faucet) {
    const closed = await issuanceRefusal(conn);
    if (closed) return { ok: false, duplicate: false, toBalance: 0, error: closed };
  }

  // The veto, under the lock the accounts are already holding.
  if (guard) {
    const refusal = await guard(conn);
    if (refusal) return { ok: false, duplicate: false, toBalance: 0, error: refusal };
  }

  try {
    await conn.query(
      "INSERT INTO token_ledger (id, from_account, to_account, token_type, amount, source, source_ref, description, idempotency_key) " +
        "VALUES (?,?,?,?,?,?,?,?,?)",
      [
        `led-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        input.from,
        input.to,
        tokenType,
        amount,
        input.source,
        input.sourceRef ?? null,
        input.description ?? null,
        input.idempotencyKey,
      ],
    );
  } catch (e: any) {
    if (e?.code === "ER_DUP_ENTRY") {
      /*
       * Replay: the money already moved exactly once. A duplicate key rolls
       * back the STATEMENT and leaves the transaction open, so the current
       * state is readable on this same connection.
       *
       * `FOR UPDATE` because a plain SELECT is a consistent read, and a
       * consistent read answers from the snapshot taken at this TRANSACTION's
       * first plain read — which, when the caller owns the transaction, can
       * be many statements ago. A locking read returns the latest committed
       * row instead. It takes no lock order this function does not already
       * hold: both accounts are exclusively locked above, and the recompute
       * below touches the same `token_balances` rows in the same order.
       */
      const [b] = await conn.query<RowDataPacket[]>(
        "SELECT balance FROM token_balances WHERE account_id = ? AND token_type = ? FOR UPDATE",
        [input.to, tokenType],
      );
      return { ok: true, duplicate: true, toBalance: Number(b[0]?.balance ?? 0) };
    }
    throw e;
  }

  // Recompute both caches in a stable order (avoids lock-order deadlocks).
  const ordered = [input.from, input.to].sort();
  const balances = new Map<string, number>();
  for (const acct of ordered) balances.set(acct, await recomputeBalance(conn, acct, tokenType));

  const fromBalance = balances.get(input.from)!;
  const negativeAllowed = !!input.allowNegative && ALLOW_NEGATIVE_SOURCES.has(input.source);
  if (!fromAcct.faucet && fromBalance < 0 && !negativeAllowed) {
    return {
      ok: false,
      duplicate: false,
      toBalance: 0,
      error: `insufficient ${tokenType}: "${input.from}" holds ${fromBalance + amount} and cannot overdraft`,
    };
  }

  return { ok: true, duplicate: false, toBalance: balances.get(input.to)! };
}

/**
 * A LEDGER REFUSAL, TURNED INTO A SENTENCE A MEMBER CAN BE SHOWN.
 *
 * The sentences this file authors are AUDIT sentences and they are right to
 * be. `insufficient village-voice: "mem:user-17885..." holds 9999 and cannot
 * overdraft` names the account by its internal id and the balance in MINOR
 * units, which is exactly what a steward reading a log needs.
 *
 * It is not what a member needs, and `/api/wallet/send` was handing it to one
 * verbatim: the person who typed an amount into the send card was shown their
 * own internal account id and a balance a thousand times the one the card
 * printed an inch above the box, Voice riding in thousandths. Two defects in
 * one string, and the second one grows with every token that gains a scale.
 *
 * So the route translates. `holds` is already in the member's own units (the
 * caller divides through `fromLedgerUnits`) and `tokenName` is the village's
 * own word, so the sentence a member reads matches the balance line beside it.
 *
 * The account-id sweep is exact rather than a pattern: the caller passes the
 * ids it just built, and any refusal containing one of them is swallowed for a
 * plain sentence rather than leaked. `account "..." does not exist` is caught
 * that way too, and it must be, because it leaks the same id while meaning
 * something entirely different from an insufficiency.
 */
export function refusalForMember(
  error: string | undefined,
  ctx: { accountIds: string[]; holds: string; tokenName: string },
): string {
  const said = String(error ?? "");
  if (said.startsWith("insufficient ")) {
    return `You hold ${ctx.holds} ${ctx.tokenName}, which is not enough to send that`;
  }
  if (ctx.accountIds.some((a) => a && said.includes(a))) return "That send did not go through, and nothing moved";
  return said || "That send did not go through";
}

/**
 * One transfer, in a transaction of its own.
 *
 * THE RETRY IS NOT OPTIONAL AND USED TO BE MISSING. `postTransferPair` has
 * carried a three-attempt deadlock retry since S57 for the reason written
 * over it: InnoDB picks a victim under real contention even with perfect lock
 * ordering, because the balance recompute reads rows a neighbour is writing.
 * A single post is under exactly the same pressure — every recognition credit
 * in the village locks the same faucet account row — and had nothing. Twelve
 * members thanking somebody at the same moment produced ten deadlocks, and a
 * deadlocked post is what leaves a gratitude note charged and undelivered.
 *
 * A rolled-back transaction moved nothing, so retrying is safe and honest;
 * giving up after three keeps a pathological case from hiding as latency.
 */
export async function postTransfer(
  pool: Pool,
  input: TransferInput,
  guard?: TransferGuard,
): Promise<TransferResult> {
  const checked = validateLeg(input);
  if ("error" in checked) return { ok: false, duplicate: false, toBalance: 0, error: checked.error };

  for (let attempt = 1; ; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await postTransferOn(conn, input, guard);
      if (!result.ok) {
        await conn.rollback();
        return result;
      }
      await conn.commit();
      return result;
    } catch (e: any) {
      try { await conn.rollback(); } catch { /* already rolled back */ }
      const retryable = e?.code === "ER_LOCK_DEADLOCK" || e?.code === "ER_LOCK_WAIT_TIMEOUT";
      if (!retryable || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 25 * attempt + Math.floor(Math.random() * 25)));
    } finally {
      conn.release();
    }
  }
}

// ── The pair: two legs, one transaction (S57) ────────────────────────────────

export interface PairResult {
  ok: boolean;
  duplicate: boolean;
  error?: string;
  /** "accountId|tokenType" → recomputed balance, for all four touched pairs. */
  balances: Record<string, number>;
}

/**
 * Post EXACTLY TWO transfers in ONE transaction: both, or neither.
 *
 * postTransfer owns its own transaction, so two sequential calls can commit
 * the first leg and fail the second — the member debited and never credited.
 * A swap is the first operation in this platform where that gap is reachable
 * by ordinary use, so the gap gets closed rather than documented.
 *
 * Fixed at two legs ON PURPOSE. A generic N-leg API is what makes a router
 * easy to build, and a router is an automated market maker wearing a helper
 * function. Two legs is a swap; anything longer is a different decision that
 * deserves its own gate.
 */
/**
 * A veto that runs INSIDE the pair's transaction, after the accounts are
 * locked and before the rows are written. It exists for limits that live
 * outside the ledger — per-cycle swap caps, for one — which are otherwise
 * check-then-act: read the total, decide, and write several awaits later
 * while a concurrent request reads the same stale total and also decides
 * yes. Running the check under the same lock that orders the writes makes
 * the decision and the write one atomic step. Return a member-readable
 * reason to refuse, or null to proceed.
 */
export type PairGuard = (conn: PoolConnection) => Promise<string | null>;

export async function postTransferPair(
  pool: Pool,
  legs: [TransferInput, TransferInput],
  guard?: PairGuard,
): Promise<PairResult> {
  // InnoDB may still pick a deadlock victim under real contention even with
  // perfect lock ordering (the balance recompute reads rows a neighbour is
  // writing). A rolled-back transaction moved nothing, so retrying is safe
  // and honest; giving up after three tries keeps a pathological case from
  // hiding as latency.
  for (let attempt = 1; ; attempt++) {
    try {
      return await postTransferPairOnce(pool, legs, guard);
    } catch (e: any) {
      const retryable = e?.code === "ER_LOCK_DEADLOCK" || e?.code === "ER_LOCK_WAIT_TIMEOUT";
      if (!retryable || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 25 * attempt + Math.floor(Math.random() * 25)));
    }
  }
}

async function postTransferPairOnce(
  pool: Pool,
  legs: [TransferInput, TransferInput],
  guard?: PairGuard,
): Promise<PairResult> {
  const fail = (error: string): PairResult => ({ ok: false, duplicate: false, error, balances: {} });

  // A pair NEVER creates debt. allowNegative exists for grace nights and
  // chargebacks — situations where a debt is the truth. A swap that could
  // overdraft is just a mint with extra steps, so this is a hard error
  // inside the primitive rather than a rule callers are asked to remember.
  for (const leg of legs) {
    if (leg.allowNegative) return fail("allowNegative is illegal in a paired post: a swap may never create debt");
  }
  if (legs[0].idempotencyKey === legs[1].idempotencyKey) {
    return fail("both legs carry the same idempotency key: a pair needs two distinct keys");
  }

  const checked = legs.map(validateLeg);
  for (const c of checked) if ("error" in c) return fail(c.error);
  const [a, b] = checked as [{ tokenType: string; amount: number }, { tokenType: string; amount: number }];
  const meta = [a, b];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const touched = Array.from(new Set([legs[0].from, legs[0].to, legs[1].from, legs[1].to]));
    // ONE sorted lock statement over the deduped union: concurrent swaps
    // serialize deterministically on sys:treasury instead of deadlocking.
    //
    // LOCK FIRST, create second. Materializing member accounts up front
    // looks harmless but takes a SHARED lock on an already-existing row,
    // and two transactions that both hold it then both try to upgrade to
    // the exclusive FOR UPDATE lock deadlock every time. Taking the
    // exclusive lock first means the hot path never upgrades.
    const sorted = [...touched].sort();
    const lockStatement = `SELECT id, faucet FROM ledger_accounts WHERE id IN (${sorted.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`;
    let [acctRows] = await conn.query<RowDataPacket[]>(lockStatement, sorted);
    let accounts = new Map(acctRows.map((r) => [String(r.id), { faucet: !!r.faucet }]));

    const missingMembers = touched.filter((a) => !accounts.has(a) && a.startsWith("mem:"));
    if (missingMembers.length) {
      // Only a member account may be born here, and only when it truly does
      // not exist yet — so the shared-lock upgrade never happens on a hot row.
      for (const acct of missingMembers) {
        await conn.query(
          "INSERT IGNORE INTO ledger_accounts (id, kind, user_id, label, faucet) VALUES (?,?,?,?,0)",
          [acct, "member", acct.slice(4), acct.slice(4)],
        );
      }
      [acctRows] = await conn.query<RowDataPacket[]>(lockStatement, sorted);
      accounts = new Map(acctRows.map((r) => [String(r.id), { faucet: !!r.faucet }]));
    }
    for (const acct of touched) {
      if (!accounts.has(acct)) {
        await conn.rollback();
        return fail(`account "${acct}" does not exist`);
      }
    }

    /*
     * The same issuance gate the single-leg poster keeps, and it has to be
     * here too: a pair is two ledger rows, and a leg out of a faucet issues
     * exactly as much as a lone posting would. One rule, asked in both places
     * that can write the table.
     */
    if (legs.some((leg) => accounts.get(leg.from)?.faucet)) {
      const closed = await issuanceRefusal(conn);
      if (closed) {
        await conn.rollback();
        return fail(closed);
      }
    }

    // The accounts are locked now, so any concurrent pair touching the same
    // treasury row is queued behind this one. A limit checked here sees every
    // committed neighbour; the same limit checked before this point does not.
    if (guard) {
      const refusal = await guard(conn);
      if (refusal) {
        await conn.rollback();
        return fail(refusal);
      }
    }

    try {
      for (let i = 0; i < 2; i++) {
        await conn.query(
          "INSERT INTO token_ledger (id, from_account, to_account, token_type, amount, source, source_ref, description, idempotency_key) " +
            "VALUES (?,?,?,?,?,?,?,?,?)",
          [
            `led-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            legs[i].from,
            legs[i].to,
            meta[i].tokenType,
            meta[i].amount,
            legs[i].source,
            legs[i].sourceRef ?? null,
            legs[i].description ?? null,
            legs[i].idempotencyKey,
          ],
        );
      }
    } catch (e: any) {
      await conn.rollback();
      if (e?.code !== "ER_DUP_ENTRY") throw e;
      // A clean replay has BOTH keys already present. Exactly one means two
      // different orders minted the same key — unreachable under a single
      // transaction, so it is a key-shape bug, and the honest response is to
      // refuse rather than guess which half is real.
      const [existing] = await pool.query<RowDataPacket[]>(
        "SELECT idempotency_key FROM token_ledger WHERE idempotency_key IN (?, ?)",
        [legs[0].idempotencyKey, legs[1].idempotencyKey],
      );
      if (existing.length === 2) return { ok: true, duplicate: true, balances: {} };
      if (existing.length === 1) {
        throw new Error(
          `partial idempotency collision on ${existing[0].idempotency_key}: keys from different orders have merged; refusing to complete`,
        );
      }
      throw e;
    }

    // Recompute every touched (account, token) cache in a stable order.
    const pairs = [
      { acct: legs[0].from, token: meta[0].tokenType },
      { acct: legs[0].to, token: meta[0].tokenType },
      { acct: legs[1].from, token: meta[1].tokenType },
      { acct: legs[1].to, token: meta[1].tokenType },
    ];
    const seen = new Set<string>();
    const balances: Record<string, number> = {};
    for (const p of pairs.map((p) => ({ ...p, key: `${p.acct}|${p.token}` })).sort((x, y) => x.key.localeCompare(y.key))) {
      if (seen.has(p.key)) continue;
      seen.add(p.key);
      balances[p.key] = await recomputeBalance(conn, p.acct, p.token);
    }

    // Overdraft-check EVERY non-faucet sender. Either failing rolls both back.
    for (let i = 0; i < 2; i++) {
      const sender = legs[i].from;
      if (accounts.get(sender)?.faucet) continue;
      const bal = balances[`${sender}|${meta[i].tokenType}`];
      if (bal < 0) {
        await conn.rollback();
        return fail(
          `insufficient ${meta[i].tokenType}: "${sender}" holds ${bal + meta[i].amount} and cannot overdraft`,
        );
      }
    }

    await conn.commit();
    return { ok: true, duplicate: false, balances };
  } catch (e) {
    try { await conn.rollback(); } catch { /* already rolled back */ }
    throw e;
  } finally {
    conn.release();
  }
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** Cached balance of one account for one token. */
export async function balanceOf(pool: Pool | PoolConnection, accountId: string, tokenType: TokenType = PLATFORM_TOKEN): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT balance FROM token_balances WHERE account_id = ? AND token_type = ?",
    [accountId, tokenType],
  );
  return Number(rows[0]?.balance ?? 0);
}

/** All of one account's balances: slug -> cached balance. */
export async function balancesFor(pool: Pool, accountId: string): Promise<Record<string, number>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT token_type, balance FROM token_balances WHERE account_id = ?",
    [accountId],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.token_type)] = Number(r.balance);
  return out;
}

/** A member-perspective ledger line: amount signed from the member's side. */
export interface MemberLedgerEntry {
  id: string;
  tokenType: string;
  amount: number;
  source: string;
  sourceRef?: string;
  description?: string;
  at: string;
  /**
   * The OTHER account on this row, from the member's side. A faucet or a
   * system vault for most lines, and another member's account for a
   * peer-to-peer send.
   *
   * Read from the row and never from `sourceRef`: `sourceRef` points at
   * whatever the posting module thought was interesting, so on a send it holds
   * the same id for both halves of the pair and naming a counterpart from it
   * tells the receiver they sent themselves money.
   */
  counterAccount: string;
}

/** A member's movements, newest first, signed from their perspective. */
export async function entriesForMember(pool: Pool, userId: string): Promise<MemberLedgerEntry[]> {
  const acct = memberAccount(userId);
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, from_account, to_account, token_type, amount, source, source_ref, description, at " +
      "FROM token_ledger WHERE to_account = ? OR from_account = ? ORDER BY at DESC, id DESC",
    [acct, acct],
  );
  return rows.map((r) => ({
    id: String(r.id),
    tokenType: String(r.token_type),
    amount: String(r.to_account) === acct ? Number(r.amount) : -Number(r.amount),
    counterAccount: String(r.to_account) === acct ? String(r.from_account) : String(r.to_account),
    source: String(r.source),
    sourceRef: r.source_ref ?? undefined,
    description: r.description ?? undefined,
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
  }));
}

/**
 * WHAT A MEMBER'S CONSENTED QUESTS ACTUALLY CREDITED THEM, keyed by claim id.
 *
 * The claim row stores `amount` as the number the witness granted, and the
 * badge reward multiplier is applied AFTER that row is written, so a member
 * holding a standing badge is credited `floor(granted * multiplier)` while
 * their quest card says `granted`. The card was under-reporting the payout,
 * and the reward moment this feeds would have counted up to the wrong number.
 *
 * Read from the ledger rather than recomputed, for two reasons. The ledger is
 * what actually moved, which is the definition of what they were paid; and
 * the multiplier is a standing that changes, so recomputing it today would
 * answer a question about now when the question is about the day the quest
 * was consented.
 *
 * THE TOKEN FILTER IS LOAD-BEARING, and leaving it out was caught by driving
 * a real consent rather than by reading the route. A consent posts TWO rows
 * under `source = 'quest_consent'` with the SAME `source_ref`: the recognition
 * credit, and whatever the village's rules mint on a confirmed contribution,
 * which today is its voice token. Keyed on the claim alone, the second row
 * overwrites the first, and an 80-point quest reported 10000 credited.
 *
 * Per claim and per token there is exactly one row, because the idempotency
 * key is the claim id, so this is one row per claim once the token is pinned.
 * A claim with no row simply does not appear, which is what a zero grant
 * looks like.
 */
export async function questCreditsFor(pool: Pool, userId: string): Promise<Map<string, number>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT source_ref, amount FROM token_ledger " +
      "WHERE to_account = ? AND source = 'quest_consent' AND token_type = ? AND source_ref IS NOT NULL",
    [memberAccount(userId), PLATFORM_TOKEN],
  );
  const credits = new Map<string, number>();
  for (const r of rows) credits.set(String(r.source_ref), Number(r.amount));
  return credits;
}

// ── Boot invariants ─────────────────────────────────────────────────────────

export interface InvariantReport {
  ok: boolean;
  problems: string[];
  /**
   * GIFTS CHARGED AND NEVER DELIVERED, which no other check in this file can
   * see.
   *
   * A gratitude note IS the charge: the sending allowance is a SUM over
   * `gratitude_log`, so the row that records the gift is the row that spends
   * the budget. The `token_ledger` row is the delivery. When the two were two
   * transactions, a deadlock on the second left the first committed, and the
   * result was a member charged for a gift that never arrived. Conservation
   * still held, the cache still agreed, no balance was negative: nothing was
   * created out of balance because nothing was created at all, and every
   * surface including the founder's reconciliation panel reported a clean
   * economy over a real loss.
   *
   * SEPARATE FROM `problems`, AND NOT PART OF `ok`, on purpose. The entries
   * above are corruptions — a village whose books do not add up must not
   * serve — and this is a LOSS: real, worth a founder's attention, and no
   * reason to take the village offline. `gratitude_log` also legitimately
   * carries rows this platform never minted for (backdated imports, seeded
   * history, a cycle restated by hand), so a missing credit is a finding for
   * a person to read rather than a fact that can only mean damage.
   */
  uncredited: string[];
}

/**
 * The checks that make the economy trustworthy, run at every boot:
 *
 *  1. Hypha-governed tokens have ZERO transfer rows — the moment one appears,
 *     this database has started minting equity, and the server must not come
 *     up and normalize that.
 *  2. Every transfer's token is registered — an orphan slug is a mint bug.
 *  3. Conservation: per token, SUM(cached balances) ≡ 0.
 *  4. The cache agrees with recomputation from transfers (drift = a posting
 *     path that skipped the discipline).
 *  5. No non-faucet account is ILLEGALLY negative — negative is legal only
 *     where the account has a debit from an ALLOW_NEGATIVE_SOURCES source
 *     (grace-night burn, payment reversal, a `reverse()` correction clawing
 *     back value the member had already spent); anything else refuses boot.
 *  6. NO RECOGNITION, EQUITY OR VOICE TOKEN IS MARKED TRANSFERABLE. Only
 *     credit tokens are ever sent between members. This one is here because
 *     the wrong value shipped and sat unread: 0006 seeded `gratitude` with
 *     transferable = 1, no surface read the column, and the row was harmless
 *     for eighty-five migrations. The member-to-member send surface reads it,
 *     so a flag nobody could see became a flag that hands recognition around.
 *     0092 corrects the data; this refuses to serve if it ever comes back,
 *     whether from a seed, a restore, or an admin route that forgets to ask.
 *
 * And one FINDING, reported separately in `uncredited` and deliberately not
 * part of `ok`: gratitude notes that charged a member's allowance and never
 * delivered a credit. See the field's own note for why it is not a boot
 * refusal.
 */
export async function checkLedgerInvariants(pool: Pool): Promise<InvariantReport> {
  const problems: string[] = [];
  const uncredited: string[] = [];

  const [sendable] = await pool.query<RowDataPacket[]>(
    "SELECT slug, kind FROM tokens WHERE transferable = 1 AND kind <> 'credit'",
  );
  for (const r of sendable) {
    problems.push(
      `${r.kind} token "${r.slug}" is marked transferable: only credit tokens are ever sent between members`,
    );
  }

  const [hypha] = await pool.query<RowDataPacket[]>(
    "SELECT l.token_type, COUNT(*) n FROM token_ledger l JOIN tokens t ON t.slug = l.token_type " +
      "WHERE t.governance = 'hypha' GROUP BY l.token_type",
  );
  for (const r of hypha) problems.push(`hypha token "${r.token_type}" has ${r.n} ledger row(s): this platform must never move it`);

  const [orphans] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT l.token_type FROM token_ledger l LEFT JOIN tokens t ON t.slug = l.token_type WHERE t.slug IS NULL",
  );
  for (const r of orphans) problems.push(`ledger rows exist for unregistered token "${r.token_type}"`);

  const [sums] = await pool.query<RowDataPacket[]>(
    "SELECT token_type, SUM(balance) s FROM token_balances GROUP BY token_type HAVING SUM(balance) <> 0",
  );
  for (const r of sums) problems.push(`conservation broken for "${r.token_type}": balances sum to ${r.s}, not 0`);

  const [drift] = await pool.query<RowDataPacket[]>(
    "SELECT tb.account_id, tb.token_type, tb.balance AS cached, COALESCE(x.actual, 0) AS actual FROM token_balances tb " +
      "LEFT JOIN (SELECT account_id, token_type, SUM(delta) actual FROM (" +
      "  SELECT to_account account_id, token_type, amount delta FROM token_ledger " +
      "  UNION ALL SELECT from_account, token_type, -amount FROM token_ledger" +
      ") m GROUP BY account_id, token_type) x " +
      "ON x.account_id = tb.account_id AND x.token_type = tb.token_type " +
      "WHERE tb.balance <> COALESCE(x.actual, 0)",
  );
  for (const r of drift) problems.push(`cache drift ${r.account_id}/${r.token_type}: cached=${r.cached} actual=${r.actual}`);

  const allowNeg = Array.from(ALLOW_NEGATIVE_SOURCES);
  const [negatives] = await pool.query<RowDataPacket[]>(
    "SELECT tb.account_id, tb.token_type, tb.balance FROM token_balances tb " +
      "JOIN ledger_accounts a ON a.id = tb.account_id WHERE a.faucet = 0 AND tb.balance < 0 " +
      "AND NOT EXISTS (SELECT 1 FROM token_ledger t WHERE t.from_account = tb.account_id " +
      "AND t.token_type = tb.token_type AND t.source IN (?))",
    [allowNeg],
  );
  for (const r of negatives) problems.push(`non-faucet account ${r.account_id} is negative: ${r.balance} ${r.token_type}`);

  /*
   * The one the panel could not see. A gratitude row's id is the ledger
   * posting's `source_ref` on both doors — `give()` writes source
   * 'gratitude_received', the acknowledgement and heart flow writes
   * 'gratitude_received' or 'heart_received' — so the absence of the match is
   * the whole finding. Reported as a total and a sample rather than one line
   * per row, because a founder needs the size of the hole before its
   * inventory.
   *
   * IT JOINS ON `to_account` AS WELL, which is redundant to the answer and is
   * what makes the query cheap. `token_ledger` has no index on `source_ref`,
   * so matching on that column alone leaves the planner a choice between a
   * hash join and a scan of every 'gratitude_received' row per gratitude row.
   * It does have `token_ledger_to_idx (to_account, token_type)`, and the
   * recipient's account id is `mem:` + the note's `to_id` by construction
   * (`memberAccount`), so adding it turns each probe into that one member's
   * handful of rows. This check runs at every boot and on every load of the
   * founder's reconciliation panel; it has to stay cheap as the log grows.
   */
  const [lost] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n, COALESCE(SUM(g.amount), 0) AS units, MIN(g.id) AS first_id, MAX(g.at) AS last_at " +
      "FROM gratitude_log g LEFT JOIN token_ledger t " +
      "ON t.to_account = CONCAT('mem:', g.to_id) AND t.source_ref = g.id " +
      "AND t.source IN ('gratitude_received', 'heart_received') " +
      "WHERE t.id IS NULL AND g.amount > 0",
  );
  const lostCount = Number(lost[0]?.n ?? 0);
  if (lostCount > 0) {
    uncredited.push(
      `${lostCount} gratitude note(s) charged ${Number(lost[0].units)} and delivered nothing ` +
        `(earliest ${lost[0].first_id}, latest ${new Date(lost[0].last_at).toISOString()})`,
    );
  }

  return { ok: problems.length === 0, problems, uncredited };
}
