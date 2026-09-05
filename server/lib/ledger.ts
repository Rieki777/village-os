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
   * Permit this post to drive a NON-FAUCET account below zero.
   *
   * THIS USED TO BE A BOOLEAN, AND A BOOLEAN PLUS A STRING WAS THE WHOLE
   * GATE. `{ source: "reversal", allowNegative: true }` from any caller at
   * all created member debt of any size, because `true` is a value anybody
   * can write and `"reversal"` is a value anybody can spell. An adversary
   * pass took an account holding 10 down to -990 through the ordinary public
   * primitive with no bypass anywhere.
   *
   * So the flag is now a CAPABILITY the ledger issues, not a claim a caller
   * makes: one of the three frozen `DebtProof` values below, checked by
   * IDENTITY, which no object literal can forge. The proof also names the
   * source it licenses and the two must agree, so a proof for a grace night
   * cannot be spent on a clawback.
   */
  allowNegative?: DebtProof;
}

/**
 * Permission to leave a member owing the village, issued by this module.
 *
 * THESE ARE NO LONGER EXPORTED, AND THAT IS THE WHOLE FIX. They used to be
 * three `export const`s, so the set of callers that could create debt was
 * every module under `server/` that cared to type an import. A closing proof
 * that wrote none of this code did exactly that: it imported `CLAWBACK_DEBT`,
 * `PAYMENT_REVERSAL_DEBT` and `GRACE_NIGHT_DEBT` into a test module and took
 * one account to -990, -990 and -777 through the ordinary public primitive,
 * and `checkLedgerInvariants` reported NOTHING in all three cases, because
 * the debit's own source is allow-negative and so raises the account's lawful
 * bound by exactly what it just took.
 *
 * Forgery was already closed by identity. BORROWING was wide open, and a
 * capability anybody may borrow is not a capability, it is a global.
 *
 * So the proof never leaves this module now. What leaves instead is the three
 * NARROW OPERATIONS below - {@link postGraceNightBurn},
 * {@link postPaymentReversalLeg} and {@link postClawbackMirror} - each of
 * which supplies its own proof internally and pins the `source` that proof
 * licenses. A caller can ask for the operation; it cannot ask for the
 * capability and then decide what to spend it on.
 *
 * The brand is a module-private symbol, so this interface cannot be
 * satisfied by a caller writing `{ reason: "reversal" }`, and the runtime
 * gate is identity against `ISSUED_DEBT_PROOFS` rather than shape, so a
 * caller who defeats the type system still gets nothing. Both of those stay:
 * an unexported value is still reachable through a mocked module or a
 * transpiler's namespace object, and identity is what makes that useless.
 */
declare const DEBT_PROOF_BRAND: unique symbol;
export interface DebtProof {
  /** The one `source` this proof licenses. Must equal the leg's `source`. */
  readonly reason: string;
  readonly [DEBT_PROOF_BRAND]: true;
}

const issueDebtProof = (reason: string): DebtProof => Object.freeze({ reason }) as unknown as DebtProof;

/** A stay night burnt inside the grace window (`server/lib/stays.ts`). */
const GRACE_NIGHT_DEBT: DebtProof = issueDebtProof("stay_night");
/** The mechanical leg after a refund or a chargeback (the payment handlers). */
const PAYMENT_REVERSAL_DEBT: DebtProof = issueDebtProof("payment_reversal");
/** The mirror `reverse()` posts against value a member already spent onward. */
const CLAWBACK_DEBT: DebtProof = issueDebtProof("reversal");

const ISSUED_DEBT_PROOFS: readonly DebtProof[] = Object.freeze([
  GRACE_NIGHT_DEBT,
  PAYMENT_REVERSAL_DEBT,
  CLAWBACK_DEBT,
]);

/** Identity, never shape: a forged literal is not one of these three objects. */
function isDebtProof(v: unknown): v is DebtProof {
  return ISSUED_DEBT_PROOFS.some((p) => p === v);
}

/**
 * A `Set` that cannot be added to, deleted from or cleared, ever.
 *
 * A PROXY RATHER THAN A SUBCLASS, and the difference is the whole point. A
 * subclass overriding `add` closes `set.add("spend")` and leaves
 * `Set.prototype.add.call(set, "spend")` working, which is one line further
 * for anyone who reads the class and decides to go around it. A Proxy has no
 * `[[SetData]]` internal slot of its own, so the borrowed-method form throws
 * `TypeError: Method Set.prototype.add called on incompatible receiver`
 * before it can do anything. Both spellings of the mutation fail, and the
 * comment above the keystone becomes a property of the program.
 *
 * Every other member goes through to the real Set, bound to it, because
 * `has`, `size`, `forEach` and the iterator all need the receiver that owns
 * the data: reading them off the proxy unbound is the same incompatible
 * receiver in the other direction. So `has`, `size`, `Array.from` and
 * `for...of` behave exactly as they did.
 */
export function frozenSet<T>(values: readonly T[]): ReadonlySet<T> {
  const inner = new Set<T>(values);
  const refuse = (verb: string) => () => {
    throw new TypeError(
      `this set is frozen: ${verb} is not available on it. Extending it is a reviewed edit to the ` +
        "declaration, never a runtime registration that can race a boot check",
    );
  };
  return new Proxy(inner, {
    get(target, prop, _receiver) {
      if (prop === "add" || prop === "delete" || prop === "clear") return refuse(String(prop));
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set: refuse("assignment"),
    defineProperty: refuse("defineProperty"),
    deleteProperty: refuse("property deletion"),
    /*
     * THE HOLE THE OTHER FIVE TRAPS LEFT, and it was the widest of them.
     *
     * `Object.setPrototypeOf(S, {has: () => true})` succeeded on the proxy
     * above: `setPrototypeOf` is its own internal method, so none of the
     * traps declared here saw it, and the default forwarded it to the inner
     * `Set`. After it, `S.has(anything)` answered whatever the planted
     * prototype said, `Array.from(S)` was EMPTY and `S.size` was `undefined`.
     * Both halves of the keystone read this object: the JS gate asks `has`,
     * and `checkLedgerInvariants` asks `Array.from`. So one line widened the
     * allow-negative gate to every source there is, and then emptied the list
     * the boot check builds its `IN (...)` from, which made the check throw a
     * SQL syntax error instead of reporting anything.
     *
     * Refusing it here makes the declaration's promise complete: this set has
     * one shape, one prototype and three members, from module load to exit.
     */
    setPrototypeOf: refuse("prototype replacement"),
  }) as ReadonlySet<T>;
}

/**
 * The only sources that may legally drive a non-faucet account negative (with
 * allowNegative set): stay-night burns inside the grace window, the mechanical
 * legs after a payment refund or dispute, and `reversal`, which is every
 * clawback `reverse()` posts.
 *
 * `reversal` is here because a clawback has to be able to FINISH against a
 * member who already spent what it takes back. Refusing it leaves the ledger
 * asserting a payment both parties know was undone, while -25 is simply what
 * the member now owes. `checkLedgerInvariants` reads this same set and exempts
 * an account holding a debit from one of these sources, so that balance is
 * lawful at boot rather than a refusal to serve.
 *
 * A negative balance is not a debt the platform collects. It is the honest
 * statement that this member holds less than nothing until new earnings bring
 * them back to zero, and the overdraft check below already refuses any further
 * spend that would take an account under water, so a member at -5 simply
 * cannot spend until they are back above it. It sits in the balance every
 * surface already reads, and not in a suspense account beside it, which is the
 * point: somebody has to be able to see it and ask.
 *
 * Static ON PURPOSE: extending it is a one-line reviewed change to the
 * keystone, not a runtime registration that can race the boot invariant check.
 *
 * IT USED TO BE AN ORDINARY `Set` BEHIND A `ReadonlySet` TYPE, WHICH IS A
 * CLAIM AND NOT A PROPERTY. `(ALLOW_NEGATIVE_SOURCES as Set<string>)
 * .add("spend")` widened the exemption at runtime and the boot check read the
 * widened set, so the same database was lawful or a refusal depending on when
 * the check ran: precisely the race the paragraph above says cannot happen.
 * `frozenSet` makes the sentence true. `Object.freeze` would not have:
 * `add` is a method on the prototype, not a property of the object, and a
 * frozen `Set` still accepts `.add`.
 *
 * The membership test is BYTE-EXACT and so is the SQL half of the gate now
 * (`CAST(source AS BINARY)` in `checkLedgerInvariants`). The two used to
 * disagree: `Set.has` refused `"REVERSAL"` while `source IN (...)` under a
 * case-insensitive PAD SPACE collation accepted it, so a variant spelling was
 * postable without the flag and then exempted an account at boot. One
 * equality now, and `validateLeg` refuses the near-miss spellings outright.
 */
export const ALLOW_NEGATIVE_SOURCES: ReadonlySet<string> = frozenSet(["stay_night", "payment_reversal", "reversal"]);

/**
 * The sources that ARE a clawback, and so may never be clawed back again.
 *
 * `reversal` is the mirror `reverse()` writes. `payment_reversal` is the leg
 * the refund and dispute handlers write after a bank has taken the money
 * back, and it is the one a key-prefix guard could never see, because those
 * postings are keyed `ord:<id>:reversal-leg1` and `pp:<id>:reversal:<period>`
 * - outside the `reversal:` namespace entirely. `stay_night` is not here:
 * a burnt grace night is a charge, and a charge can be undone.
 *
 * IT LIVES HERE NOW rather than in `server/lib/economy.ts`, because the rule
 * it expresses is enforced at the WRITE (see {@link clawbackRefusal}) and a
 * rule enforced in the ledger cannot read its definition out of a module that
 * imports the ledger. `economy.ts` imports this one, so there is one list.
 */
export const CLAWBACK_SOURCES: ReadonlySet<string> = frozenSet(["reversal", "payment_reversal"]);

/**
 * The mirror namespace, spelled once, byte-exact.
 *
 * `keys.reversal(v, K)` in `server/lib/economy.ts` builds `reversal:<esc(v)>:<K>`
 * and `esc` percent-encodes every colon, so the village segment can never
 * contain one and the ORIGINAL KEY IS EVERYTHING AFTER THE SECOND COLON. That
 * makes the derivation total and reversible without the ledger knowing what a
 * village id is, which is what lets the law below live down here.
 */
const REVERSAL_KEY_PREFIX = "reversal:";

/**
 * The posting a mirror key claims to undo, or null when the key is not a
 * well-formed mirror key.
 *
 * BYTE-EXACT ON THE PREFIX, unlike the namespace test in `validateLeg`, which
 * is deliberately case- and whitespace-insensitive because the UNIQUE index
 * is. The two are different questions: "does this key occupy the reserved
 * namespace" has to be as loose as the index, and "which posting does this
 * key name" has to be exact or the answer is a guess. A key that is in the
 * namespace loosely but not exactly names no original, so it is refused.
 */
function originalKeyOf(mirrorKey: string): string | null {
  if (!mirrorKey.startsWith(REVERSAL_KEY_PREFIX)) return null;
  const rest = mirrorKey.slice(REVERSAL_KEY_PREFIX.length);
  const cut = rest.indexOf(":");
  if (cut < 0) return null;
  const original = rest.slice(cut + 1);
  return original.length > 0 ? original : null;
}

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

  /*
   * ONE SPELLING PER KEYSTONE SOURCE, AND IT IS THE LOWERCASE ONE.
   *
   * `source` lands in a `varchar(64)` under a case-insensitive PAD SPACE
   * collation, so `"REVERSAL"`, `"reversal "` and `"ReVeRsAl"` are all the
   * same value to the SQL half of the allow-negative gate and none of them
   * is the same value to the JS half. An adversary tagged an account with a
   * one-unit `"REVERSAL"` debit — postable with no flag at all, because the
   * JS gate never saw it — and the boot check then exempted a -5000 balance
   * that had nothing to do with any reversal.
   *
   * A near-miss of a keystone source can only be a bug or an attack, so it
   * is refused here rather than normalised: normalising would write a value
   * the caller did not ask for into a column an auditor reads.
   */
  const folded = String(input.source ?? "").trim().toLowerCase();
  const canonical = ALLOW_NEGATIVE_SOURCES.has(folded) ? folded : null;
  if (canonical && input.source !== canonical) {
    return {
      error:
        `source ${JSON.stringify(input.source)} differs only in case or whitespace from the ` +
        `allow-negative source "${canonical}", and the ledger's collation cannot tell them apart. ` +
        `Post "${canonical}" exactly, or pick a source that is not one of these`,
    };
  }

  /*
   * THE `reversal:` KEY NAMESPACE BELONGS TO `reverse()`, BOTH WAYS.
   *
   * Forwards: anything keyed there must carry source `reversal`. Without
   * this, a mint under `keys.reversal(v, K)` made `isReversed(K)` true with
   * no reversal in existence, and the real clawback then reported success as
   * a duplicate while moving nothing.
   *
   * Backwards: source `reversal` must be keyed there. Without this, source
   * `reversal` was a string any caller could spell to reach the allow-
   * negative exemption from an ordinary posting. Binding the two means the
   * only way to create clawback debt is to write a mirror key, and a mirror
   * key is what `reverse()` derives from a row that exists.
   *
   * The prefix test is case- and whitespace-INSENSITIVE on purpose: the
   * UNIQUE index is, so `REVERSAL:local:x` occupies the same row as
   * `reversal:local:x` and must meet the same rule.
   */
  const key = input.idempotencyKey;
  const inReversalNamespace = /^\s*reversal:/i.test(key);
  if (inReversalNamespace && input.source !== "reversal") {
    return {
      error:
        `idempotency key ${JSON.stringify(key.slice(0, 60))} is in the reversal: namespace, ` +
        `which only reverse() may write: a posting there must carry source "reversal", not ` +
        `${JSON.stringify(input.source)}`,
    };
  }
  if (input.source === "reversal" && !inReversalNamespace) {
    return {
      error:
        `source "reversal" is reserved for the mirror reverse() derives, and a mirror is keyed ` +
        `"reversal:<village>:<original key>". This posting is keyed ` +
        `${JSON.stringify(key.slice(0, 60))}`,
    };
  }

  /*
   * THE PURE HALF OF THE CLAWBACK LAW. The half that needs a connection is
   * `clawbackRefusal`, which runs inside the transaction under the locks.
   *
   * Binding the source to the namespace was never the law; it was the
   * doorframe. A closing proof walked straight through the open door with
   * plain `postTransfer`, because the two rules above ask only how a key is
   * SPELLED and nothing about whether it names anything. Three losses, each
   * reproduced with `checkLedgerInvariants` returning an empty list:
   *
   *  - hand-posting the mirror of a swap's second leg reversed ONE leg of a
   *    live pair, and the member who had paid 100 ended holding nothing;
   *  - hand-posting `reversal:local:reversal:local:<K>` after a real clawback
   *    put the clawed-back 30 credits back on the member;
   *  - a FUNDED posting at `reversal:local:<K>` squatted the mirror key, so
   *    the real clawback hit the UNIQUE index and returned
   *    `{ok: true, duplicate: true}` while the victim kept everything.
   *
   * Two of the three are decidable with no read at all, so they are decided
   * here, before a transaction opens: the key must name an original exactly,
   * and that original must not itself be a mirror.
   */
  if (input.source === "reversal") {
    const original = originalKeyOf(key);
    if (original === null) {
      return {
        error:
          `a clawback mirror is keyed "reversal:<village>:<original key>" and ` +
          `${JSON.stringify(key.slice(0, 60))} names no original posting. The prefix is read ` +
          "byte for byte here: a key that only collates into the namespace names nothing",
      };
    }
    if (/^\s*reversal:/i.test(original)) {
      return {
        error:
          `a reversal cannot itself be reversed, and ${JSON.stringify(original.slice(0, 60))} is ` +
          "itself a mirror key. Post the correction as its own occurrence instead",
      };
    }
  }

  /*
   * The debt capability. Refused BEFORE any transaction opens, which is the
   * only refusal worth having: a caller who reaches this with `true`, with a
   * hand-built object, or with the wrong proof for its source moves nothing
   * and hears why.
   */
  if (input.allowNegative !== undefined) {
    if (!isDebtProof(input.allowNegative)) {
      return {
        error:
          "allowNegative is a capability the ledger issues, not a flag a caller sets: pass " +
          "GRACE_NIGHT_DEBT, PAYMENT_REVERSAL_DEBT or CLAWBACK_DEBT from server/lib/ledger",
      };
    }
    if (input.allowNegative.reason !== input.source) {
      return {
        error:
          `this debt proof licenses source "${input.allowNegative.reason}" and the posting ` +
          `carries source ${JSON.stringify(input.source)}`,
      };
    }
  }

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
 * WHAT A PAIR LEG IS, since no column says so.
 *
 * `postTransferPair` is the platform's both-or-neither primitive and the one
 * production caller is `executeSwap`, which keys its two legs
 * `ord:<orderId>:leg1` and `ord:<orderId>:leg2` with the same `source` and
 * the same `source_ref`. Nothing on the row records the pairing, and adding
 * a `pair_key` column is a migration, so this DERIVES it from the shape:
 *
 *   a posting is a pair leg when its key ends in `:leg1` or `:leg2` and a
 *   posting exists whose key is the same prefix with the other suffix and
 *   whose `source` is the same.
 *
 * The suffix alone is not enough and that is why the source is in it:
 * `ord:<orderId>:leg1` is ALSO the key of three ordinary single postings
 * (a fiat exchange settlement, a stay purchase, a manual stay purchase),
 * each of which has no sibling row and each of which stays reversible.
 * `ord:<id>:reversal-leg1` ends in `-leg1`, not `:leg1`, and is not matched.
 *
 * A CONFIRMED FALSE POSITIVE, KEPT ON PURPOSE, AND HERE IS THE REASONING.
 * Two genuinely single postings that happen to share a prefix and a source
 * under the two leg suffixes are read as a pair and refused. A closing proof
 * built that shape by hand and no shipped path produces it. It could be
 * narrowed by also requiring the two rows to share a `source_ref`, which
 * `executeSwap` does set identically on both legs - and narrowing it is the
 * wrong trade. Every condition added here makes FEWER things count as a pair,
 * which makes MORE single-leg reversals legal, which is the direction the
 * pair-dismantling loss lies in. The cost of the false positive is a refusal
 * a person can answer by posting the correction as its own occurrence; the
 * cost of a false negative is a member who paid for a swap keeping nothing.
 * So it fails closed, and this paragraph is the decision rather than a bug.
 *
 * It takes a `Pool` or a `PoolConnection` because the law below asks it
 * INSIDE the posting's own transaction, and `reverse()` asks it outside one
 * to give a better message before any transaction opens.
 *
 * Returns the sibling's key, so a refusal can name it.
 */
export async function pairSiblingKey(
  db: Pool | PoolConnection,
  key: string,
  source: string,
): Promise<string | null> {
  const m = /^(.*):leg([12])$/.exec(key);
  if (!m) return null;
  const sibling = `${m[1]}:leg${m[2] === "1" ? "2" : "1"}`;
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `idempotency_key` FROM `token_ledger` WHERE `idempotency_key` = ? AND `source` = ? LIMIT 1",
    [sibling, source],
  );
  // Byte-exact, like every other key read here: the collation would happily
  // hand back a different key that merely collates equal.
  return rows.some((r) => String(r.idempotency_key) === sibling) ? sibling : null;
}

/**
 * THE CLAWBACK LAW, WHERE THE CLAWBACK IS WRITTEN.
 *
 * `reverse()` derived its mirror from a row, checked that the row was not
 * itself a clawback, and checked that it was not one leg of a pair. Those
 * were three good rules living BESIDE the ledger instead of in it, and a
 * rule a call site can follow or skip is a rule with a door next to it. The
 * door was plain `postTransfer`: it wrote any row at all whose source was
 * `reversal` so long as the key started with `reversal:`, and asked nothing
 * else. Every one of the three rules was reproduced as a loss through it.
 *
 * So the rules move inside, and this is the whole of them. Five questions,
 * asked of the DATABASE and not of the caller:
 *
 *  1. the key names an original, and that original EXISTS, byte for byte;
 *  2. the original is not itself a clawback (`CLAWBACK_SOURCES`);
 *  3. this leg MIRRORS it: the two accounts swapped, the same token, the
 *     same minor amount. This is the one that ends the mirror-key squat.
 *     A squatter can no longer occupy the key with a one-unit posting to a
 *     third party, and a posting that satisfies this IS the reversal, so
 *     the real clawback reporting `duplicate: true` afterwards is telling
 *     the truth for the first time;
 *  4. the original is not already mirrored by some OTHER row;
 *  5. the original is not one leg of a pair, unless the other leg's mirror
 *     is being written in this same transaction.
 *
 * WHY IT RUNS HERE AND NOT IN A `TransferGuard`. The guard parameter is
 * optional, and a law a caller may decline to pass is the door again. This
 * runs unconditionally on every leg whose source is `reversal`, at exactly
 * the point the guard would have: after both accounts are locked FOR UPDATE
 * and before the row is written. That placement is what makes 4 and 5
 * decide-and-write in one atomic step - two concurrent mirrors of one
 * original touch the SAME two accounts, so they are already serialised by
 * the locks this function runs under, and the loser reads the winner's
 * committed row instead of the same stale answer.
 *
 * The reads are plain rather than `FOR UPDATE` ON PURPOSE. An exact-match
 * locking read on a UNIQUE index takes a GAP lock when the row is absent,
 * which would put a reversal in the way of unrelated postings whose keys
 * happen to sort nearby. What a stale snapshot can cost here is bounded and
 * one-directional: a just-committed original that this transaction cannot
 * yet see refuses a lawful reversal, which fails closed. A second mirror
 * cannot slip past, because it collides on the mirror key's own UNIQUE index.
 *
 * `siblingMirroredHere` is the original key of the OTHER leg of the same
 * `postTransferPair` call, when that leg is also a mirror. Null everywhere
 * else, including every single-leg post, which is what closes 5.
 */
async function clawbackRefusal(
  conn: PoolConnection,
  leg: TransferInput,
  tokenType: string,
  amount: number,
  siblingMirroredHere: string | null,
): Promise<string | null> {
  const original = originalKeyOf(leg.idempotencyKey);
  // `validateLeg` refuses a key that names no original before any of this
  // runs. Belt to that brace: a future caller of this function gets the same
  // answer rather than a crash.
  if (original === null) {
    return `a clawback mirror is keyed "reversal:<village>:<original key>" and ${JSON.stringify(leg.idempotencyKey.slice(0, 60))} names no original posting`;
  }

  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT `idempotency_key`, `source`, `from_account`, `to_account`, `token_type`, `amount` " +
      "FROM `token_ledger` WHERE `idempotency_key` = ? LIMIT 1",
    [original],
  );
  const row = rows[0];
  // BYTE-EXACT: `WHERE idempotency_key = ?` answers under a case-insensitive
  // PAD SPACE collation, so it happily returns a row whose key is NOT the one
  // the mirror names, and mirroring a row nobody asked about is the same
  // invention this law exists to stop.
  if (!row || String(row.idempotency_key) !== original) {
    return (
      `there is no posting keyed ${JSON.stringify(original.slice(0, 80))} to reverse, so this ` +
      "mirror reverses nothing. A clawback is derived from an exact posting or from nothing"
    );
  }

  const source = String(row.source);
  if (CLAWBACK_SOURCES.has(source)) {
    return (
      `${JSON.stringify(original.slice(0, 80))} is itself a clawback (source "${source}"), and ` +
      "reversing one restores value that was already taken back. Post the correction as its own occurrence instead"
    );
  }

  const wantFrom = String(row.to_account);
  const wantTo = String(row.from_account);
  const wantToken = String(row.token_type);
  const wantAmount = Number(row.amount);
  if (leg.from !== wantFrom || leg.to !== wantTo || tokenType !== wantToken || amount !== wantAmount) {
    return (
      `this clawback does not mirror ${JSON.stringify(original.slice(0, 80))}: the mirror of that ` +
      `posting is ${wantAmount} ${wantToken} from "${wantFrom}" to "${wantTo}", and this one is ` +
      `${amount} ${tokenType} from "${leg.from}" to "${leg.to}". A mirror is derived from the row, never invented`
    );
  }

  /*
   * ALREADY MIRRORED, asked by SHAPE and answered in JS.
   *
   * The mirror key's own UNIQUE index already makes at most one mirror per
   * (village segment, original key), and that is the enforcement; a replay of
   * the same key must still reach the INSERT and come back as a duplicate, so
   * this deliberately ignores the leg's own key. What it adds is the case the
   * index cannot see: a SECOND mirror of the same original under a different
   * village segment.
   *
   * The two indexed columns come first so `token_ledger_to_idx (to_account,
   * token_type)` narrows this to one account's rows before anything else is
   * read; the key comparison is done here rather than in SQL because the
   * original key can contain `%` (every builder percent-encodes) and a LIKE
   * over it would need escaping that a collation would then fold anyway.
   */
  const [mirrors] = await conn.query<RowDataPacket[]>(
    "SELECT `idempotency_key` FROM `token_ledger` " +
      "WHERE `to_account` = ? AND `token_type` = ? AND `from_account` = ? AND `amount` = ? " +
      "AND CAST(`source` AS BINARY) = 'reversal'",
    [leg.to, tokenType, leg.from, amount],
  );
  const already = mirrors
    .map((r) => String(r.idempotency_key))
    .find((k) => k !== leg.idempotencyKey && originalKeyOf(k) === original);
  if (already) {
    return (
      `${JSON.stringify(original.slice(0, 80))} has already been reversed by ` +
      `${JSON.stringify(already.slice(0, 80))}. Reversing it twice pays the same value back twice`
    );
  }

  const sibling = await pairSiblingKey(conn, original, source);
  if (sibling && sibling !== siblingMirroredHere) {
    return (
      `${JSON.stringify(original.slice(0, 80))} is one leg of an atomic pair whose other leg is ` +
      `keyed ${JSON.stringify(sibling)}. Reversing one leg alone dismantles the both-or-neither ` +
      "promise the pair exists for: a member who paid for a swap would keep nothing. " +
      "Reverse both legs in one paired post"
    );
  }

  return null;
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

  // The law, under the same lock, and NOT optional the way the veto above is.
  // A single leg mirrors nothing that has a sibling: that is question 5.
  if (input.source === "reversal") {
    const refusal = await clawbackRefusal(conn, input, tokenType, amount, null);
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
      /*
       * A DUPLICATE KEY IS NOT PROOF OF A REPLAY. The UNIQUE index runs
       * under a case-insensitive PAD SPACE collation, so
       * `quest.completed:local:q:c:usr-aB1` and `...usr-Ab1` are ONE row,
       * and so are a key and the same key with a trailing space. Reporting
       * the second one as a duplicate is reporting "already paid" about a
       * member who was never paid: `mint` returned ok, the balance did not
       * move, and nothing anywhere said so.
       *
       * So read the stored key back and compare BYTES. Equal, and this is a
       * genuine replay and the money already moved exactly once. Different,
       * and two distinct occurrences have collided on the index, which is a
       * key-shape bug the caller has to hear about rather than a payment to
       * skip. `keys` percent-encodes case and colons for exactly this
       * reason; this is the net under every hand-written key as well.
       */
      const [clash] = await conn.query<RowDataPacket[]>(
        "SELECT idempotency_key FROM token_ledger WHERE idempotency_key = ? LIMIT 1",
        [input.idempotencyKey],
      );
      const stored = clash[0] ? String(clash[0].idempotency_key) : null;
      if (stored !== null && stored !== input.idempotencyKey) {
        return {
          ok: false,
          duplicate: false,
          toBalance: 0,
          error:
            `idempotency key ${JSON.stringify(input.idempotencyKey)} collides with the already-posted ` +
            `key ${JSON.stringify(stored)}: the ledger's unique index cannot tell them apart. This is ` +
            "a second occurrence, so it was refused here and nobody was silently left unpaid",
        };
      }
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
  // `validateLeg` has already proved the capability and matched it to this
  // source, and it is one of the three the keystone set names, so holding a
  // proof at all IS the permission. The string is no longer consulted here:
  // one gate, one equality, decided before the transaction opened.
  const negativeAllowed = isDebtProof(input.allowNegative) && input.allowNegative.reason === input.source;
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

    /*
     * The clawback law, on whichever legs are mirrors, under the same lock.
     *
     * THIS IS THE ONLY PLACE QUESTION 5 CAN BE ANSWERED YES. A pair leg's
     * mirror is legal exactly when the other leg's mirror is written in the
     * same transaction, so each leg is told the ORIGINAL its neighbour is
     * undoing, and the law compares that to the sibling it derives from the
     * ledger. Two mirrors of two unrelated single postings are still fine:
     * neither has a sibling, so neither asks the question.
     */
    for (let i = 0; i < 2; i++) {
      if (legs[i].source !== "reversal") continue;
      const other = legs[1 - i];
      const neighbour = other.source === "reversal" ? originalKeyOf(other.idempotencyKey) : null;
      const refusal = await clawbackRefusal(conn, legs[i], meta[i].tokenType, meta[i].amount, neighbour);
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
      const [found] = await pool.query<RowDataPacket[]>(
        "SELECT idempotency_key FROM token_ledger WHERE idempotency_key IN (?, ?)",
        [legs[0].idempotencyKey, legs[1].idempotencyKey],
      );
      // BYTE-EXACT, for the reason the single-leg poster spells out: the
      // index folds case and pads spaces, so a row it returned here may be a
      // DIFFERENT key that merely collates equal, and counting it as one of
      // ours would call a collision a clean replay.
      const stored = found.map((r) => String(r.idempotency_key));
      const existing = stored.filter((k) => k === legs[0].idempotencyKey || k === legs[1].idempotencyKey);
      if (existing.length === 0 && stored.length > 0) {
        throw new Error(
          `idempotency keys ${JSON.stringify(legs[0].idempotencyKey)} / ` +
            `${JSON.stringify(legs[1].idempotencyKey)} collide with already-posted ` +
            `${JSON.stringify(stored)} under the unique index without matching them: ` +
            "these are different occurrences, and neither leg was written",
        );
      }
      if (existing.length === 2) return { ok: true, duplicate: true, balances: {} };
      if (existing.length === 1) {
        throw new Error(
          `partial idempotency collision on ${existing[0]}: keys from different orders have merged; refusing to complete`,
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

// ── The narrow doors that carry a debt proof ────────────────────────────────

/**
 * A leg for one of the three operations below, with the two fields the
 * OPERATION decides removed from it.
 *
 * `source` goes because the whole point is that the caller no longer picks
 * which debt it is creating: the function name is the choice, and it is made
 * at the import. `allowNegative` goes because it is not a caller's field any
 * more - there is no exported value that could be put in it.
 */
export type DebtLegInput = Omit<TransferInput, "source" | "allowNegative">;

/**
 * Burn one stay night inside the grace window, which may leave the member
 * owing (`server/lib/stays.ts` holds the grace floor, and checks it BEFORE
 * this posts: how far a member may go is a village dial, and the ledger does
 * not know about nights).
 */
export async function postGraceNightBurn(pool: Pool, input: DebtLegInput): Promise<TransferResult> {
  return postTransfer(pool, { ...input, source: "stay_night", allowNegative: GRACE_NIGHT_DEBT });
}

/**
 * The mechanical leg after a bank has taken money back - a refund or a
 * dispute - which may leave the member owing tokens they already spent.
 *
 * WHAT THIS DOES NOT CLOSE, said plainly, because the paragraph above the
 * proofs says the opposite about the clawback door and the difference
 * matters. A module that imports THIS can still create `payment_reversal`
 * debt of any size, because the ledger cannot check a chargeback: there is no
 * row in this database that a refund is derived from, the way a clawback is
 * derived from the posting it mirrors. What the narrowing buys is that the
 * capability is no longer a value anybody can hold and spend on anything: the
 * source is pinned, the operation is named for what it is, and the whole set
 * of modules that can create this debt is the import graph of this function.
 */
export async function postPaymentReversalLeg(pool: Pool, input: DebtLegInput): Promise<TransferResult> {
  return postTransfer(pool, { ...input, source: "payment_reversal", allowNegative: PAYMENT_REVERSAL_DEBT });
}

/**
 * The mirror that undoes one posting, against value the member may already
 * have spent onward.
 *
 * This is the door `reverse()` uses, and holding it buys nothing on its own:
 * {@link clawbackRefusal} derives everything about the row from the original
 * this key names, inside the transaction. A caller who calls this with an
 * invented shape gets the same refusal a caller who called `postTransfer`
 * directly would get, which is the point of putting the law in the ledger
 * rather than in front of it.
 */
export async function postClawbackMirror(pool: Pool, input: DebtLegInput): Promise<TransferResult> {
  return postTransfer(pool, { ...input, source: "reversal", allowNegative: CLAWBACK_DEBT });
}

/**
 * BOTH mirrors of an atomic pair, in one transaction, or neither.
 *
 * No debt proof, and that is not an oversight: `postTransferPair` refuses
 * `allowNegative` outright, because a swap may never create debt and undoing
 * a swap must not either. A member who has already spent what a swap gave
 * them cannot have it undone behind their back; the whole pair refuses and a
 * person settles it. That refusal is the honest one here, unlike a single
 * clawback, where the negative IS the truth.
 *
 * It exists as its own function anyway so the pair case has one door too, and
 * so `source` is pinned in the same place for both halves of the law.
 */
export async function postClawbackMirrorPair(
  pool: Pool,
  legs: [DebtLegInput, DebtLegInput],
  guard?: PairGuard,
): Promise<PairResult> {
  return postTransferPair(
    pool,
    [
      { ...legs[0], source: "reversal" },
      { ...legs[1], source: "reversal" },
    ],
    guard,
  );
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
 *  5. No non-faucet account is ILLEGALLY negative — a member may be in debt
 *     only as far as the ALLOW_NEGATIVE_SOURCES debits posted against them
 *     (grace-night burn, payment reversal, clawback) actually took, and a
 *     balance below the sum of those refuses boot however it got there.
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

  /*
   * INVARIANT 5, BOUNDED. It used to be an EXISTENCE test — `NOT EXISTS (...
   * source IN (allow-negative))` — and existence has no size, no window and
   * no ordering, so ONE one-unit clawback exempted an account from this
   * check forever, retroactively, at any magnitude. Two measured shapes: a
   * member whose 25 was reversed then went to -99925 through an ordinary
   * source and the report was empty; and a standing -4900 boot failure was
   * SILENCED by posting a single lawful 1-unit reversal after the fact.
   *
   * The bound is the arithmetic the exemption was always meant to express: a
   * member cannot be more in debt than the allow-negative legs took out of
   * them. Sum those debits for this account and this token, and a balance
   * below their negation is illegal however it got there. A genuine -25
   * after a reversal of a spent 25 still passes, because 25 is exactly what
   * the clawback took.
   *
   * `CAST(t.source AS BINARY)` because the column's collation folds case and
   * pads spaces: `IN ('reversal', ...)` matched a `"REVERSAL"` row that the
   * JS gate would never have accepted, so a variant spelling bought an
   * exemption the ledger never granted. Byte equality here is the same
   * equality `allowsNegative` applies on the write side.
   */
  /*
   * THE EMPTY LIST IS A SQL SYNTAX ERROR, so it is made unreachable twice.
   *
   * `IN (?)` with an empty array expands to `IN ()`, which MySQL refuses to
   * parse, and this check then THREW where it was supposed to report. A
   * closing proof reached that state by replacing the keystone set's
   * prototype, which made `Array.from` return nothing; `frozenSet` now traps
   * `setPrototypeOf`, so the set cannot be emptied at runtime at all. This
   * is the second lock: a list of N placeholders when there are N sources,
   * and the literal `NULL` when there are none, which is valid SQL that
   * matches nothing and reports every negative balance as unlawful. Failing
   * loud about every member beats failing silent about the check itself.
   */
  const allowNeg = Array.from(ALLOW_NEGATIVE_SOURCES);
  const allowNegList = allowNeg.length > 0 ? allowNeg.map(() => "?").join(",") : "NULL";
  const [negatives] = await pool.query<RowDataPacket[]>(
    "SELECT tb.account_id, tb.token_type, tb.balance, COALESCE(d.lawful, 0) AS lawful FROM token_balances tb " +
      "JOIN ledger_accounts a ON a.id = tb.account_id " +
      "LEFT JOIN (SELECT from_account, token_type, SUM(amount) AS lawful FROM token_ledger " +
      `WHERE CAST(source AS BINARY) IN (${allowNegList}) GROUP BY from_account, token_type) d ` +
      "ON d.from_account = tb.account_id AND d.token_type = tb.token_type " +
      "WHERE a.faucet = 0 AND tb.balance < 0 AND tb.balance < -COALESCE(d.lawful, 0)",
    allowNeg,
  );
  for (const r of negatives) {
    // The bound, said in the sentence: how far this account was allowed to go
    // and how far it went. ONE SHAPE rather than two branches, because an
    // account with no allow-negative debit at all is the lawful floor of zero
    // and reads correctly as one.
    const lawful = Number(r.lawful);
    const lawfulFloor = -lawful;
    problems.push(
      `non-faucet account ${r.account_id} is negative: ${r.balance} ${r.token_type}, and only ` +
        `${lawfulFloor} of that is lawful (its allow-negative debits total ${lawful})`,
    );
  }

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
