/**
 * Reading the hero of the Gratitude wall.
 *
 * Two sources, one answer. A village's OWN voices are the messages it has
 * actually sent, read out of `gratitude_log` with everything but the sentence
 * left behind. The platform's are the standing examples in `gratitude_voices`,
 * which exists precisely because the first set can never be seeded.
 *
 * ── WHY THE REAL ONES ARE READ HERE AND NOT THROUGH THE LOG REPO ──────────
 *
 * `gratitudeLogRepo.all()` returns every row in the table with both names on
 * it, and the hero needs the opposite of that: the message, and provably
 * nothing else. Selecting one column is the guarantee. A mapper that returns a
 * whole record and a caller that promises to use one field is the shape that
 * leaks an identity the first time somebody adds a spread.
 *
 * ── HEARTS ARE NOT VOICES ────────────────────────────────────────────────
 *
 * A heart is a tap on a feed post and its `message` is the BODY of that post,
 * so quoting one on the wall republishes member-only prose on a public
 * surface. The wall route learned this the hard way and filters `kind`; this
 * filters it in SQL, where it cannot be forgotten by a later `.slice()`.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

import { HERO_SLOTS, type Voice, type VoicesAnswer } from "../../shared/gratitudeVoices";

/**
 * How many voices this village has said in its own words.
 *
 * The retirement threshold reads this, so it counts the same rows the hero
 * would draw and not merely "any gratitude row". A cycle of nothing but feed
 * hearts leaves the examples standing, which is right: the village has not
 * written anything for the wall to open with yet.
 */
export async function realVoiceCount(p: Pool): Promise<number> {
  const [[row]] = await p.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM `gratitude_log` " +
      "WHERE `kind` <> 'heart' AND `message` IS NOT NULL AND TRIM(`message`) <> ''",
  );
  return Number(row?.n ?? 0);
}

/**
 * The hero, blended.
 *
 * This village's own voices first, newest first, then labelled examples for
 * whatever is left. Once the village has HERO_SLOTS of its own the examples
 * have already been retired by the trigger, so the fill is empty and this
 * returns eight real lines.
 *
 * The order matters and is not cosmetic: a member arriving at the wall should
 * meet their neighbours before they meet the platform.
 */
export async function heroVoices(p: Pool): Promise<VoicesAnswer> {
  const [rows] = await p.query<RowDataPacket[]>(
    "SELECT `id`, `message` FROM `gratitude_log` " +
      "WHERE `kind` <> 'heart' AND `message` IS NOT NULL AND TRIM(`message`) <> '' " +
      "ORDER BY `at` DESC LIMIT ?",
    [HERO_SLOTS],
  );
  const real: Voice[] = rows.map((r) => ({
    id: String(r.id),
    message: String(r.message),
    isExample: false,
  }));

  const realTotal = await realVoiceCount(p);
  if (real.length >= HERO_SLOTS) return { voices: real, realTotal };

  // A missing table is not an error here. A village mid-upgrade, or one whose
  // examples were cleared, simply has no fill, and a hero of three real voices
  // is a better answer than a five hundred.
  let examples: Voice[] = [];
  try {
    const [exRows] = await p.query<RowDataPacket[]>(
      "SELECT `id`, `message` FROM `gratitude_voices` WHERE `is_example` = 1 " +
        "ORDER BY `sort_order` ASC LIMIT ?",
      [HERO_SLOTS - real.length],
    );
    examples = exRows.map((r) => ({
      id: String(r.id),
      message: String(r.message),
      isExample: true,
    }));
  } catch {
    /* see above: no fill is a valid answer */
  }

  return { voices: [...real, ...examples], realTotal };
}
