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
 *     On the shipped dials (the founder's ruling of 2026-10-23, "members keep
 *     their tokens") a leaver keeps every credit, Voice and equity balance,
 *     and only recognition moves, to sys:exit-settlement.
 *   - RESOLVE: refuses with the named blocking domains until clean. Then a
 *     leaver still holding value stays on as a FORMER MEMBER, account and
 *     balances intact, and anybody else meets the existing anonymize
 *     tombstone (`resolveExit`, server/lib/exitResolve.ts). Value rows are
 *     never deleted; conservation holds through every departure.
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
import { ownExitResolutions, setExitResolution, whileExitHeld } from "../repos/exitNotes";
import { abandonErasure, type AbandonedErasure } from "../repos/memberErasure";
import { recordEvent } from "./events";
import { isTombstone } from "./oauthAccounts";
import { openRedemptionCount } from "./redemptionStore";
import { liveSubscriptionsOf } from "../repos/productPurchases";
import { stripeConfigured } from "./payments";
import { cashWords, leftTheVillage, unpaidCashOf } from "./formerMember";
import { usersRepo } from "../repos/users";

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
  // A FORMER MEMBER ALREADY LEFT (the e2e sweep, E4). Their exit is resolved, and a second one opened a second
  // departure for somebody who has none to make. Admitting them again is the only way back, and a member who is
  // admitted again may leave again: `leftTheVillage` answers false from that moment.
  if (await leftTheVillage(pool, await usersRepo(pool).byId(input.userId))) return { ok: false, error: FORMER_MEMBER_EXIT };
  const id = `exit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const noticeEnds = input.noticeDays > 0 ? new Date(Date.now() + input.noticeDays * 24 * 3600 * 1000) : null;
  await pool.query(
    "INSERT INTO exits (id, user_id, kind, status, opened_by, notice_ends_at, resolution) VALUES (?,?,?,?,?,?,?)",
    [id, input.userId, input.kind, "open", input.openedBy, noticeEnds, input.note?.slice(0, 2000) ?? null],
  );
  return { ok: true, exit: (await exitById(pool, id))! };
}

/** Why no exit opens for a former member. */
export const FORMER_MEMBER_EXIT =
  "They already left the village and are a former member, so there is no departure to open. Admitting them again is the only way back.";

/** What the cancel route answers, status and body together. */
export interface CancelExitOutcome {
  status: number;
  body: Record<string, unknown>;
}

/** Why a cancel cannot close the departure once the account is closed. */
const ALREADY_CLOSED =
  "This account is already closed, so the departure cannot be undone. Finish the deletion from the review queue (/review).";

/**
 * A person who stays: the exit closes without a tombstone, and so does a
 * deletion its resolve began (round 2, finding 1).
 *
 * THE DEFECT. Resolving runs the erasure and only then marks the exit
 * resolved, so a sweep that stops before the tombstone (a portrait that will
 * not come off the volume, a dropped connection) leaves the exit open and the
 * admin's "They're staying" button on it. This used to flip the exit and
 * nothing else. The erasure record stayed open, holding the member's identity,
 * and Finish them on /review restarts every unfinished record from the top, so
 * the next steward to press it, clearing somebody else's stuck sweep, closed
 * the account of a member the village had decided keeps it.
 *
 * THE ORDER, so a cancel never succeeds while that record is still armed:
 *
 *   1. The exit must be open or settling, as before.
 *   2. An account that is already a tombstone cannot stay. The sweep finished
 *      or got past the close while the exit never reached "resolved".
 *   3. The record ends (`abandonErasure`, one conditional statement), unless
 *      it got past the tombstone or may still be running. Either refuses.
 *   4. Only then does the exit flip.
 *
 * WHAT A CANCEL CANNOT DO is put back what the stopped sweep already removed:
 * role holdings, org seatings, skill tags, agent tokens and the rest of the
 * steps before the close. The answer says so, with the steps, so the admin
 * keeping the member knows to restore them by hand.
 *
 * THE SAME FOR A FORMER-MEMBER RESOLVE THAT STOPPED PART WAY (round 4). That
 * path starts no erasure, so there was no record to read, and the cancel
 * closed the exit with the plain answer while the member's roles were already
 * gone. The resolve now writes a line onto the exit before each step it runs
 * (`resolveEndingLine`), and the answer lists those steps after the
 * erasure's, with the permission roles by id.
 *
 * ONE AT A TIME WITH RESOLVE (round 4). All of it runs inside the exit's row
 * hold (`whileExitHeld`, server/repos/exitNotes.ts), and so does every write
 * of a resolve that matters: a cancel that arrives mid-resolve waits for it,
 * and a resolve that arrives after a cancel reads 'cancelled' and stops
 * (`resolveExit`, server/lib/exitResolve.ts).
 */
export async function cancelExit(
  pool: Pool,
  exitId: string,
  deps: { memberById(id: string): Promise<any>; actorId: string | null },
): Promise<CancelExitOutcome> {
  return whileExitHeld(pool, exitId, async (hold): Promise<CancelExitOutcome> => {
    const userId = hold.exit.userId;
    if (!hold.exit.open || !userId) return { status: 404, body: { error: "No open exit with that id" } };
    const member = await deps.memberById(userId);
    if (member && isTombstone({ email: String(member.email ?? "") })) return { status: 409, body: { error: ALREADY_CLOSED } };
    const erasure = await abandonErasure(pool, userId);
    if (erasure.outcome === "closed") return { status: 409, body: { error: ALREADY_CLOSED } };
    if (erasure.outcome === "running") {
      return { status: 409, body: { error: "This member's account is being deleted right now. Try again in a few minutes." } };
    }
    if (!(await hold.cancel())) return { status: 404, body: { error: "No open exit with that id" } };
    if (erasure.outcome === "abandoned") {
      await recordEvent(pool, {
        kind: "audit",
        text: "member:erasure-abandoned:exit-cancelled",
        actorUserId: deps.actorId,
        entityType: "user",
        entityRef: userId,
        audience: "admin",
      });
    }
    return { status: 200, body: stayingAnswer(erasure, resolveEndingsIn(hold.exit.resolution)) };
  });
}

/** What "They're staying" says, given what a stopped deletion and a stopped resolve had already ended. */
function stayingAnswer(erasure: AbandonedErasure, endings: ResolveEndings): Record<string, unknown> {
  const removed = erasure.outcome === "abandoned" ? erasure.stepsDone : [];
  if (!removed.length && !endings.steps.length) return { success: true };
  const sentences = ["They're staying."];
  const lost = "do not come back on their own. Put back what they still need by hand.";
  if (removed.length) {
    sentences.push(
      endings.steps.length
        ? "The deletion that stopped had already removed some of what they held, such as their roles and skill tags."
        : `The deletion that stopped had already removed some of what they held, such as their roles and skill tags, and those ${lost}`,
    );
  }
  if (endings.steps.length) {
    sentences.push(`The resolve that stopped part way had already ended ${endedInWords(endings)}, and those ${lost}`);
  }
  return {
    success: true,
    message: sentences.join(" "),
    alreadyRemoved: [...removed, ...endings.steps.filter((s) => !removed.includes(s))],
    vacatedRoles: endings.roles,
  };
}

/**
 * The steps a former-member resolve runs before membership ends, in order,
 * named as the erasure names the same calls (`keepAsFormerMember`,
 * server/lib/exitResolve.ts). "role-applications" is the erasure's
 * `withdrawUnseatedOf`, which there runs inside a later step.
 */
export const FORMER_MEMBER_STEPS = [
  "alignment-party-left",
  "role-holdings",
  "org-seatings",
  "role-applications",
  "invitations",
  "subscriptions",
] as const;
export type FormerMemberStep = (typeof FORMER_MEMBER_STEPS)[number];

/** What each of those steps ends, as the admin reads it. */
const ENDED_IN_WORDS: Record<FormerMemberStep, (roles: readonly string[]) => string> = {
  "alignment-party-left": () => "their part in the aligned terms they were party to",
  "role-holdings": (roles) => (roles.length ? `their roles (${roles.join(", ")})` : "their roles"),
  "org-seatings": () => "their places on the org chart",
  "role-applications": () => "their open role applications",
  invitations: () => "their open invitation links",
  // Rye, 2026-10-31, ruling 8: a former member's exit cancels their recurring payments.
  subscriptions: () => "their recurring payments through Stripe",
};

/** What a resolve's record says it already began ending: each step once, and the permission roles by id. */
export interface ResolveEndings {
  steps: FormerMemberStep[];
  roles: string[];
}

/** The marker of a former-member resolve's record line, matched by `SETTLE_LINE`. */
const RESOLVE_ENDING_MARK = "resolve began ending";

const RESOLVE_ENDING_LINE = /^\[\d{4}-\d{2}-\d{2}\] resolve began ending: ([a-z-]+)(?: \((.*)\))?$/;

/**
 * One line of the record a former-member resolve keeps on the exit, written
 * BEFORE its step runs (round 4).
 *
 * Before, because nothing reads this line to skip work: a retried resolve runs
 * every step again, each one idempotent. What reads it is the cancel, telling
 * the admin what does not come back, and the direction that must never fail
 * there is leaving something out. A line written first and a step that then
 * died names a step that may have ended nothing; a step that ran and a line
 * that never landed would hide a role that is gone.
 *
 * It names no person, only a step and role ids, which is why an erasure keeps
 * it (`SETTLE_LINE`).
 */
export function resolveEndingLine(step: FormerMemberStep, roles: readonly string[], now: Date): string {
  const what = roles.length ? ` (${roles.join(", ")})` : "";
  return `\n[${now.toISOString().slice(0, 10)}] ${RESOLVE_ENDING_MARK}: ${step}${what}`.slice(0, 2000);
}

/** Every step and role a resolve's record lines name, in the order first written. A retry repeats lines, and they count once. */
export function resolveEndingsIn(resolution: string | null | undefined): ResolveEndings {
  const out: ResolveEndings = { steps: [], roles: [] };
  for (const line of String(resolution ?? "").split("\n")) {
    const m = RESOLVE_ENDING_LINE.exec(line);
    const step = FORMER_MEMBER_STEPS.find((s) => s === m?.[1]);
    if (!m || !step) continue;
    if (!out.steps.includes(step)) out.steps.push(step);
    for (const role of (m[2] ?? "").split(", ").filter(Boolean)) if (!out.roles.includes(role)) out.roles.push(role);
  }
  return out;
}

/** The steps a resolve's record names, as one phrase for the admin. */
export function endedInWords(endings: ResolveEndings): string {
  return endings.steps.map((s) => ENDED_IN_WORDS[s](endings.roles)).join(", ");
}

/**
 * A line the village's own acts append to `exits.resolution`: the settle
 * route's, as `sweepBalances` writes them, and resolve's, as `resolveExit`
 * writes the one naming what a former member still holds and the ones naming
 * each step it began (`resolveEndingLine`). None of them names the person,
 * which is why an erasure keeps them.
 */
const SETTLE_LINE = /^\[\d{4}-\d{2}-\d{2}\] (balances swept|exit policy applied|no balance moved|kept as a former member|resolve began ending): /;

/** What stands where a departed member's own note was. */
export const REMOVED_EXIT_NOTE = "[removed at member's request]";

/**
 * The erasure's exit step (server/lib/erasure.ts, "exit-notes-after-tombstone"):
 * the note a member typed when they opened their own departure goes, and the
 * record of leaving stays.
 *
 * `exits.resolution` holds two kinds of text. The opening note is the member's
 * own words ("Anything you want the stewards to know"), often about another
 * person. Every line after it is the settle route's, stamped and appended by
 * `sweepBalances`, and one of those lines is the split of record that
 * `capturedSplit` reads back. So the stamped lines are kept exactly, in order,
 * and everything else is replaced by one constant line.
 *
 * ONLY A DEPARTURE THE MEMBER OPENED (`opened_by` is them). On one a steward
 * opened, the note is the steward's account of the grounds, which is the
 * village's record of why it acted, and whether that goes with the member is a
 * decision this step does not make.
 *
 * Idempotent: the constant line is not a stamped line, so a second run finds
 * it, replaces it with itself, and writes nothing that differs.
 */
export async function forgetOwnExitNotes(pool: Pool, userId: string): Promise<number> {
  if (!userId) return 0;
  let changed = 0;
  for (const r of await ownExitResolutions(pool, userId)) {
    const lines = r.resolution.split("\n");
    const kept = lines.filter((l) => SETTLE_LINE.test(l));
    const hadWords = lines.some((l) => l.trim() !== "" && !SETTLE_LINE.test(l));
    const next = (hadWords ? REMOVED_EXIT_NOTE : "") + kept.map((l) => `\n${l}`).join("");
    if (next === r.resolution) continue;
    await setExitResolution(pool, r.id, next || null);
    changed += 1;
  }
  return changed;
}

/**
 * The per-member open-state enumeration. roleIds are passed in (the caller
 * owns role storage); everything else reads its domain's table directly.
 */
export async function exitOpenState(
  pool: Pool,
  userId: string,
  roleIds: string[],
  opts: { formerMember?: FormerMemberHold } = {},
): Promise<ExitDomainState[]> {
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
    // the `swept` figure the toast reports afterwards; both are human. The
    // second sentence says what the two acts do with it now that a leaver
    // keeps what they hold (the ruling of 2026-10-23).
    description: positive.length
      ? `holds ${positive.map(([t, v]) => `${fromLedgerUnits(t, v)} ${t}`).join(", ")}. Settled by the village's exit shares in an explicit admin act; while anything besides recognition is still held at resolve, the account stays on as a former member`
      : "nothing held",
    blocking: false,
  });

  // Cash the village still owes them (0285), `owed` or `claimed`. Never a
  // block: the platform moves no money, and a debt the village owes a leaver
  // is no reason to hold the leaver. It is the line that explains a resolve
  // keeping an account that holds no tokens (Rye, 2026-10-30; `resolveExit`).
  const owed = await unpaidCashOf(pool, userId);
  states.push({
    domain: "cash",
    count: owed.reduce((n, c) => n + c.rows, 0),
    description: owed.length
      ? `is owed ${cashWords(owed)} in cash the village has not paid yet. Unpaid cash keeps the account at resolve, so they stay on as a former member and can still sign in to see it marked paid`
      : "no cash owed",
    blocking: false,
  });

  states.push({
    domain: "roles",
    count: roleIds.length,
    description: roleIds.length
      ? `holds ${roleIds.join(", ")}. Roles vacate at resolution; hand off the work first`
      : "no roles held",
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

  states.push(await subscriptionsState(pool, userId, "exit", opts.formerMember));

  return states;
}

/**
 * How the exit path learns that resolving a departure keeps the account as a
 * former member, and why. SUPPLIED BY THE CALLER, from outside the
 * value-moving set (round 5): the answer lives in `resolveExit`'s rule
 * (server/lib/exitResolve.ts), and exitResolve imports the erasure and the
 * role-application repo, which reach the seat settings model. This file is
 * imported by the economy, so it may not import exitResolve, not even
 * lazily (shared/seatSettings.boundary.test.ts follows dynamic imports).
 * The routes that show the sentence pass `FORMER_MEMBER_HOLD` from
 * exitResolve.ts, which owns the rule and the reason phrase together.
 */
export interface FormerMemberHold {
  /** True when resolving this member's departure keeps them as a former member. */
  keptAsFormerMember: (pool: Pool, userId: string) => Promise<boolean>;
  /** What keeps them, opening the sentence: "Holding tokens, or being owed cash by the village,". */
  reason: string;
}

const EVERY: Record<"month" | "year", string> = { month: "every month", year: "every year" };

/**
 * The member's recurring payments, as a NOTICE the erasure acts on (round 3,
 * finding 5). The erasure's `product-subscriptions-after-tombstone` step
 * cancels each one in Stripe (server/lib/erasure.ts), and this line is how the
 * admin on the exit desk and the member before they confirm
 * (`GET /api/profile/leaving-notices`, server/routes/profile.ts) hear that
 * before the delete, in the same words.
 *
 * NEVER BLOCKING. Nothing in the app lets a member cancel a subscription
 * themselves, so a block here would leave a member unable to leave until a
 * steward found the subscription in Stripe. The erasure is the cancel.
 *
 * WITH NO STRIPE KEY THE ERASURE CANNOT CANCEL, and the sentence says who
 * will: the step asks the admins to cancel each one by hand in the Stripe
 * dashboard and finishes. Promising an automatic cancel there would tell the
 * member something this village cannot do.
 *
 * WHICH PATH IS ASKING (round 4, finding 1). "delete" is the delete-account
 * panel: a delete always erases, so the cancel sentence is true there. "exit"
 * is the exit desk and the departure page, and a departure is resolved by
 * `resolveExit` (server/lib/exitResolve.ts), which keeps a member who still
 * holds tokens, or whom the village still owes cash, as a former member
 * (Rye's ruling, #617; `keepsAsFormerMember`). That path ends their
 * membership and roles, and since Rye's ruling 8 of 2026-10-31 ("a former
 * member's exit cancels their subscriptions") it cancels their recurring
 * payments too, through the erasure's cancel and the same no-key hand-off
 * (the `subscriptions` step of `keepAsFormerMember`). So both outcomes
 * cancel, and the sentence differs only in what the admin presses: a member
 * kept that way reads that resolving the departure cancels them, and so does
 * the admin resolving them. A caller with no hold can promise the cancel too.
 */
export async function subscriptionsState(
  pool: Pool,
  userId: string,
  path: "delete" | "exit",
  formerMember?: FormerMemberHold,
): Promise<ExitDomainState> {
  const subs = await liveSubscriptionsOf(pool, userId);
  if (!subs.length) return { domain: "subscriptions", count: 0, description: "no recurring payments", blocking: false };
  const named = subs.map((s) => `${s.productName || "A product no longer listed"}${s.interval ? ` (${EVERY[s.interval]})` : ""}`);
  const renewing = `${subs.length} recurring payment(s) still renewing through Stripe: ${named.join(", ")}. `;
  // Which act cancels them. An exit-path caller with no hold cannot tell which
  // way the departure goes, and both ways cancel, so it names the resolve.
  const kept = path === "exit" && (!formerMember || (await formerMember.keptAsFormerMember(pool, userId)));
  const act = kept ? "resolving the departure" : "deleting the account";
  const formerLine = path === "exit" && formerMember && kept
    ? `${formerMember.reason} when the departure is resolved keeps the account as a former member. `
    : "";
  // Read only when there is something to cancel: the secrets store throws
  // until boot has loaded it, and every departure reads this domain.
  const cancel = stripeConfigured()
    ? `${act[0].toUpperCase()}${act.slice(1)} cancels each one in Stripe`
    : `Stripe is not connected to this village, so ${act} asks the admins to cancel each one by hand in Stripe`;
  return {
    domain: "subscriptions",
    count: subs.length,
    description: `${renewing}${formerLine}${cancel}, and nothing already paid is refunded`,
    blocking: false,
  };
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
 * WHAT THE SHIPPED DEFAULTS DO, pinned by `server/lib/exitDefaults.test.ts`.
 * Since the founder's ruling of 2026-10-23 the credit, Voice and equity shares
 * are 100 and Voice is kept, so those balances stay where they are and
 * nothing posts for them; recognition's share is still 0, so a recognition
 * balance moves in full to `sys:exit-settlement` under
 * `exit:<exitId>:sweep:<token>` with source `exit_settlement` and the
 * description "Balance settled at departure", which is the posting every
 * balance made before. Negative balances are still never swept and still
 * block resolve.
 */

/** Where a remainder may go. The four choices of `exit.remainder_account`. */
export type ExitRemainderAccount = "settlement" | "treasury" | "cycle-pool" | "burn";

/** The three answers of `exit.voice_on_exit`. `keep` is the shipped default since 2026-10-23. */
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
    // share it keeps has a second dial deciding its fate. `keep`, the default
    // since 2026-10-23, leaves the share in the account, and resolve then
    // keeps that account as a former member. `forfeit` sends the share with
    // everything else, which is what the dial's own description promises.
    // `convert` pays the share out as credits below, so it leaves this
    // account either way.
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
