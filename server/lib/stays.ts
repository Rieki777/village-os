/**
/**
 * Stays v1 (S30-S31): accommodation paid in STAY CREDITS — a real platform
 * token, minted and burned through the same postTransfer discipline as
 * everything else. Stays owns ZERO ledger DDL:
 *
 *   buy/earn:  sys:mint  → mem:guest   (stay_purchase, stay_comp,
 *                                       quest_stay_reward, stay_manual_override)
 *   one night: mem:guest → sys:mint    (stay_night; allowNegative inside the
 *                                       grace window — debt is a visible
 *                                       negative balance, never a hidden tab)
 *
 * Outstanding credit supply = -balanceOf(sys:mint, 'stay-credit'), for free.
 *
 * Rate + audience are SNAPSHOT at activation: catch-up posting after a server
 * nap is deterministic, and a price edit mid-stay never silently re-rates a
 * guest (an admin re-rates explicitly, which re-snapshots).
 *
 * Stays are NEVER auto-ended: running out of credits stops the posting and
 * alerts humans; ending a stay is a human act about a human situation.
 *
 * ── 0092: A NIGHT CAN ALSO BE PAID IN THE VILLAGE'S OWN CREDITS ──────────────
 *
 * The relationship between the two is EITHER ACCEPTED, never a rate. A room
 * posts a price per token and a stay is activated in exactly one of them, which
 * is snapshot beside the rate in `rate_snapshot_token`. Nothing converts.
 *
 * A conversion is the one shape that had to be refused, and it is worth writing
 * down because it is the obvious design. "Buy stay credits with village
 * credits" would take a token issued by the cycle-pool faucet and turn it into
 * a token that is also sold for money at /api/stays/checkout. That is a path
 * from a faucet-issued token into a purchased one, which is the taint rule the
 * exchange enforces from the other direction, reached by a side door. A choice
 * of currency at the door creates no such path: the two tokens never touch, and
 * the ledger sees two independent burns.
 *
 * Everything else about a night is unchanged, deliberately, because the grace
 * window is already correct and it is the same window whichever token pays:
 * `stay_night` stays the source, `allowNegative` stays on inside grace, and
 * `checkLedgerInvariants` already asks its negative-balance question per
 * (account, token), so a member in grace on credits is legal for exactly the
 * same reason a member in grace on stay credits is.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { decimalsFor, finerThanScale, fromLedgerUnits, toLedgerUnits } from "./economy";
import { CURRENCY_DECIMALS } from "../../shared/tokenScale";
import { ledgerEntryExists, MINT_FAUCET, memberAccount, postGraceNightBurn, postTransfer, registerToken, tokenDef } from "./ledger";
import { spendSinkFor } from "./spending";
import { numberVar } from "./variables";

export const STAY_CREDIT = "stay-credit";

/** The one non-token row `accommodation_prices` accepts. Its amounts are cents. */
export const USD = "usd";

/**
 * Boot registration, unconditional (like the accounts the ledger is born
 * knowing): the token exists even while the module is off, so a quest's
 * stay-credit reward can post and simply wait for the module to open.
 * Re-asserted every boot — transferable:false is policy, not a default.
 */
export async function ensureStayToken(pool: Pool): Promise<void> {
  const existing = tokenDef(STAY_CREDIT);
  if (existing && existing.transferable === false) return;
  await registerToken(pool, {
    slug: STAY_CREDIT,
    name: "Stay Credits",
    kind: "credit",
    governance: "platform",
    transferable: false,
    /*
     * A CREDIT TOKEN IS CURRENCY-LIKE, so it carries the currency scale from
     * the day it is created. This is stated here and not left to
     * `registerToken`'s whole-unit default because a FRESH village would
     * otherwise create this token at 0 while a migrated one holds 2, and
     * `registerToken` leaves `decimals` out of its upsert on purpose, so
     * nothing would ever reconcile the two. The migration that rescaled the
     * existing rows is the other half of this line.
     */
    decimals: CURRENCY_DECIMALS,
  });
}

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface AccommodationRow {
  id: string;
  name: string;
  description: string | null;
  capacity: number;
  photoUrl: string | null;
  active: boolean;
  sortOrder: number;
  /**
   * A standing example. The admin panel needs it to label the row and take the
   * controls off: the edit and price routes refuse an example, and a founder
   * should learn that from the row rather than from a 409 after typing rates.
   */
  isExample: boolean;
  /**
   * Posted prices: { "stay-credit": {guest, member}, usd: {guest, member} }.
   * usd is CENTS and every token is HUMAN units, fractions included (2.5 is two
   * and a half credits), which is what the two screens that read this expect. The stored column is minor on both sides;
   * `priceFromStored` is the one place that difference lives.
   */
  prices: Record<string, { guest?: number; member?: number }>;
}

export interface StayRow {
  id: string;
  userId: string;
  accommodationId: string;
  status: "requested" | "active" | "ended" | "cancelled";
  arriveOn: string | null;
  autopay: boolean;
  rateSnapshotCredits: number | null;
  /**
   * WHICH token that rate is in, snapshot at the same moment for the same
   * reason. Defaults to stay credits at the column level, so every stay that
   * existed before 0092 pays exactly what it paid yesterday.
   */
  rateSnapshotToken: string;
  audienceSnapshot: "guest" | "member" | null;
  lastPostedOn: string | null;
  notes: string | null;
  createdAt: string;
}

const toIsoDate = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

function rowToStay(r: RowDataPacket): StayRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    accommodationId: String(r.accommodation_id),
    status: r.status,
    arriveOn: toIsoDate(r.arrive_on),
    autopay: !!r.autopay,
    rateSnapshotCredits: r.rate_snapshot_credits == null ? null : Number(r.rate_snapshot_credits),
    rateSnapshotToken: String(r.rate_snapshot_token ?? STAY_CREDIT),
    audienceSnapshot: r.audience_snapshot ?? null,
    lastPostedOn: toIsoDate(r.last_posted_on),
    notes: r.notes ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

// ── Catalog ──────────────────────────────────────────────────────────────────

/*
 * THE POSTED-PRICE BOUNDARY.
 *
 * `accommodation_prices.amount_minor` carries two units in one column, decided
 * by `token_type`: a usd row holds cents, and a token row holds that token's
 * MINOR units. The column was honest for usd and misnamed for tokens, because
 * the admin form posts cents for usd (client/src/pages/Admin.tsx scales by 100)
 * and the raw typed number for every token.
 *
 * These two functions are that boundary, and they are the whole of lane E's
 * write-side fix. Storing a token price in MINOR units is what makes `priceFor`,
 * `stays.rate_snapshot_credits`, the grace floor in `postNightsForStay` and
 * `nightsRemaining` read the same unit as the balance they are measured
 * against. Converting at the nightly post instead would fix the debit and leave
 * the stop condition and the nights-left figure comparing a minor balance to a
 * human rate.
 *
 * `toLedgerUnits` and `fromLedgerUnits` read the registry at call time, and
 * both are load-bearing now. Since 0202 every platform credit token, stay
 * credits included, carries 2 decimals, so a token row here is scaled by 100
 * on the way in and divided by 100 on the way out. Only a token still at
 * `decimals: 0` passes through unchanged.
 *
 * 0202 needed no backfill of this column or of `stays.rate_snapshot_credits`,
 * and that is a fact about 0202, not a rule: its guard refused to move any token
 * that already stored an amount in either table (`accommodation_prices` and
 * `stays` are both in its list), so every row it could have corrupted was
 * proven absent first. A LATER change to a token's decimals rescales both
 * columns, and needs that backfill or the same guard.
 */

/**
 * A posted price on its way IN: human for a token, cents for usd. EXACT.
 *
 * It floored, so 2.5 credits posted as 2 and a room could not ask for a
 * fraction its token holds. It converts at the token's own scale now, and the
 * route asks `priceScaleRefusal` first, so a price finer than the token holds is
 * refused in words and never rounded here.
 */
export function priceToStored(tokenType: string, amount: number): number {
  const n = Number(amount) || 0;
  return tokenType === USD ? Math.round(n) : toLedgerUnits(tokenType, n);
}

/**
 * Why a posted price cannot be stored exactly, or null when it can.
 *
 * `finerThanScale` is the same check the hand-mint and the redemption ask use.
 * usd arrives as cents, so a usd amount must be a whole number of cents.
 */
export function priceScaleRefusal(tokenType: string, amount: number): string | null {
  const n = Number(amount);
  if (tokenType === USD) {
    return finerThanScale(n, 0) ? `A dollar price is posted in whole cents, so ${n} cents cannot be posted exactly. Nothing was posted` : null;
  }
  const decimals = decimalsFor(tokenType);
  if (!finerThanScale(n, decimals)) return null;
  const name = tokenDef(tokenType)?.name ?? tokenType;
  return decimals > 0
    ? `${name} goes to ${decimals} decimal places, so a price of ${n} cannot be posted exactly. Nothing was posted`
    : `${name} is priced in whole amounts, so a price of ${n} cannot be posted exactly. Nothing was posted`;
}

/** A stored price on its way OUT to a screen: the inverse of `priceToStored`. */
export function priceFromStored(tokenType: string, stored: number): number {
  return tokenType === USD ? Number(stored) : fromLedgerUnits(tokenType, Number(stored));
}

export async function listAccommodations(pool: Pool, opts?: { includeInactive?: boolean }): Promise<AccommodationRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, description, capacity, photo_url, active, sort_order, is_example FROM accommodations ${opts?.includeInactive ? "" : "WHERE active = 1 "}ORDER BY sort_order, name`,
  );
  const [prices] = await pool.query<RowDataPacket[]>(
    "SELECT accommodation_id, token_type, audience, amount_minor FROM accommodation_prices WHERE active = 1",
  );
  const byAcc = new Map<string, Record<string, { guest?: number; member?: number }>>();
  for (const p of prices) {
    const acc = byAcc.get(String(p.accommodation_id)) ?? {};
    const tok = acc[String(p.token_type)] ?? {};
    // The catalog is a READING surface: Stay.tsx and the admin price form both
    // treat a token price as the human number of credits and only divide usd
    // by 100. Handing them the stored minor number would also break the admin
    // form's round trip, which reads this map and posts it straight back.
    tok[p.audience as "guest" | "member"] = priceFromStored(String(p.token_type), Number(p.amount_minor));
    acc[String(p.token_type)] = tok;
    byAcc.set(String(p.accommodation_id), acc);
  }
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    description: r.description ?? null,
    capacity: Number(r.capacity ?? 1),
    photoUrl: r.photo_url ?? null,
    active: !!r.active,
    sortOrder: Number(r.sort_order ?? 0),
    isExample: Number(r.is_example ?? 0) === 1,
    prices: byAcc.get(String(r.id)) ?? {},
  }));
}

/**
 * The posted price for one audience, with the member→guest fallback: a room
 * that posts no member row simply has one price for everyone.
 *
 * Returns MINOR units: cents for `usd`, ledger units for a token. Every
 * consumer of this number is arithmetic against a balance or a ledger post
 * (checkout, the activation snapshot, the manual purchase), so it is the
 * stored column and not the screen figure. Use `priceFromStored` for a screen.
 */
export async function priceFor(
  pool: Pool,
  accommodationId: string,
  tokenType: string,
  audience: "guest" | "member",
): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT audience, amount_minor FROM accommodation_prices WHERE accommodation_id = ? AND token_type = ? AND active = 1",
    [accommodationId, tokenType],
  );
  const byAud = new Map(rows.map((r) => [String(r.audience), Number(r.amount_minor)]));
  return byAud.get(audience) ?? byAud.get("guest") ?? null;
}

// ── Stays ────────────────────────────────────────────────────────────────────

export async function stayById(pool: Pool, id: string): Promise<StayRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM stays WHERE id = ?", [id]);
  return rows[0] ? rowToStay(rows[0]) : null;
}

export async function staysForUser(pool: Pool, userId: string): Promise<StayRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    // created_at is second-granular, so two stays booked in the same second have
    // no defined order under it alone. id breaks the tie, which makes this a TOTAL
    // comparator: the same rows always come back in the same order, in every process.
    "SELECT * FROM stays WHERE user_id = ? ORDER BY created_at DESC, id DESC",
    [userId],
  );
  return rows.map(rowToStay);
}

export async function allStays(pool: Pool): Promise<StayRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM stays ORDER BY created_at DESC, id DESC",
  );
  return rows.map(rowToStay);
}

/**
 * floor(balance / snapshot rate); the ONLY derived "nights left" there is.
 *
 * BOTH arguments are MINOR units of the same token. `balance` comes from
 * `balanceOf`/`balancesFor`, and `rateCredits` from `stays.rate_snapshot_credits`,
 * which `priceToStored` now writes in minor. Feeding it a human rate against a
 * minor balance reports 10,000x too many nights at four decimals, which is the
 * number a steward acts on.
 */
export function nightsRemaining(balance: number, rateCredits: number | null): number {
  if (!rateCredits || rateCredits <= 0) return 0;
  return Math.floor(balance / rateCredits);
}

// ── Nightly posting ──────────────────────────────────────────────────────────

/** UTC date arithmetic, no Date-timezone traps. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The nights this stay owes as of `todayUtc` (exclusive — tonight isn't over):
 * every date from the morning after arrival/activation through yesterday that
 * has not yet been posted. Deterministic from the row alone, so a server that
 * slept a week posts seven keyed legs and lands in exactly the same state.
 */
export function nightsOwed(stay: StayRow, todayUtc: string): string[] {
  if (stay.status !== "active" || !stay.rateSnapshotCredits) return [];
  const start = stay.lastPostedOn ? addDays(stay.lastPostedOn, 1) : (stay.arriveOn ?? stay.createdAt.slice(0, 10));
  const nights: string[] = [];
  for (let d = start; d < todayUtc; d = addDays(d, 1)) {
    nights.push(d);
    if (nights.length >= 366) break; // runaway guard: a year of catch-up means something else is wrong
  }
  return nights;
}

export interface PostNightsResult {
  posted: number;
  stopped: boolean;
  /** Balance after the last successful post. */
  balance: number;
}

/**
 * Post every owed night for one stay, each keyed `stay:{id}:night:{date}`.
 * Grace policy: a night may take the balance down to -(grace_nights × rate);
 * past that the posting STOPS (the stay stays active — ending it is a human
 * act) and the caller alerts humans.
 */
export async function postNightsForStay(pool: Pool, stay: StayRow, todayUtc: string): Promise<PostNightsResult> {
  // ALREADY MINOR, and posted unconverted on purpose. `rate_snapshot_credits`
  // is snapshot from `priceFor`, which reads the column `priceToStored` writes,
  // so the rate, the grace floor below, the balance read and `nightsRemaining`
  // are all in this token's ledger units. Wrapping this in `toLedgerUnits`
  // would charge a night ten thousand nights' worth.
  const rate = stay.rateSnapshotCredits ?? 0;
  // The token this stay was activated in, and the account a spend of it lands
  // in. One snapshot read, so a night cannot be charged in one token and
  // credited to another token's sink.
  const token = stay.rateSnapshotToken || STAY_CREDIT;
  const sink = spendSinkFor(token);
  const owed = nightsOwed(stay, todayUtc);
  const graceFloor = -(Math.max(0, numberVar("stay.grace_nights")) * rate);
  const readBalance = async (): Promise<number> => {
    const [b] = await pool.query<RowDataPacket[]>(
      "SELECT balance FROM token_balances WHERE account_id = ? AND token_type = ?",
      [memberAccount(stay.userId), token],
    );
    return Number(b[0]?.balance ?? 0);
  };
  let posted = 0;
  let balance = await readBalance();
  for (const night of owed) {
    // Grace is checked BEFORE the post: a night may land the balance anywhere
    // down to -(grace_nights × rate), never past it.
    if (balance - rate < graceFloor) return { posted, stopped: true, balance };
    // The source and the debt capability belong to the operation now, not to
    // this call: `GRACE_NIGHT_DEBT` was an exported value any module could
    // import and spend on any posting at all, so the ledger stopped exporting
    // it and exports this narrow door instead. The grace FLOOR stays here,
    // checked one line above: how far a member may go is a village dial and
    // the ledger knows nothing about nights.
    const result = await postGraceNightBurn(pool, {
      from: memberAccount(stay.userId),
      to: sink,
      tokenType: token,
      amount: rate,
      sourceRef: stay.id,
      description: `Night of ${night}`,
      idempotencyKey: `stay:${stay.id}:night:${night}`,
    });
    if (!result.ok) return { posted, stopped: true, balance };
    // toBalance is the RECEIVING side (the faucet); re-read the payer.
    balance = await readBalance();
    if (!result.duplicate) posted += 1;
    await pool.query("UPDATE stays SET last_posted_on = ? WHERE id = ?", [night, stay.id]);
  }
  return { posted, stopped: false, balance };
}

/**
 * The scheduler job body + the admin catch-up button: sweep every active
 * autopay stay. Runs hourly; acts only once the UTC hour reaches
 * stay.autopay_post_hour (forced=true skips the hour check — that's the
 * admin button). Idempotent keys make overlapping runs harmless.
 */
export async function runNightlyPosting(
  pool: Pool,
  opts: {
    forced?: boolean;
    now?: Date;
    onLowBalance?: (stay: StayRow, nightsLeft: number) => Promise<void>;
    onStopped?: (stay: StayRow, balance: number) => Promise<void>;
  } = {},
): Promise<{ swept: number; posted: number; stopped: number }> {
  const now = opts.now ?? new Date();
  if (!opts.forced && now.getUTCHours() < Math.max(0, Math.min(23, numberVar("stay.autopay_post_hour")))) {
    return { swept: 0, posted: 0, stopped: 0 };
  }
  const todayUtc = now.toISOString().slice(0, 10);
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM stays WHERE status = 'active' AND autopay = 1",
  );
  let posted = 0;
  let stopped = 0;
  for (const row of rows.map(rowToStay)) {
    const r = await postNightsForStay(pool, row, todayUtc);
    posted += r.posted;
    if (r.stopped) {
      stopped += 1;
      if (opts.onStopped) await opts.onStopped(row, r.balance);
    } else if (r.posted > 0 && opts.onLowBalance) {
      const left = nightsRemaining(r.balance, row.rateSnapshotCredits);
      if (left <= numberVar("stay.low_balance_warn_nights")) await opts.onLowBalance(row, left);
    }
  }
  return { swept: rows.length, posted, stopped };
}

// ── Credit movements (all through the ledger, all keyed) ────────────────────

/**
 * Mint stay credits to a member.
 *
 * `amount` is MINOR units, the same contract `postTransfer` states, and this
 * function converts nothing. That is a decision and not an oversight: two of
 * its four callers already hand it a minor number derived from `priceFor`
 * (`server/routes/stays.ts` manual purchase, and the Stripe settle handler at
 * `server/index.ts`, both by way of `stay_purchases.credits_granted`). A
 * `toLedgerUnits` in here would multiply those a second time, which on a token
 * sold for money is a ten-thousand-fold over-mint.
 *
 * The two callers that hold a HUMAN number convert at their own boundary: the
 * comp route and the adjust route in `server/routes/stays.ts`, and the quest
 * work-exchange release in `server/index.ts`.
 */
export async function mintStayCredits(
  pool: Pool,
  input: { userId: string; amount: number; source: string; sourceRef?: string; description?: string; idempotencyKey: string },
) {
  return postTransfer(pool, {
    from: MINT_FAUCET,
    to: memberAccount(input.userId),
    tokenType: STAY_CREDIT,
    amount: input.amount,
    source: input.source,
    sourceRef: input.sourceRef,
    description: input.description,
    idempotencyKey: input.idempotencyKey,
  });
}

/**
 * The stays counterpart to the exchange's abandoned-checkout reaper.
 *
 * A card purchase inserts its row as `pending` BEFORE the Stripe session
 * opens, so every closed tab leaves one behind and nothing ever cleared it —
 * and `staysOpenState` below counts pending purchases, so one abandoned
 * checkout could keep the module permanently un-disableable and hold a
 * departing member in the village. Same two rules as the exchange reaper:
 *
 *  - Never touch a row whose ledger leg exists. Credits moved means it was
 *    paid whatever the row says; that is a settle bug to report, not an
 *    abandonment to cancel.
 *  - Wait longer than Stripe will (~24h of session life), enforced by the
 *    shared floor in code rather than trusted to whoever edits the variable.
 *
 * Scoped to provider='stripe': manual and Zeffy rows are reconciled by a
 * steward by hand and can legitimately sit pending for days.
 */
export async function releaseAbandonedStayPurchases(
  pool: Pool,
  expiryHours: number,
  floorHours: number,
): Promise<{ released: number; skipped: string[] }> {
  if (expiryHours <= 0) return { released: 0, skipped: [] };
  const hours = Math.max(floorHours, Math.floor(expiryHours));
  const [stale] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM stay_purchases WHERE provider = 'stripe' AND status = 'pending' " +
      "AND created_at < (NOW() - INTERVAL ? HOUR)",
    [hours],
  );
  let released = 0;
  const skipped: string[] = [];
  for (const row of stale) {
    const id = String(row.id);
    if (await ledgerEntryExists(pool, `ord:${id}:leg1`)) {
      skipped.push(id);
      continue;
    }
    await pool.query("UPDATE stay_purchases SET status = 'cancelled' WHERE id = ? AND status = 'pending'", [id]);
    released += 1;
  }
  return { released, skipped };
}

/** Open economic state that blocks disabling the module (invariant #13). */
export async function staysOpenState(pool: Pool): Promise<{ count: number; description: string }> {
  const [[s]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM stays WHERE status IN ('requested','active')",
  );
  const [[p]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM stay_purchases WHERE status IN ('pending','disputed')",
  );
  const stays = Number(s.n);
  const purchases = Number(p.n);
  return {
    count: stays + purchases,
    description: `${stays} requested/active stay(s), ${purchases} pending/disputed purchase(s)`,
  };
}
