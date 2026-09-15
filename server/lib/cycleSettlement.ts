/**
 * SETTLING A MOON, AS ONE ROUTINE WITH TWO HALVES.
 *
 * This is the body of `POST /api/admin/cycles/close`, moved out of
 * server/index.ts unchanged in what it does and split where it was already
 * split in spirit. It moved because a second caller arrived: a settlement
 * ballot that the village passes has to settle the same moon the same way, and
 * the alternative was two routines that both decide what a moon is worth.
 * server/lib/applyDue.ts has the sentence for why that is never allowed —
 * "Two routines that both decide that question disagree eventually" — and the
 * disagreement here would be a member paid one number by the button and a
 * different number by the vote.
 *
 * ── THE TWO HALVES, AND WHY THE SPLIT IS LOAD-BEARING ────────────────────────
 *
 * `freezeCycleSplit` works out what every member is owed and WRITES IT DOWN,
 * moving nothing. `payFrozenCycle` reads what was written down and moves it.
 *
 * That split already existed inside the close, as the "sticky split": persist
 * the whole computed split before any value moves, then post from what was
 * persisted, so a close that crashed halfway could not re-split a pool that was
 * already partly out the door. Naming the two halves is what lets a THIRD
 * caller — the proposal — use the first without the second.
 *
 * This is the property that makes the settlement ballot honest. The proposal
 * freezes the split, and the document the village reads is rendered from those
 * rows. When the ballot lands, the payment reads the same rows. So the numbers
 * a member voted on are the numbers a member is paid, and a founder moving
 * `gratitude.pool_per_cycle` while the vote is open cannot change what the vote
 * was about. A ballot whose subject is recomputed at execution is a ballot on
 * an estimate.
 *
 * ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────────
 *
 * It does not land governance. The close route calls `applyDueGovernance` after
 * this returns and still does; that is the route's own second errand and it is
 * not part of settling a moon. Calling it from here would also be re-entrant on
 * the ballot path, where this code is already running INSIDE the landing job.
 */
import type { Pool } from "mysql2/promise";

import { evaluateEarnedBadges, badgeById } from "./badges";
import { recordEvent } from "./events";
import {
  dueCycles,
  settleCycle,
  unreadableCycleProblem,
  type CycleRecord,
  type DistributionRecord,
} from "./gratitude-cycles";
import { snapshotCycle, thresholdAlerts, type CloseStageSource } from "./health";
import { toLedgerUnits } from "./economy";
import { latestSettlementRefusals } from "../repos/settlementBallots";
import { CYCLE_POOL_FAUCET, memberAccount, postTransfer, tokenDef } from "./ledger";
import { effectiveLifecycle } from "./modules";
import { cyclePoolProblem } from "./cyclePool";
import { numberVar, stringVar } from "./variables";

/** What the settlement needs that only server/index.ts can hand it. */
export interface SettlementDeps {
  getPool(): Pool;
  cyclesRepo: { all(): Promise<CycleRecord[]>; upsert(record: CycleRecord): Promise<unknown> };
  /**
   * `reversedIds` is the set of gifts that were undone. The settlement leaves them
   * out (main, 31f6e59), and a vote must pay on the same reading the button pays on.
   */
  gratitudeRepo: { all(): Promise<any[]>; reversedIds(): Promise<Set<string>> };
  distributionsRepo: {
    all(): Promise<DistributionRecord[]>;
    add(record: DistributionRecord): Promise<unknown>;
  };
  /** The Sybil filter: whose recognition may decide a share of real value. */
  eligibleSenderIds(): Promise<Set<string>>;
  notify(input: {
    userId: string;
    type: string;
    title: string;
    body?: string | null;
    link?: string | null;
    dedupeKey: string;
  }): Promise<unknown>;
  notifyAdmins(type: string, title: string, dedupeKey: string): Promise<void>;
  /** `mergedConfig().currency.nameLower`, so the notices read in the village's words. */
  currencyNameLower(): string;
  /**
   * The allowance multiplier each member held at close, handed to
   * `snapshotCycle` as its stage source. REQUIRED on purpose: without it the
   * three allowance snapshots are simply not written, which health.ts treats as
   * unknown, so a caller that forgot it would lose them with no error anywhere.
   */
  stageMultiplierFor: CloseStageSource["stageMultiplierFor"];
}

/** The pool this village releases per moon, read once so a run cannot straddle a change. */
export interface PoolSetting {
  size: number;
  token: string;
}

export function poolSettingNow(): PoolSetting {
  return { size: numberVar("gratitude.pool_per_cycle") as number, token: String(stringVar("gratitude.pool_token")) };
}

/**
 * THE ONE SHARE FORMULA.
 *
 * It was written out three times — in the close, in the pending preview, and
 * it would have been a fourth time in the proposal document. Three copies of
 * `Math.floor((received / total) * pool)` is three chances for a preview to
 * promise what a payment does not pay. `floor` keeps the remainder in the pool
 * rather than minting dust, which is the rule the close has always held.
 */
export function shareOf(receivedEligible: number, totalEligible: number, poolSize: number): number {
  if (!(poolSize > 0) || !(totalEligible > 0)) return 0;
  return Math.floor((receivedEligible / totalEligible) * poolSize);
}

/**
 * WORK OUT WHAT THIS MOON OWES, AND WRITE IT DOWN. NOTHING MOVES.
 *
 * Idempotent by construction: `distributionsRepo.add` is add-if-absent and the
 * row id is `dist-<cycleNumber>-<userId>`, so a second freeze of the same moon
 * finds the first one's numbers and returns them unchanged. That is what makes
 * it safe for the proposal to freeze and for the payment to freeze again on the
 * way past: the second call is a read.
 *
 * Returns the persisted rows, which are the authority from here on. Never the
 * freshly computed totals: if a row was already there, ITS numbers are the ones
 * that will be paid, and handing back the recomputation would let a caller
 * render a document that disagrees with the payment.
 */
export async function freezeCycleSplit(
  deps: SettlementDeps,
  cycle: CycleRecord,
  entries: readonly any[],
  eligible: ReadonlySet<string>,
  reversed: ReadonlySet<string>,
  pool: PoolSetting,
): Promise<DistributionRecord[]> {
  // A reversed gift is a gift that did not happen, so it earns no share of
  // the pool here either. Same set the preview and the close hand in.
  const totals = settleCycle(entries, cycle.id, eligible as Set<string>, reversed);
  // Split by ELIGIBLE recognition, not the raw total: value follows the same
  // Sybil filter the breadth metric answers to. `t.received` stays the honest
  // figure for reporting.
  const totalEligible = totals.reduce((n, t) => n + t.receivedEligible, 0);
  for (const t of totals) {
    await deps.distributionsRepo.add({
      id: `dist-${cycle.cycleNumber}-${t.userId}`,
      cycleId: cycle.id,
      userId: t.userId,
      received: t.received,
      receivedHearts: t.receivedHearts,
      receivedAcks: t.receivedAcks,
      distinctSenders: t.distinctSenders,
      credited: shareOf(t.receivedEligible, totalEligible, pool.size),
      poolToken: pool.size > 0 ? pool.token : null,
      createdAt: new Date().toISOString(),
    } as DistributionRecord);
  }
  return (await deps.distributionsRepo.all()).filter((d) => d.cycleId === cycle.id);
}

export interface PaidCycle {
  cycle: CycleRecord;
  credited: number;
  recipients: number;
}

/**
 * PAY WHAT WAS WRITTEN DOWN, AND CLOSE THE MOON.
 *
 * The token a persisted row was priced in beats the current setting on purpose:
 * that row is what the village was shown and, on the ballot path, what it
 * voted for. `idempotencyKey` makes a re-run credit nothing twice.
 */
export async function payFrozenCycle(
  deps: SettlementDeps,
  cycle: CycleRecord,
  persisted: readonly DistributionRecord[],
  pool: PoolSetting,
  eligible: ReadonlySet<string>,
  actorUserId: string | null,
): Promise<{ ok: true; paid: PaidCycle } | { ok: false; error: string }> {
  let credited = 0;
  for (const d of persisted) {
    const share = Number(d.credited ?? 0);
    if (share <= 0) continue;
    // Value flows from the cycle-pool faucet (S7): the pool's negative balance
    // is the total value ever released, in one query.
    const r = await postTransfer(deps.getPool(), {
      from: CYCLE_POOL_FAUCET,
      to: memberAccount(d.userId),
      tokenType: (d as any).poolToken ?? pool.token,
      // LEDGER UNITS, never the human share. A token with decimals stores minor
      // units, so posting `share` raw pays a hundredth of it on a two-decimal
      // token while the frozen split and the ledger still agree with each other.
      amount: toLedgerUnits((d as any).poolToken ?? pool.token, share),
      source: "gratitude_pool",
      sourceRef: cycle.id,
      description: `Cycle pool share: ${d.received} recognition from ${d.distinctSenders} ${d.distinctSenders === 1 ? "person" : "people"}`,
      idempotencyKey: `gratitude_pool:${cycle.cycleNumber}:${d.userId}`,
    });
    if (!r.ok) return { ok: false, error: `pool distribution failed: ${r.error}` };
    if (!r.duplicate) credited += share;
  }

  await deps.cyclesRepo.upsert({ ...cycle, status: "closed", closedAt: new Date().toISOString() });

  /*
   * THE SETTLEMENT REACHES THE PEOPLE IT SETTLED FOR.
   *
   * AFTER the upsert on purpose: this fires about a cycle that IS closed, and
   * the rows it reads were persisted before any value moved. The dedupe key is
   * per cycle per member, so a re-run of a partially settled close credits
   * nothing twice and tells nobody twice either. Only members who actually
   * received recognition: somebody who received none is not owed a notice
   * saying so.
   */
  for (const d of persisted) {
    const received = Number(d.received ?? 0);
    if (received <= 0) continue;
    const share = Number(d.credited ?? 0);
    const senders = Number(d.distinctSenders ?? 0);
    const shareToken = (d as any).poolToken ?? pool.token;
    await deps.notify({
      userId: d.userId,
      type: "cycle_settled",
      title:
        share > 0
          ? `Cycle ${cycle.cycleNumber} settled, and ${share} ${tokenDef(shareToken)?.name ?? shareToken} came to you`
          : `Cycle ${cycle.cycleNumber} settled`,
      body: `${received} recognition from ${senders} ${senders === 1 ? "person" : "people"} this lunation.`,
      link: share > 0 ? "/wallet" : "/gratitude",
      dedupeKey: `cycle:${cycle.id}:settled:${d.userId}`,
    });
  }

  // S49: freeze this lunation's health snapshot IN the close — the only moment
  // these point-in-time facts are true. NOT module-gated: collection is
  // infrastructure, display is the module. Never fails the close; the UNIQUE
  // key makes a crash-retry write nothing twice.
  try {
    await snapshotCycle(
      deps.getPool(),
      { id: cycle.id, cycleNumber: cycle.cycleNumber, startsAt: String(cycle.startsAt), endsAt: String(cycle.endsAt) },
      eligible as Set<string>,
      { stageMultiplierFor: deps.stageMultiplierFor },
    );
    // H7: with this lunation frozen, compare it to the one before and tell the
    // stewards what moved. Inside the same try on purpose — an alert failure
    // must never unclose a cycle, and an alert without its snapshot would be
    // nonsense.
    const pct = numberVar("health.alert_change_pct");
    if (pct > 0) {
      const alerts = await thresholdAlerts(deps.getPool(), pct);
      if (alerts.length > 0) {
        const lines = alerts
          .slice(0, 6)
          .map((a) => `${a.label} ${a.direction} ${Math.abs(a.changePct)}% (${a.previous} → ${a.value})`);
        await deps.notifyAdmins(
          "health",
          `Lunation ${cycle.cycleNumber} moved: ${lines.join("; ")}`,
          `health-alerts:${cycle.cycleNumber}`,
        );
        void recordEvent(deps.getPool(), {
          kind: "audit",
          text: `health:alerts:${cycle.cycleNumber}:${alerts.length}`,
          entityType: "cycle",
          entityRef: cycle.id,
          audience: "admin",
        });
      }
    }
  } catch (e) {
    console.error(`[health] snapshot failed for cycle ${cycle.cycleNumber} (close stands)`, e);
    void recordEvent(deps.getPool(), {
      kind: "audit",
      text: `health:snapshot-failed:${cycle.cycleNumber}`,
      audience: "admin",
    });
  }

  const recipients = persisted.filter((d) => Number(d.received ?? 0) > 0).length;
  if (recipients > 0) {
    const poolNote =
      credited > 0 ? `. The cycle pool released ${credited} ${tokenDef(pool.token)?.name ?? pool.token}` : "";
    await recordEvent(deps.getPool(), {
      kind: "cycle",
      text: `A lunar cycle closed: ${recipients} ${recipients === 1 ? "member was" : "members were"} acknowledged with ${deps.currencyNameLower()}${poolNote}`,
      actorUserId: actorUserId ?? undefined,
      entityType: "cycle",
      entityRef: cycle.id,
    });
  }

  return { ok: true, paid: { cycle: { ...cycle, status: "closed" }, credited, recipients } };
}

export interface SettlementReport {
  closed: CycleRecord[];
  poolCredited: number;
}

export type SettlementResult =
  | { ok: true; report: SettlementReport }
  | { ok: false; status: number; error: string };

/**
 * Settle every finished lunation that is not yet recorded as closed, or just
 * the one a passed ballot named.
 *
 * `onlyCycleId` is how the ballot path keeps its promise. A settlement ballot
 * names ONE moon, and passing it must settle that moon and no other: a village
 * that voted to release cycle 330 has not voted to release 331, even if 331
 * ended while the vote was running.
 */
export async function settleDueCycles(
  deps: SettlementDeps,
  opts: { onlyCycleId?: string; actorUserId?: string | null } = {},
): Promise<SettlementResult> {
  const pool = poolSettingNow();
  // Fail loud BEFORE closing anything: a misconfigured pool should stop the
  // caller here, not half-settle a lunation.
  const poolProblem = cyclePoolProblem(pool.size, pool.token);
  if (poolProblem) return { ok: false, status: 400, error: poolProblem };

  const cycles = await deps.cyclesRepo.all();
  const entries = await deps.gratitudeRepo.all();
  /*
   * Fail loud on a cycle id nothing can read, before anything settles. This
   * used to be a quiet skip, and 30 of 130 units left the totals without a
   * word. A number that is wrong and says so can be fixed in an hour. A number
   * that is wrong and looks right is wrong forever.
   */
  const unreadable = unreadableCycleProblem(entries);
  if (unreadable) return { ok: false, status: 400, error: unreadable };

  const all = dueCycles(cycles, entries, new Date());
  const due = opts.onlyCycleId ? all.filter((c) => c.id === opts.onlyCycleId) : all;

  const eligible = await deps.eligibleSenderIds();
  // Read once for the whole loop, like the eligibility set above.
  const reversed = await deps.gratitudeRepo.reversedIds();
  const closed: CycleRecord[] = [];
  let poolCredited = 0;
  // Moons whose latest settlement vote was a no. Closing one anyway is a
  // founder's override (Rye, 2026-09-14), and it is recorded as one below.
  const refusals = await latestSettlementRefusals(deps.getPool(), due.map((c) => c.id));

  for (const cycle of due) {
    const persisted = await freezeCycleSplit(deps, cycle, entries, eligible, reversed, pool);
    const paid = await payFrozenCycle(deps, cycle, persisted, pool, eligible, opts.actorUserId ?? null);
    if (!paid.ok) return { ok: false, status: 500, error: paid.error };
    closed.push(paid.paid.cycle);
    poolCredited += paid.paid.credited;
    const refused = refusals.get(cycle.id);
    if (refused) {
      // THE OVERRIDE LEAVES A TRACE. The card warned before the press; this is
      // the record afterwards that a moon the village said no to was paid.
      await recordEvent(deps.getPool(), {
        kind: "audit",
        text: `cycle:settled-over-village-no:${cycle.cycleNumber}:${refused.vetoed ? "vetoed" : "voted-down"}`,
        actorUserId: opts.actorUserId ?? undefined,
        entityType: "cycle",
        entityRef: cycle.id,
        audience: "admin",
      });
    }
  }

  // S38: the earned-badge engine runs after settlement lands — new
  // distributions may have moved a metric past a threshold. Keyed events make
  // this a no-op when nothing changed; failures never unclose a cycle.
  if (closed.length > 0 && effectiveLifecycle("badges") !== "off") {
    try {
      const evald = await evaluateEarnedBadges(deps.getPool());
      for (const t of evald.newTiers) {
        const badge = await badgeById(deps.getPool(), t.badgeId);
        await deps.notify({
          userId: t.userId,
          type: "badge",
          title:
            t.tier > 1
              ? `Badge upgraded: ${badge?.name ?? t.badgeId} ×${t.tier}`
              : `Badge earned: ${badge?.name ?? t.badgeId}`,
          link: "/badges",
          dedupeKey: `rule:${t.badgeId}:${t.userId}:tier-${t.tier}`,
        });
      }
    } catch (e) {
      console.error("[badges] post-close evaluation failed (cycle stays closed)", e);
    }
  }

  return { ok: true, report: { closed, poolCredited } };
}
