/**
 * WHAT CHANGED THIS MOON: one digest per cycle, composed by the landing job.
 *
 * ── WHY THE LANDING JOB AND NOT THE SETTLEMENT PATH ────────────────────────
 *
 * 21.4 first put this on the settlement path. The settlement path is wrong for
 * two reasons and both of them are silent failures.
 *
 * It returns early. `economyReady` refuses a village with no enabled minting
 * rules or an unregistered recognition token, so a young village that turned
 * its seeded rules off gets no digest, forever, and is told nothing. A digest
 * is about DECISIONS, and a village that mints nothing still decides things.
 *
 * It does not know whether the landings finished. The digest's whole promise
 * is "here is what changed", and composing it while rows due inside the closed
 * cycle are still resting in `pending` publishes that sentence with the changes
 * missing. The landing job is the only routine that can answer the question, so
 * it composes the digest after answering it, and holds otherwise.
 *
 * ── IDEMPOTENT PER CYCLE ID ────────────────────────────────────────────────
 *
 * `governance_moon_digests` takes the cycle id as its primary key. The insert
 * is the claim: whoever writes the row composes the digest, and every other
 * caller for that cycle reads `already_composed` and posts nothing. Two ticks
 * at one boundary, two servers, a human cycle close arriving in the same
 * second: one digest, one feed item.
 *
 * ── "NO DIGEST COMPOSED" IS NOT "THE DIGEST WAS EMPTY" ─────────────────────
 *
 * A moon in which a village decided nothing is a real thing that happened and
 * it gets a digest saying so. A moon whose digest never ran is a fault. From
 * the feed the two look identical, so every answer this module returns says
 * which of the two it is, in words, in `why`.
 *
 * ── WHERE THE STATEMENTS LIVE, AND WHY IN THREE FILES ──────────────────────
 *
 * A digest reads three tables and each has its own module:
 *
 *   `server/repos/governanceElementLedger.ts`  what actually landed
 *   `server/repos/ballotCycleFacts.ts`         what the ballots table recorded
 *   `server/repos/moonDigests.ts`              the digest row itself
 *
 * Three rather than one, because one module named for this FILE would be a
 * home for a job and not for a table, and the question the burn-down exists to
 * answer is "who else reads this table". The element ledger is read by the
 * decision page as well as by this digest, and putting both readers in one
 * place is how it stays obvious that a digest reports the executor's own
 * sentences rather than a summary it invented.
 *
 * WHAT STAYS HERE IS THE ONE OPINION ABOUT TIME. `sqlInstant` turns a `Date`
 * into the string every one of those statements is windowed on, and it is
 * applied here, once, so the six windows a digest opens can never disagree
 * about where the moon began. A repo module that formatted its own bounds
 * would be a second opinion about the session's timezone.
 */
import type { Pool } from "mysql2/promise";
import {
  closedCountBetween,
  heldCountsDueBetween,
  openedCountBetween,
  paidTitlesClosedBetween,
  vetoedBetween,
} from "../repos/ballotCycleFacts";
import { sentencesAppliedBetween } from "../repos/governanceElementLedger";
import { claimDigest, digestRow, markDigestPosted } from "../repos/moonDigests";
import { recordEvent } from "./events";

export interface DigestDeps {
  pool: Pool;
  /** The instant the cycle that just ended closed on. */
  endedAt: Date;
  /** Now, for the record. */
  at: Date;
  /** The cycle id the ended cycle carried, from the ACTIVE clock. */
  cycleId: string;
  /** The instant that cycle began, so the digest reads its own window. */
  startedAt: Date;
}

export interface DigestResult {
  composed: boolean;
  /** One sentence a log line can carry, distinguishing every outcome. */
  why: string;
  /** The digest's own text, when this call composed it. */
  text: string | null;
  cycleId: string;
}

export interface DigestFacts {
  landed: string[];
  paid: string[];
  vetoed: Array<{ title: string; reason: string | null }>;
  opened: number;
  closed: number;
  stalled: number;
  expired: number;
}

const sqlInstant = (d: Date): string => d.toISOString().slice(0, 19).replace("T", " ");

/**
 * EVERYTHING THE CLOSED CYCLE DID, read from the rows rather than remembered.
 *
 * "Landed" comes from `governance_element_ledger`, which is the only table that
 * records what a change set actually wrote, element by element, in the words
 * the executor used. Counting proposals instead would say "three decisions
 * landed" and never what any of them changed.
 */
export async function digestFacts(pool: Pool, startedAt: Date, endedAt: Date): Promise<DigestFacts> {
  const from = sqlInstant(startedAt);
  const to = sqlInstant(endedAt);

  // Read one after another, as the raw statements were. A digest runs once per
  // moon inside the landing job and nothing is waiting on it, so six sequential
  // round trips cost a village nothing; issuing them together would be a change
  // to how many connections the landing job holds at its busiest moment, made
  // inside a refactor, for no reader's benefit.
  const landed = await sentencesAppliedBetween(pool, from, to);
  const paid = await paidTitlesClosedBetween(pool, from, to);
  const vetoed = await vetoedBetween(pool, from, to);
  const opened = await openedCountBetween(pool, from, to);
  const closed = await closedCountBetween(pool, from, to);
  const held = await heldCountsDueBetween(pool, from, to);

  return {
    landed,
    paid,
    vetoed,
    opened,
    closed,
    stalled: held.stalled,
    expired: held.expired,
  };
}

/**
 * The digest's words. A section that has nothing to say SAYS SO rather than
 * disappearing: a page missing its "what was stopped" heading reads as a page
 * that forgot, and a village needs to be able to tell "nothing was stopped"
 * from "we did not look".
 */
export function digestText(cycleId: string, facts: DigestFacts): string {
  const lines: string[] = [`What changed this moon (${cycleId})`, ""];

  lines.push("What landed");
  if (facts.landed.length === 0) lines.push("  Nothing landed this moon.");
  for (const sentence of facts.landed) lines.push(`  ${sentence}`);
  lines.push("");

  lines.push("What was paid");
  if (facts.paid.length === 0) lines.push("  No decision sent tokens this moon.");
  for (const title of facts.paid) lines.push(`  ${title}`);
  lines.push("");

  lines.push("What was stopped");
  if (facts.vetoed.length === 0) lines.push("  A steward stopped nothing this moon.");
  for (const v of facts.vetoed) {
    lines.push(`  ${v.title}: ${v.reason ?? "no reason was recorded, which is itself worth asking about"}`);
  }
  lines.push("");

  lines.push("What the village voted on");
  lines.push(`  ${facts.opened} ballot(s) opened, ${facts.closed} closed.`);
  if (facts.stalled > 0) lines.push(`  ${facts.stalled} decision(s) came due while landing was switched off.`);
  if (facts.expired > 0) lines.push(`  ${facts.expired} decision(s) waited too long and were closed.`);

  return lines.join("\n");
}

/**
 * COMPOSE ONE DIGEST FOR THE CYCLE THAT ENDED.
 *
 * The row is the claim and the text is written after it, so a throw between the
 * two leaves a row saying the digest exists and no feed item. That is the safe
 * direction: a missing feed item is visible on the page and a second digest is
 * not, and `posted_at` staying NULL is what a human reads to find it.
 */
export async function composeMoonDigest(deps: DigestDeps): Promise<DigestResult> {
  const facts = await digestFacts(deps.pool, deps.startedAt, deps.endedAt);
  const text = digestText(deps.cycleId, facts);

  const claimed = await claimDigest(deps.pool, {
    cycleId: deps.cycleId,
    endedAt: sqlInstant(deps.endedAt),
    composedAt: sqlInstant(deps.at),
    body: text,
  });
  if (!claimed) {
    return {
      composed: false,
      why: `A digest for ${deps.cycleId} was already composed, so this run posted nothing.`,
      text: null,
      cycleId: deps.cycleId,
    };
  }

  await recordEvent(deps.pool, {
    kind: "governance",
    text: `What changed this moon: ${summaryLine(facts)}`,
    entityType: "governance_digest",
    entityRef: deps.cycleId,
  });
  await markDigestPosted(deps.pool, deps.cycleId, sqlInstant(deps.at));

  const empty = facts.landed.length === 0 && facts.paid.length === 0 && facts.vetoed.length === 0;
  return {
    composed: true,
    why: empty
      ? `The digest for ${deps.cycleId} was composed and it is empty: nothing landed, nothing was paid, nothing was stopped.`
      : `The digest for ${deps.cycleId} was composed: ${facts.landed.length} change(s) landed, ${facts.paid.length} payment(s), ${facts.vetoed.length} stopped.`,
    text,
    cycleId: deps.cycleId,
  };
}

/** The one line the feed item carries. The page carries the rest. */
function summaryLine(facts: DigestFacts): string {
  if (facts.landed.length === 0 && facts.paid.length === 0 && facts.vetoed.length === 0) {
    return "the village changed nothing this moon.";
  }
  const parts: string[] = [];
  if (facts.landed.length > 0) parts.push(`${facts.landed.length} change(s) landed`);
  if (facts.paid.length > 0) parts.push(`${facts.paid.length} payment(s) went out`);
  if (facts.vetoed.length > 0) parts.push(`${facts.vetoed.length} decision(s) were stopped`);
  return `${parts.join(", ")}.`;
}

/** Read a composed digest back, for the page that renders it. */
export async function digestFor(pool: Pool, cycleId: string): Promise<{ cycleId: string; body: string; composedAt: string } | null> {
  return digestRow(pool, cycleId);
}

/**
 * THE COMPOSER THE LANDING JOB IS WIRED WITH.
 *
 * The job knows the boundary it crossed and nothing about cycle ids, and the
 * clock knows cycle ids and nothing about landings. This closes over the
 * active clock and hands the job the one function it needs, so `server/index.ts`
 * wires it in a line rather than doing the arithmetic in the file that is
 * ratcheted against growing.
 *
 * The cycle the digest is ABOUT is the one that ENDED, so the bounds are read
 * one millisecond before the boundary. Reading them at the boundary itself
 * would return the cycle that just began, and the digest would report a moon
 * that has not happened yet.
 */
export function digestComposerFor(clock: () => { boundsFor(at: Date): { id: string; startsAt: Date } }) {
  return async (input: { pool: Pool; endedAt: Date; at: Date }): Promise<DigestResult> => {
    const bounds = clock().boundsFor(new Date(input.endedAt.getTime() - 1));
    return composeMoonDigest({ ...input, cycleId: bounds.id, startedAt: bounds.startsAt });
  };
}
