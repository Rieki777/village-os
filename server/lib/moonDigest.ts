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
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
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

  const [ledger] = await pool.query<RowDataPacket[]>(
    "SELECT sentence FROM governance_element_ledger WHERE applied_at >= ? AND applied_at < ? " +
      "ORDER BY applied_at ASC, ballot_id ASC, element_index ASC",
    [from, to],
  );

  const [paid] = await pool.query<RowDataPacket[]>(
    "SELECT title FROM ballots WHERE landing_status = 'applied' AND status = 'passed' " +
      "AND subject_type IN ('token_send','quest_payout','founding_allocation') " +
      "AND closes_at >= ? AND closes_at < ? ORDER BY closes_at ASC, id ASC",
    [from, to],
  );

  const [vetoed] = await pool.query<RowDataPacket[]>(
    "SELECT title, veto_reason FROM ballots WHERE vetoed_at >= ? AND vetoed_at < ? ORDER BY vetoed_at ASC, id ASC",
    [from, to],
  );

  const [opened] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM ballots WHERE opens_at >= ? AND opens_at < ?",
    [from, to],
  );
  const [closed] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM ballots WHERE status IN ('passed','failed','no_quorum') AND closes_at >= ? AND closes_at < ?",
    [from, to],
  );
  const [held] = await pool.query<RowDataPacket[]>(
    "SELECT landing_status AS s, COUNT(*) AS n FROM ballots WHERE landing_status IN ('stalled','expired') " +
      "AND lands_at >= ? AND lands_at < ? GROUP BY landing_status",
    [from, to],
  );

  const heldBy = (name: string): number =>
    Number(held.find((r) => String(r.s) === name)?.n ?? 0);

  return {
    landed: ledger.map((r) => String(r.sentence)),
    paid: paid.map((r) => String(r.title)),
    vetoed: vetoed.map((r) => ({
      title: String(r.title),
      reason: r.veto_reason === null || r.veto_reason === undefined ? null : String(r.veto_reason),
    })),
    opened: Number(opened[0]?.n ?? 0),
    closed: Number(closed[0]?.n ?? 0),
    stalled: heldBy("stalled"),
    expired: heldBy("expired"),
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

  let claimed = false;
  try {
    const [res] = await deps.pool.query<any>(
      "INSERT INTO governance_moon_digests (cycle_id, ended_at, composed_at, body) VALUES (?,?,?,?)",
      [deps.cycleId, sqlInstant(deps.endedAt), sqlInstant(deps.at), text],
    );
    claimed = Number(res.affectedRows) === 1;
  } catch (e: any) {
    if (e?.code !== "ER_DUP_ENTRY") throw e;
    claimed = false;
  }
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
  await deps.pool.query("UPDATE governance_moon_digests SET posted_at = ? WHERE cycle_id = ?", [
    sqlInstant(deps.at),
    deps.cycleId,
  ]);

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
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT cycle_id, body, composed_at FROM governance_moon_digests WHERE cycle_id = ?",
    [cycleId],
  );
  const r = rows[0];
  if (!r) return null;
  const at = r.composed_at instanceof Date ? r.composed_at : new Date(String(r.composed_at));
  return { cycleId: String(r.cycle_id), body: String(r.body), composedAt: at.toISOString() };
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
