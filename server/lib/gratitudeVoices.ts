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

import { HERO_SLOTS, type Voice, type VoicesAnswer, type WallEntry, type WallPerson } from "../../shared/gratitudeVoices";
import { avatarFor } from "./characters";

/** How many written appreciations the wall carries. Unchanged from the route
 *  this moved out of: sixty is what it has always shown. */
const WALL_LIMIT = 60;

/**
 * The fields of a log row this module reads, and no more.
 *
 * Structural rather than `GratitudeEntry`, so the route can hand over a plain
 * read without this module importing the repo, and so the list of what the
 * wall touches is stated where somebody auditing what reaches a public
 * endpoint will actually look.
 */
export interface WallLogRow {
  id: string;
  kind?: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amount: number;
  message: string;
  at: string;
}

/**
 * The public identity of everyone named on the wall, in one query.
 *
 * ONE QUERY FOR THE SET, never one per line: sixty entries is up to a hundred
 * and twenty people, and the market-week reasoning at `/api/game/ledger`
 * applies here for the same reason.
 *
 * The three columns are exactly what `publicView` serves without consulting a
 * member's privacy flags. `is_example = 0` is on the WHERE rather than trusted
 * from elsewhere: an example identity must not acquire a portrait on a public
 * surface just because a fork seeded one.
 */
async function peopleFor(p: Pool, ids: string[]): Promise<Map<string, WallPerson>> {
  const out = new Map<string, WallPerson>();
  const wanted = Array.from(new Set(ids.filter(Boolean)));
  if (!wanted.length) return out;
  const [rows] = await p.query<RowDataPacket[]>(
    "SELECT u.`id`, u.`name`, u.`handle`, pc.`archetype_key`, pc.`presentation`, pc.`tone` " +
      "FROM `users` u LEFT JOIN `player_characters` pc ON pc.`id` = u.`primary_character_id` " +
      `WHERE u.\`is_example\` = 0 AND u.\`id\` IN (${wanted.map(() => "?").join(",")})`,
    wanted,
  );
  for (const r of rows) {
    out.set(String(r.id), {
      name: String(r.name ?? ""),
      handle: r.handle ? String(r.handle) : null,
      // Null rather than a guessed path when the member fronts no character.
      avatar: r.archetype_key
        ? avatarFor(String(r.archetype_key), String(r.presentation), String(r.tone))
        : null,
    });
  }
  return out;
}

/**
 * The wall: written appreciations only, newest first.
 *
 * MOVED OUT OF server/index.ts, and the filter that lives here is the one that
 * route learned the hard way. `.slice(-60)` used to run BEFORE any kind check,
 * so whatever the last sixty gratitude rows happened to be went out, and a
 * HEART is a gratitude row whose message is the body of the feed post it was
 * tapped on. In a village whose feed is members-only that put member-only
 * prose on an endpoint with no authentication, and the busier the feed the
 * more of the wall it became. Filtering first also matches the documented
 * `feed.hearts_on_wall` default of false: a tap is a gesture, not a message.
 *
 * A member who has since deleted their account resolves to no row, and the
 * entry keeps the name the log recorded with no handle and no portrait. That
 * is what the tombstone means, and it is the same answer `listRsvps` gives.
 */
export async function wallEntries(p: Pool, log: WallLogRow[]): Promise<WallEntry[]> {
  const rows = log.filter((g) => g.kind !== "heart").slice(-WALL_LIMIT).reverse();
  const people = await peopleFor(p, rows.flatMap((g) => [g.fromId, g.toId]));
  const side = (id: string, recorded: string): WallPerson =>
    people.get(id) ?? { name: recorded ?? "", handle: null, avatar: null };
  return rows.map((g) => ({
    id: g.id,
    from: side(g.fromId, g.fromName),
    to: side(g.toId, g.toName),
    amount: Number(g.amount) || 0,
    message: g.message,
    at: g.at,
  }));
}

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
