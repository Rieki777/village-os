/**
 * THE GOVERNING PURPOSE STATEMENT: the read, the write, and who holds the pen.
 *
 * The shape, the back-fill and every refusal's words are in
 * `shared/governingPurpose.ts`, which carries no pool so the wizard and the
 * setup step can import them. This file is the half that touches the
 * database, and there is exactly one reader and exactly one writer in it.
 *
 * ── ONE WRITER, AND THAT IS THE POINT ──────────────────────────────────────
 *
 * Two paths write this document and they land years apart. The founder's own
 * write happens on day one, through the setup wizard. The closer's write
 * happens when a village that has finished its handover carries a change
 * ballot, which under the pen ruling may be a long way off. Both go through
 * `writeGoverningPurpose`, so a statement the founder could not save is a
 * statement the closer cannot land either. Two validators agreeing by
 * inspection is how a standard drifts, and this one would drift unwatched
 * until the first village actually voted one through.
 *
 * ── READ LIVE, NEVER FROM A WARM CACHE ─────────────────────────────────────
 *
 * `dbDocument` caches, and every read here calls `load()` first. The reason
 * is the one `server/lib/capabilityHolding.ts` gives for having no cache at
 * all: this document decides what a founder may do, and a permission that
 * depends on which process answered is not a permission. A village runs one
 * process per deployment today and that is not a property to build on. The
 * cost is one primary-key read of a single row, asked a handful of times a
 * day.
 */
import type { Pool } from "mysql2/promise";
import {
  GPS_DOC_KEY,
  EMPTY_PURPOSE,
  hasGoverningPurpose,
  purposeAlignmentProblem,
  purposeAlignmentRequired,
  purposeDocFrom,
  purposeStatementProblem,
  type GoverningPurposeDoc,
} from "../../shared/governingPurpose";
import { dbDocument, type DbDocument } from "../repos/store-db";
import { villageHandoverState, type VillageHandoverState } from "./capabilityHolding";

/**
 * One document object per pool.
 *
 * A `WeakMap` so a test that provisions a scratch schema, uses it and drops
 * the pool leaves nothing behind. The object is only a cache holder; every
 * read below reloads it, so two callers sharing one is never two answers.
 */
const docs = new WeakMap<Pool, DbDocument<GoverningPurposeDoc & Record<string, unknown>>>();

function docFor(pool: Pool): DbDocument<GoverningPurposeDoc & Record<string, unknown>> {
  const existing = docs.get(pool);
  if (existing) return existing;
  const made = dbDocument<GoverningPurposeDoc & Record<string, unknown>>(
    pool,
    GPS_DOC_KEY,
    { ...EMPTY_PURPOSE },
  );
  docs.set(pool, made);
  return made;
}

/**
 * This village's statement, with every absent key back-filled.
 *
 * A village that has never written one reads three empty strings, which is
 * the same answer a document written before a fourth field existed gives for
 * that field. Callers handle one shape.
 */
export async function governingPurpose(pool: Pool): Promise<GoverningPurposeDoc> {
  const doc = docFor(pool);
  await doc.load();
  return purposeDocFrom(doc.get());
}

export interface PurposeWrite {
  statement: string;
  /** A user id for the founder's write, or the ballot id for a carried change. */
  writtenBy: string;
  at?: Date;
}

/**
 * Write the statement. The one writer.
 *
 * Validates through `purposeStatementProblem`, which is the same call the
 * wizard makes before it posts and the same call the change ballot's route
 * makes before it opens, so a founder is never told at the last step what
 * they could have been told at the first.
 */
export async function writeGoverningPurpose(
  pool: Pool,
  input: PurposeWrite,
): Promise<{ ok: true; doc: GoverningPurposeDoc } | { ok: false; error: string }> {
  const problem = purposeStatementProblem(input.statement);
  if (problem) return { ok: false, error: problem };
  const doc: GoverningPurposeDoc = {
    statement: String(input.statement).trim(),
    writtenAt: (input.at ?? new Date()).toISOString(),
    writtenBy: String(input.writtenBy ?? ""),
  };
  await docFor(pool).put(doc as GoverningPurposeDoc & Record<string, unknown>);
  return { ok: true, doc };
}

/**
 * ── WHO HOLDS THE PEN ──────────────────────────────────────────────────────
 *
 * Rye, 2026-09-23, verbatim: "Founder keeps the pen until they give over all
 * steward powers to the village."
 *
 * THIS IS TIED TO THE HANDOVER AND NOT TO WHETHER THE GAME HAS STARTED, and
 * the difference is about to be real. `founderPowerStands` in
 * server/lib/gameStart.ts answers whether the Game has begun, and reading the
 * pen off it was the first reading of this ruling and it is wrong. When
 * Amora's launch vote carries, the village is handed `steward.veto` and the
 * Game starts, so the `founderPowerStands` reading would move the pen that
 * day. Rye's words keep it, because one power of nineteen is not "all steward
 * powers".
 *
 * WHAT "ALL STEWARD POWERS" MEANS is `HANDOVER_SET` in
 * shared/capabilities.ts, read as every transferable power, and that reading
 * is stated as a reading at the constant with the narrower alternative named
 * beside it.
 *
 * Returns the refusal a founder reads, or null when the pen is still theirs.
 */
export async function founderPenRefusal(pool: Pool): Promise<string | null> {
  const handover = await villageHandoverState(pool);
  if (!handover.complete) return null;
  return (
    `This village looks after all ${handover.total} of its powers now, so the governing purpose statement ` +
    `is the village's to change. Open a change of the governing purpose and put it to the whole roll.`
  );
}

/**
 * WHY THIS BALLOT MAY NOT OPEN WITHOUT A JUDGEMENT LINE, or null.
 *
 * ── A LINE ANSWERS TO A STATEMENT, AND WITH NO STATEMENT THERE IS NOTHING
 *    TO ANSWER TO ─────────────────────────────────────────────────────────
 *
 * This is the whole of the extra condition, and it is a rule rather than a
 * convenience. "Judged against it" is a comparison, and a village that has
 * not written its sentence has nothing on the other side of the comparison.
 * Asking a proposer to say how their change serves a document that does not
 * exist would produce the ritual answer Rye scoped the field against, on the
 * villages least able to tell the difference.
 *
 * It also makes the two halves of this lane agree. The statement is a
 * BLOCKING launch requirement, so a launched village always has one and the
 * line is always required there. A village still setting itself up has
 * neither, which is the same posture the whole platform takes towards a
 * half-configured deployment.
 *
 * ── WHAT THIS DOES NOT EXCUSE ──────────────────────────────────────────────
 *
 * It is not a grace period and it does not decay. The moment the founder
 * writes the statement, every later mechanics, power and purpose ballot needs
 * its line, including one opened on a proposal written before the statement
 * was. Somebody taking such a proposal to the vote is asked for the line at
 * that route, which is where a proposer stands.
 *
 * One primary-key read of one row per ballot opened, which is a handful a
 * month on a busy village.
 */
export async function purposeAlignmentRefusal(
  pool: Pool,
  subjectType: string,
  raw: unknown,
): Promise<string | null> {
  if (!purposeAlignmentRequired(subjectType)) return null;
  const doc = await governingPurpose(pool);
  if (!hasGoverningPurpose(doc)) return null;
  return purposeAlignmentProblem(subjectType, raw);
}

/** The pen and the handover in one read, for a surface that shows both. */
export async function purposePenState(
  pool: Pool,
): Promise<{ founderHoldsPen: boolean; handover: VillageHandoverState; doc: GoverningPurposeDoc }> {
  const handover = await villageHandoverState(pool);
  return {
    founderHoldsPen: !handover.complete,
    handover,
    doc: await governingPurpose(pool),
  };
}
