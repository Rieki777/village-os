/**
 * TELLING THE ROLL, once, keyed on the ballot.
 *
 * Everyone who was ASKED is told what the answer was, including the people who
 * did not vote: a decision binds them either way, and finding out later from
 * somebody else is how a village stops trusting its own process.
 *
 * The roll comes from `ballot_electorate`, the frozen one, and never from a
 * live member list, for the same reason every other evaluation reads it: the
 * people asked are the people who were asked, and somebody who joined
 * yesterday was not.
 *
 * NEVER THROWS. It is called without an await from request handlers, so a
 * throw here would be an unhandled rejection rather than a 500, and a trace
 * that failed must not fail the deed it is a trace OF.
 *
 * Moved out of `server/index.ts` by the dispatcher lane. The behaviour is
 * unchanged to the line; what changed is which file carries it.
 */
import type { Pool } from "mysql2/promise";
import { electorateOf } from "./ballots";

export interface RollNoticeDeps {
  pool: Pool;
  notify: (input: {
    userId: string;
    type: string;
    title: string;
    body?: string | null;
    link?: string | null;
    dedupeKey: string;
  }) => Promise<unknown>;
  /** Where a notice about this ballot should land. */
  link: (b: { id: string }) => string;
}

export interface RollNotice {
  type: string;
  title: string;
  body?: string | null;
  keySuffix: string;
  /** Already told in their own words, so the roll's line skips them. */
  except?: Array<string | null | undefined>;
  /** An explicit roll, when the caller already has one. */
  roll?: string[];
}

export async function notifyRollRows(deps: RollNoticeDeps, b: { id: string }, input: RollNotice): Promise<number> {
  let rung = 0;
  try {
    const roll = input.roll ?? (await electorateOf(deps.pool, b.id));
    const skip = new Set((input.except ?? []).filter((x): x is string => !!x));
    for (const userId of roll) {
      if (skip.has(userId)) continue;
      await deps.notify({
        userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: deps.link(b),
        dedupeKey: `bal:${b.id}:${input.keySuffix}:u${userId}`,
      });
      rung += 1;
    }
  } catch (e) {
    console.error(`[governance] telling the roll about ballot ${b.id} failed (the ballot stands)`, e);
  }
  return rung;
}
