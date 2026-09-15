/**
 * Member exit (S52, F12 — "exit from the get-go"): openStateCheck semantics
 * applied to a PERSON. Blocks 5-7 created state that makes leaving painful
 * (loans, escrows, stays, orders, debts); this file makes departure a
 * first-class process before the community is big enough to need it.
 *
 * The shape mirrors module lifecycle exactly:
 *   - ENUMERATE: every domain reports the member's open state, with a
 *     blocking flag. Enumeration reads tables directly, regardless of
 *     module lifecycle — open state can predate a module being toggled.
 *   - SETTLE: each blocking domain resolves through ITS OWN terminal paths
 *     (settleLoan stays the single loan terminal; stays end by human act;
 *     orders resolve through the trio). Exit adds exactly ONE settlement
 *     move of its own: SPLITTING each POSITIVE balance into the share the
 *     leaver keeps and the share the village receives, idempotent per token.
 *     On the shipped dials the kept share is zero and the whole balance goes
 *     to sys:exit-settlement, which is the departure this platform has always
 *     had.
 *   - RESOLVE: refuses with the named blocking domains until clean, then
 *     the existing anonymize tombstone runs. Value rows are never deleted;
 *     conservation holds through every departure.
 *
 * The F12 hard rule, held as structure: a person is never the subject of a
 * consent decision in a general forum. Restorative content flows ONLY to
 * its recipients (notifications to the intake role); the exits row carries
 * a pointer (agreement_ref) and a status — never the content.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { CREDITS, faucetFor, fromLedgerUnits, toLedgerUnits } from "./economy";
import {
  balancesFor,
  CYCLE_POOL_FAUCET,
  memberAccount,
  postTransfer,
  postTransferPair,
  tokenDef,
  TREASURY,
} from "./ledger";
import { numberVar, stringVar } from "./variables";
import { tokenTypesPostedTo } from "../repos/tokenLedger";
import { openRedemptionCount } from "./redemptionStore";

/*
 * UNITS IN THIS FILE, stated once so no future sweep has to guess.
 *
 * `balancesFor` returns `token_balances.balance`, and `recomputeBalance`
 * (`server/lib/ledger.ts`) sets that column to a SUM over `token_ledger.amount`.
 * So every number this file reads from a balance is MINOR UNITS, at whatever
 * scale the token's `decimals` says, and `postTransfer` wants exactly those
 * units back. There is no human number anywhere on the posting path.
 *
 * That gives this file two rules that pull in opposite directions:
 *
 *   1. The POSTING in `sweepBalances` is already minor and must never be
 *      wrapped in `toLedgerUnits`. See the marker above it.
 *   2. Everything this file hands OUT to a person is a display surface and
 *      must be divided with `fromLedgerUnits`: the `swept` map, which is
 *      written verbatim into the permanent `exits.resolution` note and toasted
 *      to the admin, the CAPTURED SPLIT written beside it, and the two
 *      `description` sentences an admin reads on the exit desk before pressing
 *      Sweep.
 *
 *   3. The SPLIT ITSELF is computed in minor units and FLOORED, never rounded
 *      and never computed on the human number. `kept = floor(held * pct/100)`
 *      and `moved = held - kept`, in that order, so `kept + moved` is exactly
 *      the balance for every token at every scale and a rounding remainder can
 *      never exceed what the member holds.
 *
 * Rule 2 was already wrong for Village Voice when it carried a scale, before
 * any ruling: a member holding 0.5 voice was described as holding "50
 * village-voice" at the two decimals it carries now, and "500" at the three it
 * carried then. The defect is the missing division and never the number.
 */

export const EXIT_SETTLEMENT = "sys:exit-settlement";

export interface ExitDomainState {
  domain: string;
  count: number;
  description: string;
  /** True = resolve() refuses while this stands. */
  blocking: boolean;
}

export interface ExitRow {
  id: string;
  userId: string;
  kind: "voluntary" | "involuntary";
  status: "open" | "settling" | "resolved" | "cancelled";
  openedBy: string;
  noticeEndsAt: string | null;
  agreementRef: string | null;
  resolution: string | null;
  openedAt: string;
  resolvedAt: string | null;
}

function rowToExit(r: RowDataPacket): ExitRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    kind: r.kind,
    status: r.status,
    openedBy: String(r.opened_by),
    noticeEndsAt: r.notice_ends_at ? new Date(r.notice_ends_at).toISOString() : null,
    agreementRef: r.agreement_ref ?? null,
    resolution: r.resolution ?? null,
    openedAt: new Date(r.opened_at).toISOString(),
    resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
  };
}

export async function exitById(pool: Pool, id: string): Promise<ExitRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM exits WHERE id = ?", [id]);
  return rows[0] ? rowToExit(rows[0]) : null;
}

export async function allExits(pool: Pool): Promise<ExitRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM exits ORDER BY opened_at DESC LIMIT 200");
  return rows.map(rowToExit);
}

export async function openExitFor(pool: Pool, userId: string): Promise<ExitRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM exits WHERE user_id = ? AND status IN ('open','settling') LIMIT 1",
    [userId],
  );
  return rows[0] ? rowToExit(rows[0]) : null;
}

/**
 * One non-terminal exit per member: leaving is one conversation, not a
 * stack of tickets.
 */
export async function createExit(
  pool: Pool,
  input: { userId: string; kind: "voluntary" | "involuntary"; openedBy: string; noticeDays: number; note?: string | null },
): Promise<{ ok: true; exit: ExitRow } | { ok: false; error: string }> {
  const existing = await openExitFor(pool, input.userId);
  if (existing) return { ok: false, error: `An exit is already ${existing.status} for this member` };
  const id = `exit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const noticeEnds = input.noticeDays > 0 ? new Date(Date.now() + input.noticeDays * 24 * 3600 * 1000) : null;
  await pool.query(
    "INSERT INTO exits (id, user_id, kind, status, opened_by, notice_ends_at, resolution) VALUES (?,?,?,?,?,?,?)",
    [id, input.userId, input.kind, "open", input.openedBy, noticeEnds, input.note?.slice(0, 2000) ?? null],
  );
  return { ok: true, exit: (await exitById(pool, id))! };
}

/**
 * The per-member open-state enumeration. roleIds are passed in (the caller
 * owns role storage); everything else reads its domain's table directly.
 */
export async function exitOpenState(pool: Pool, userId: string, roleIds: string[]): Promise<ExitDomainState[]> {
  const states: ExitDomainState[] = [];

  const [[loans]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM library_loans WHERE user_id = ? AND settled_at IS NULL",
    [userId],
  );
  states.push({
    domain: "loans",
    count: Number(loans.n),
    description: `${loans.n} unsettled library loan(s). Settle each through its own terminal (return, cancel, expire, dispute)`,
    blocking: true,
  });

  const [[stays]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM stays WHERE user_id = ? AND status IN ('requested','active')",
    [userId],
  );
  const [[purchases]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM stay_purchases WHERE user_id = ? AND status IN ('pending','disputed')",
    [userId],
  );
  states.push({
    domain: "stays",
    count: Number(stays.n) + Number(purchases.n),
    description: `${stays.n} requested/active stay(s), ${purchases.n} pending/disputed purchase(s)`,
    blocking: true,
  });

  const [[orders]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM exchange_orders WHERE user_id = ? AND status IN ('pending','disputed')",
    [userId],
  );
  states.push({
    domain: "exchange",
    count: Number(orders.n),
    description: `${orders.n} pending/disputed exchange order(s)`,
    blocking: true,
  });

  // Tokens held against an open redemption sit outside the member's account,
  // so a refusal or an expiry after the sweep would hand them back to an
  // account nothing settles again, and resolve would tombstone it with them in.
  const redemptions = await openRedemptionCount(pool, userId);
  states.push({
    domain: "redemptions",
    count: redemptions,
    description: `${redemptions} open redemption(s). Each is withdrawn by the member, or confirmed or refused by whoever holds the key, before leaving`,
    blocking: true,
  });

  const balances = await balancesFor(pool, memberAccount(userId));
  const negative = Object.entries(balances).filter(([, v]) => v < 0);
  const positive = Object.entries(balances).filter(([, v]) => v > 0);
  states.push({
    domain: "debts",
    count: negative.length,
    // DISPLAY. `v` is minor units off `token_balances`; this sentence is read by
    // an admin on the exit desk and by the departing member in the 409 body of
    // both tombstone doors. `fromLedgerUnits` at the boundary, never a literal
    // divisor: the scale belongs to the registry.
    description: negative.length
      ? `owes ${negative.map(([t, v]) => `${fromLedgerUnits(t, -v)} ${t}`).join(", ")}. Resolve through the owning domain before leaving`
      : "no negative balances",
    blocking: true,
  });
  states.push({
    domain: "balances",
    count: positive.length,
    // DISPLAY, same reason as the debts line above. This is the number the
    // admin reads immediately before pressing Sweep, so it has to agree with
    // the `swept` figure the toast reports afterwards; both are human.
    description: positive.length
      ? `holds ${positive.map(([t, v]) => `${fromLedgerUnits(t, v)} ${t}`).join(", ")}. Swept to exit settlement by an explicit admin act`
      : "nothing held",
    blocking: false,
  });

  states.push({
    domain: "roles",
    count: roleIds.length,
    description: roleIds.length
      ? `holds ${roleIds.join(", ")}. Seats vacate at resolution; hand off the work first`
      : "no seats held",
    blocking: false,
  });

  const [[warnings]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM badge_awards a JOIN badges b ON b.id = a.badge_id " +
      "WHERE a.user_id = ? AND b.kind = 'warning' AND b.active = 1 AND (a.expires_at IS NULL OR a.expires_at > NOW())",
    [userId],
  );
  states.push({
    domain: "warnings",
    count: Number(warnings.n),
    description: Number(warnings.n) ? `${warnings.n} active warning badge(s): context for the conversation, not a gate` : "none",
    blocking: false,
  });

  return states;
}

export function blockingStates(states: ExitDomainState[]): ExitDomainState[] {
  return states.filter((s) => s.blocking && s.count > 0);
}

/*
 * ── THE SETTLEMENT READS THE DIALS (R4) ───────────────────────────────────
 *
 * R4, in the founder's words: "This exit policy can be many things, I think we
 * build some levers so that each village can create the policy that matters
 * for them." The ten levers are game variables in the `Exit` category of
 * `shared/gameVariables.ts`; five of them decide what a settlement DOES, and
 * this is where they are read.
 *
 * PER KIND, NEVER PER SLUG. The keep share is looked up by the token's `kind`
 * off the registry (`tokenDef(slug).kind`: recognition, equity, voice,
 * credit), for the reason `SENDABLE_KINDS` gives in `server/lib/spending.ts`:
 * a fork names its own tokens, and a slug allowlist would either refuse every
 * village's own credits or be edited by whoever wanted their token in it.
 *
 * THE TRAP, AND IT IS THE REASON THE SPLIT IS CAPTURED. The amount changes
 * with the dials and the idempotency key does not. A sweep that ran under one
 * policy, followed by a dial change, followed by a retry, is a DUPLICATE that
 * posts nothing, so the first split silently stands. That is correct: value
 * moves once. It is also invisible, unless the policy that actually applied is
 * written down at the moment it applies. So `sweepBalances` returns the split
 * it performed, the settle route appends it to `exits.resolution` beside the
 * dated line it already wrote, and `capturedSplit` reads it back. Every reader
 * prints THAT and never the live dial: a panel reading the dial after a
 * settled sweep tells an admin a number that did not happen.
 *
 * WHAT IS UNCHANGED, and pinned by `server/lib/exitDefaults.test.ts` against
 * `origin/main`'s own postings: on the shipped defaults (every share 0,
 * remainder `settlement`, cooling 0, Voice forfeit) each positive balance
 * moves in full to `sys:exit-settlement` under `exit:<exitId>:sweep:<token>`
 * with source `exit_settlement` and the description "Balance settled at
 * departure". Negative balances are still never swept and still block resolve.
 */

/** Where a remainder may go. The four choices of `exit.remainder_account`. */
export type ExitRemainderAccount = "settlement" | "treasury" | "cycle-pool" | "burn";

/** The three answers of `exit.voice_on_exit`. `keep` is refused at save time. */
export type ExitVoiceDisposition = "forfeit" | "keep" | "convert";

/** The five dials a settlement actually reads, resolved once per sweep. */
export interface ExitSplitPolicy {
  /** Keyed by the registry's KIND, never by a token slug. */
  keepPct: Record<string, number>;
  remainderAccount: ExitRemainderAccount;
  coolingDays: number;
  voiceOnExit: ExitVoiceDisposition;
  /**
   * RAW, as the registry stores it. A decimal string converts exactly through
   * `decimalRatio` below; parsing it to a float first is where a rate of 0.1
   * stops being a tenth.
   */
  voiceConvertRate: string;
}

/**
 * The live reading. The one impure function here, and the only place this file
 * touches the variables registry, so a test can hand `sweepBalances` a policy
 * and never load a single row.
 */
export function exitSplitPolicy(): ExitSplitPolicy {
  return {
    keepPct: {
      credit: numberVar("exit.keep_pct.credit"),
      voice: numberVar("exit.keep_pct.voice"),
      recognition: numberVar("exit.keep_pct.recognition"),
      equity: numberVar("exit.keep_pct.equity"),
    },
    remainderAccount: stringVar("exit.remainder_account") as ExitRemainderAccount,
    coolingDays: numberVar("exit.cooling_days"),
    voiceOnExit: stringVar("exit.voice_on_exit") as ExitVoiceDisposition,
    voiceConvertRate: stringVar("exit.voice_convert_rate"),
  };
}

/** One token's line in the split. HUMAN numbers, by rule 2 at the top. */
export interface ExitSplitLine {
  token: string;
  kind: string;
  /** What the member held when the sweep read the balance cache. */
  held: number;
  /** What is still in the member's hands in this token afterwards. */
  kept: number;
  /** What left, to the account named in `to`. `held` is `kept` plus `moved`. */
  moved: number;
  to: string;
  /** Convert only: the credits paid to the member for the converted share. */
  converted?: number;
  convertedTo?: string;
}

/** The policy that APPLIED, written onto the exit row at the moment it did. */
export interface ExitCapturedSplit {
  /** `exit.keep_pct.*`, by kind. */
  keep: Record<string, number>;
  to: ExitRemainderAccount;
  voice: ExitVoiceDisposition;
  rate: string;
  cooling: number;
  lines: ExitSplitLine[];
  /** Tokens whose posting was already on the books from an earlier sweep. */
  alreadySettled?: string[];
}

export interface ExitSweepResult {
  /** HUMAN, per token, and only what actually MOVED on this run. */
  swept: Record<string, number>;
  errors: string[];
  /** A sentence when the cooling period holds the settle, else null. */
  refusal: string | null;
  /** The policy this run READ. What applied is `captured`, which may be older. */
  policy: ExitSplitPolicy;
  /** The split of record: this run's when it moved value, else the earlier one. */
  captured: ExitCapturedSplit | null;
  /** The text the settle route appends to `exits.resolution`. */
  note: string;
  /** Tokens skipped because this same exit paid them TO the member. */
  paidOut: string[];
}

/** The marker the capture is written under, and the one `capturedSplit` reads. */
const SPLIT_MARK = "exit policy applied: ";

/**
 * A resolution note can hold many sweeps. The split of record is the LAST one
 * a sweep actually wrote, and a run that moved nothing writes no capture at
 * all, so a retry under changed dials cannot overwrite the split that happened.
 * Returns null when there is no capture or when the line will not parse, which
 * is the honest answer for a note that predates this lane.
 */
export function capturedSplit(resolution: string | null | undefined): ExitCapturedSplit | null {
  if (!resolution) return null;
  const marked = resolution.split("\n").filter((l) => l.includes(SPLIT_MARK));
  const last = marked[marked.length - 1];
  if (!last) return null;
  try {
    return JSON.parse(last.slice(last.indexOf(SPLIT_MARK) + SPLIT_MARK.length)) as ExitCapturedSplit;
  } catch {
    return null;
  }
}

const day = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The date this exit's balances may settle from, or null when nothing holds
 * them, which is `exit.cooling_days` at 0: the shipped default, and today.
 *
 * IT IS CAPPED AT `notice_ends_at`, and that is the only reader that column
 * has ever had. The save-time guard refuses a cooling period longer than the
 * notice the village PUBLISHES, but it judges the dial against the policy as
 * it stands on the day the dial is written, and an exit opened earlier carries
 * the notice date its member was told. Holding a balance past the date that
 * departure was promised is the same dishonesty the guard exists to prevent,
 * so the earlier of the two dates wins.
 *
 * THE TWO DATES ARE NOT ON THE SAME CLOCK, and the cap is the exact half.
 * `opened_at` is written by MySQL's `NOW()` in the database session's zone and
 * read back through a pool declaring `timezone: "Z"`, so `openedAt` runs the
 * session offset behind true UTC wherever that zone is not UTC; on the machine
 * this was measured on the gap was seven hours, so a fourteen-day cooling
 * period counted from it opens seven hours early. `notice_ends_at` is written
 * from a JS Date and is true UTC. That skew belongs to the column and to every
 * surface that prints an opened date, so it is stated here and not papered
 * over: what this function guarantees exactly is the upper bound.
 */
export function settlesFrom(exit: ExitRow, policy: ExitSplitPolicy): Date | null {
  if (!(policy.coolingDays > 0)) return null;
  const cooled = new Date(exit.openedAt).getTime() + policy.coolingDays * 24 * 3600 * 1000;
  const notice = exit.noticeEndsAt ? new Date(exit.noticeEndsAt).getTime() : null;
  return new Date(notice !== null && notice < cooled ? notice : cooled);
}

/** The sentence the settle act is refused with, naming the date, or null. */
export function coolingRefusal(exit: ExitRow, policy: ExitSplitPolicy, now: Date): string | null {
  const from = settlesFrom(exit, policy);
  if (!from || now.getTime() >= from.getTime()) return null;
  return `Balances on this exit settle from ${day(from)}. Today is ${day(now)}.`;
}

/**
 * The dials a sweep splits by: the exit's captured policy once one exists,
 * else the live reading. Cooling is always live, because it was already judged
 * before any split. A capture missing a field falls back to the live value.
 */
function policyOfRecord(earlier: ExitCapturedSplit | null, live: ExitSplitPolicy): ExitSplitPolicy {
  if (!earlier) return live;
  return {
    keepPct: earlier.keep ?? live.keepPct,
    remainderAccount: earlier.to ?? live.remainderAccount,
    coolingDays: live.coolingDays,
    voiceOnExit: earlier.voice ?? live.voiceOnExit,
    voiceConvertRate: earlier.rate ?? live.voiceConvertRate,
  };
}

/** The account a remainder goes to. Null means burn with nowhere to burn to. */
function destinationFor(where: ExitRemainderAccount, token: string): string | null {
  if (where === "treasury") return TREASURY;
  if (where === "cycle-pool") return CYCLE_POOL_FAUCET;
  if (where === "burn") return faucetFor(token);
  // Anything else is `settlement`, which is where a departure goes today. A
  // dial holding a value this build does not know settles as it always has.
  return EXIT_SETTLEMENT;
}

/**
 * A decimal STRING as an exact fraction. "2.5" is 25/10 and "0.1" is 1/10,
 * which `Number("0.1")` is not: a rate multiplied through binary floating
 * point pays a member one minor unit less than the arithmetic they were shown.
 * Anything that is not a plain decimal reads as zero, and a zero rate converts
 * nothing (the save-time guard refuses that pairing anyway).
 */
function decimalRatio(raw: string): { num: bigint; den: bigint } {
  const m = /^(\d*)(?:\.(\d+))?$/.exec(String(raw ?? "").trim());
  if (!m) return { num: BigInt(0), den: BigInt(1) };
  const frac = m[2] ?? "";
  return { num: BigInt((m[1] || "0") + frac), den: BigInt("1" + "0".repeat(frac.length)) };
}

const scale = (decimals: number): bigint => BigInt("1" + "0".repeat(Math.max(0, decimals)));

/**
 * Minor units of Voice to minor units of credits, in BigInt so a large balance
 * at a fine scale cannot lose the low digits, and FLOORED by the division.
 */
function convertedMinor(voiceMinor: number, rate: string, voiceDecimals: number, creditDecimals: number): number {
  const { num, den } = decimalRatio(rate);
  if (num === BigInt(0)) return 0;
  return Number((BigInt(Math.trunc(voiceMinor)) * num * scale(creditDecimals)) / (den * scale(voiceDecimals)));
}

/** The share of one kind a leaver keeps, clamped to the range the dial declares. */
function keepPctFor(policy: ExitSplitPolicy, kind: string): number {
  const raw = Number(policy.keepPct[kind]);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw >= 100 ? 100 : raw;
}

/**
 * The ONE settlement move exit owns: split every POSITIVE balance per the
 * village's dials, leave the kept share where it is, and post the remainder to
 * the account the village chose. Idempotent per (exit, token): a double click
 * or a crash-retry posts nothing twice. Negative balances are never touched
 * here, because a debt resolves through the domain that created it.
 *
 * THE EXIT ROW IS READ HERE AND NOT PASSED IN, so the cooling period cannot be
 * skipped by a caller that did not know about it. The same read carries the
 * earlier capture, which is what a retry reports instead of inventing one.
 *
 * WHAT THIS EXIT ALREADY PAID THE MEMBER IS NEVER SWEPT BACK. A Voice
 * conversion credits the leaver, and a second settle would otherwise take a
 * share of those same credits away again under a fresh idempotency key. Every
 * token this exit has posted TO the member is skipped, and named in `paidOut`.
 *
 * UNITS. What is POSTED is minor, read straight off the balance cache and
 * handed back unchanged. What is RETURNED in `swept` and written into the
 * capture is HUMAN, divided once at the boundary, because both consumers show
 * it to a person. The two are deliberately different, and a change that makes
 * them the same is a bug in one direction or the other.
 */
export async function sweepBalances(
  pool: Pool,
  input: { exitId: string; userId: string; policy?: ExitSplitPolicy; now?: Date },
): Promise<ExitSweepResult> {
  const policy = input.policy ?? exitSplitPolicy();
  const now = input.now ?? new Date();
  const exit = await exitById(pool, input.exitId);
  const nothing = (refusal: string | null): ExitSweepResult => ({
    swept: {},
    errors: [],
    refusal,
    policy,
    captured: capturedSplit(exit?.resolution),
    note: "",
    paidOut: [],
  });
  if (!exit) return nothing("This exit no longer exists, so there is nothing to settle.");
  const waiting = coolingRefusal(exit, policy, now);
  if (waiting) return nothing(waiting);
  // The settle waits for open redemptions, for the reason `exitOpenState` gives:
  // tokens handed back after this sweep would replay its keys and never move.
  const openRedemptions = await openRedemptionCount(pool, input.userId);
  if (openRedemptions > 0) {
    return nothing(
      `This member has ${openRedemptions} open redemption(s). Each is withdrawn, confirmed or refused before their balances settle.`,
    );
  }

  const account = memberAccount(input.userId);
  const balances = await balancesFor(pool, account);
  const back = await tokenTypesPostedTo(pool, input.exitId, account);
  const paidOut = back.map((r) => String(r.token_type));

  /*
   * A RETRY FINISHES THE SPLIT THE FIRST SETTLE DECIDED, AND NEVER SPLITS WHAT
   * IS LEFT. Measured: Voice kept at 50 on convert, 1000 held, a treasury short
   * of credits. The first settle posted the 500 remainder and the conversion
   * pair was refused, so the member held 500. A retry that split those 500
   * again kept 250, found the remainder key already used, converted 250 and
   * stranded 250 Voice for the tombstone.
   *
   * So once an exit carries a capture, the capture decides: its dials, and
   * each captured token's `held`, which is what the first split was taken
   * from. The postings keep their keys, so what already moved replays as a
   * duplicate and only the missing half posts, at its original size. `policy`
   * in the result stays the live reading, which is what the run READ.
   */
  const earlier = capturedSplit(exit.resolution);
  const applied = policyOfRecord(earlier, policy);

  const swept: Record<string, number> = {};
  const errors: string[] = [];
  const lines: ExitSplitLine[] = [];
  const alreadySettled: string[] = [];
  let posted = false;

  for (const [token, amount] of Object.entries(balances)) {
    if (amount <= 0) continue;
    if (paidOut.includes(token)) continue;

    const def = tokenDef(token);
    const kind = def?.kind ?? "";
    const name = def?.name ?? token;
    // HUMAN in the capture, MINOR here: the captured figure was divided from
    // a whole number of minor units, so multiplying it back is exact.
    const frozen = earlier?.lines?.find((l) => l.token === token);
    const held = frozen ? toLedgerUnits(token, frozen.held) : amount;
    const share = Math.floor((held * keepPctFor(applied, kind)) / 100);

    // Voice is the one holding that is also standing in the village, so the
    // share it keeps has a second dial deciding its fate. `forfeit` is today:
    // the share goes with everything else, which is what the dial's own
    // description promises. `keep` cannot arrive, because the write guard
    // refuses it, and is honoured here anyway: a value that predates a guard
    // is still what the village holds. `convert` pays the share out as
    // credits below, so it leaves this account either way.
    const voice = kind === "voice";
    const forfeits = voice && applied.voiceOnExit === "forfeit";
    const converts = voice && applied.voiceOnExit === "convert" && share > 0;
    const kept = forfeits || converts ? 0 : share;
    const moved = held - kept;

    const to = destinationFor(applied.remainderAccount, token);
    if (!to) {
      // The same sentence `ruleCannotPay` and the save-time guard already use
      // for this fact, because it is the same fact.
      errors.push(`${name} has no faucet, so there is nowhere to burn it back to.`);
      continue;
    }

    const line: ExitSplitLine = {
      token,
      kind,
      held: fromLedgerUnits(token, held),
      kept: fromLedgerUnits(token, kept),
      moved: fromLedgerUnits(token, moved),
      to,
    };

    // The remainder: everything that leaves except a converted Voice share.
    const remainder = moved - (converts ? share : 0);
    if (remainder > 0) {
      const r = await postTransfer(pool, {
        from: account,
        to,
        tokenType: token,
        // ALREADY MINOR. DO NOT CONVERT. `amount` came off
        // `token_balances.balance`, which is a SUM over `token_ledger.amount`,
        // and `postTransfer` writes it back into that same column. Both ends
        // of the round trip are the ledger, so there is no human number here
        // to convert FROM. Wrapping this in `toLedgerUnits` multiplies a
        // departing member's whole settlement by 10^decimals: 10,000x once
        // every token is at 4.
        //
        // This is also why the conversion cannot live inside `postTransfer`.
        // The second witness for the same shape is the voice claim debit at
        // `server/lib/voiceClaim.ts`, which reads the same column.
        amount: remainder,
        source: "exit_settlement",
        sourceRef: input.exitId,
        description: "Balance settled at departure",
        idempotencyKey: `exit:${input.exitId}:sweep:${token}`,
      });
      if (!r.ok) {
        errors.push(`${token}: ${r.error}`);
        continue;
      }
      if (r.duplicate) {
        // The key carries no policy, so this posting stands exactly as it was
        // first made. Saying so is the whole point: the split of record is the
        // captured one, and this run changed nothing.
        alreadySettled.push(token);
      } else {
        posted = true;
        // HUMAN out. The posting above moved `remainder` minor units; what a
        // person reads about it is that number divided by the token's scale.
        swept[token] = fromLedgerUnits(token, remainder);
      }
    }

    if (converts) {
      const credit = tokenDef(CREDITS);
      if (!credit) {
        errors.push(`${token}: this village has no ${CREDITS} token to convert into.`);
      } else {
        const paid = convertedMinor(share, applied.voiceConvertRate, def?.decimals ?? 0, credit.decimals);
        if (paid <= 0) {
          errors.push(`${token}: this rate pays nothing on that share, so no Voice was converted.`);
        } else {
          /*
           * ONE PAIR, TWO LEGS, BOTH OR NEITHER. A half-finished conversion
           * leaves a departing member holding neither their Voice nor the
           * credits it was promised for, and `postTransferPair` is the
           * primitive that cannot produce that state. The keys are distinct
           * per leg for the same reason: a retry of one can never be read as
           * the other, and the pair itself refuses two identical keys.
           *
           * THE CREDITS COME FROM THE TREASURY and never from a faucet. A
           * faucet leg would be ISSUANCE: `postTransferOn` runs
           * `issuanceRefusal` on any faucet source, and each faucet's negative
           * balance IS that token's issued supply, so paying a leaver out of
           * one would print credits at a departure and change what the Mint
           * panel's number means. Paying from the treasury spends what the
           * village already holds, and a treasury that cannot cover it refuses
           * the whole pair instead of overdrawing.
           */
          const pair = await postTransferPair(pool, [
            {
              from: account,
              to,
              tokenType: token,
              amount: share,
              source: "exit_settlement",
              sourceRef: input.exitId,
              description: "Voice converted at departure",
              idempotencyKey: `exit:${input.exitId}:convert:${token}`,
            },
            {
              from: TREASURY,
              to: account,
              tokenType: CREDITS,
              amount: paid,
              source: "exit_settlement",
              sourceRef: input.exitId,
              description: "Credits for Voice converted at departure",
              idempotencyKey: `exit:${input.exitId}:convert-credit:${token}`,
            },
          ]);
          if (!pair.ok) {
            errors.push(`${token}: ${pair.error}`);
          } else if (pair.duplicate) {
            alreadySettled.push(`${token} conversion`);
          } else {
            posted = true;
            swept[token] = (swept[token] ?? 0) + fromLedgerUnits(token, share);
            line.converted = fromLedgerUnits(CREDITS, paid);
            line.convertedTo = CREDITS;
          }
        }
      }
    }

    lines.push(line);
  }

  /*
   * WHEN A CAPTURE IS WRITTEN, and why a retry must not write one.
   *
   * A run that posted something records the policy that moved it. A run that
   * posted nothing records nothing, so the earlier capture stays the split of
   * record and a dial changed in between cannot rewrite history. The one
   * exception is a village whose dials keep everything: nothing posts, nothing
   * was already settled, and no earlier capture exists, so this run IS the
   * first application of a policy and says so.
   */
  const record = posted || (!earlier && alreadySettled.length === 0 && lines.length > 0);
  const capture: ExitCapturedSplit = {
    keep: applied.keepPct,
    to: applied.remainderAccount,
    voice: applied.voiceOnExit,
    rate: applied.voiceConvertRate,
    cooling: applied.coolingDays,
    // Bounded on purpose: `exits.resolution` is TEXT and every sweep appends.
    // A village holding more tokens than this reads the rest off the ledger.
    lines: lines.slice(0, 40),
    ...(alreadySettled.length ? { alreadySettled } : {}),
  };
  const stamp = `\n[${day(now)}] `;
  const note = (
    `${stamp}balances swept: ${JSON.stringify(swept)}` +
    (record
      ? `${stamp}${SPLIT_MARK}${JSON.stringify(capture)}`
      : `${stamp}no balance moved: ${
          alreadySettled.length
            ? "this exit was already settled under the policy recorded above"
            : "nothing was outstanding"
        }`)
  ).slice(0, 8000);

  return { swept, errors, refusal: null, policy, captured: record ? capture : earlier, note, paidOut };
}
