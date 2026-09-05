/**
 * Characters: the five classes, the party a player builds, and the one primary.
 *
 * A class is a LENS. Playing one tunes what the game SHOWS you: which quests
 * surface, which roles are suggested, which badges the map paints. It never
 * locks a door. Nothing in this module may ever be consulted by
 * `hasCapability`, and no caller may use a class to decide whether an action is
 * allowed. The Quest Log, search, Get Involved and every earning surface stay
 * unfiltered, and the urgent list ignores classes entirely.
 *
 * Two things here are security rather than product, and both are about the
 * avatar path.
 *
 *  1. Presentation, tone and archetype are CLOSED sets, checked against this
 *     village's own rows rather than against a hardcoded list, so renaming a
 *     class does not silently invalidate every character.
 *  2. The avatar filename is looked up in a fixed table, never built by
 *     concatenating stored values. A path assembled from data is a path
 *     somebody can point somewhere else, and this string is rendered into an
 *     `img` tag.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { PortraitSource } from "../../shared/characterPortraits";
import { portraitsByArchetype } from "./characterPortraits";

export const PRESENTATIONS = ["f", "m"] as const;
export const TONES = ["deep", "olive", "light"] as const;

export type Presentation = (typeof PRESENTATIONS)[number];
export type Tone = (typeof TONES)[number];

/** The five seeded class keys. A village renames the LABELS, never these. */
export const ARCHETYPE_KEYS = [
  "building",
  "researching",
  "facilitating",
  "catalyzing",
  "storytelling",
] as const;

/**
 * Every avatar this build ships, as a fixed set.
 *
 * Built once from the three closed dimensions rather than read from disk or
 * assembled per request. `avatarFor` consults it and returns null for anything
 * absent, so the only strings that can ever reach an `img` src are these
 * thirty, and a half-finished art run degrades to a medallion instead of a
 * broken image.
 */
const AVATARS: ReadonlySet<string> = new Set(
  ARCHETYPE_KEYS.flatMap((a) => PRESENTATIONS.flatMap((p) => TONES.map((t) => `${a}-${p}-${t}`))),
);

export function isPresentation(v: unknown): v is Presentation {
  return typeof v === "string" && (PRESENTATIONS as readonly string[]).includes(v);
}

export function isTone(v: unknown): v is Tone {
  return typeof v === "string" && (TONES as readonly string[]).includes(v);
}

/**
 * The public path for one character's card art, or null when there is none.
 *
 * Null is a real answer and the caller renders a medallion. The alternative,
 * returning a path that may not exist, puts a broken image on the page and
 * tells the player their character failed to load.
 */
export function avatarFor(archetypeKey: string, presentation: string, tone: string): string | null {
  const key = `${archetypeKey}-${presentation}-${tone}`;
  return AVATARS.has(key) ? `/images/avatars/${key}.webp` : null;
}

export interface Archetype {
  key: string;
  name: string;
  subtitle: string;
  blurb: string;
  examples: string[];
  sigil: string;
  sortOrder: number;
}

export async function listArchetypes(pool: Pool, villageId: string): Promise<Archetype[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `key`, `name`, `subtitle`, `blurb`, `examples`, `sigil`, `sort_order` " +
      "FROM `archetypes` WHERE `village_id` = ? ORDER BY `sort_order`, `key`",
    [villageId],
  );
  return rows.map((r) => ({
    key: String(r.key),
    name: String(r.name),
    subtitle: String(r.subtitle ?? ""),
    blurb: String(r.blurb ?? ""),
    // JSON column: mysql2 has already parsed it. Guard the shape anyway, since
    // a hand-edited row should degrade to no examples rather than throw.
    examples: Array.isArray(r.examples) ? r.examples.map(String) : [],
    sigil: String(r.sigil ?? ""),
    sortOrder: Number(r.sort_order ?? 0),
  }));
}

export interface OpenPaths {
  /**
   * Seats tagged for this class.
   *
   * The platform's role cards show "~8h/wk" and `org_roles` has no hours
   * column: that number lives in the platform repo's own role data, not in
   * this schema. Rather than invent one, the card shows what a village
   * actually records about a seat: what it is called, whether it is
   * recruiting, and which circle it belongs to.
   */
  roles: Array<{
    id: string;
    name: string;
    seats: number;
    recruiting: boolean;
    circleKey: string | null;
    color: string | null;
  }>;
  questCount: number;
}

/**
 * What this class opens, which is a SUGGESTION and never a restriction.
 *
 * An untagged row belongs to everyone, and "tagged for nobody" has to read the
 * same way as "not tagged at all". JSON_LENGTH over a NULL column is NULL, so
 * both cases fall through the same branch here; collapsing them the other way
 * is how a filter quietly empties a board.
 *
 * This feeds the class panel only. The Quest Log, search and every earning
 * surface stay unfiltered, because a class guides what you are shown and never
 * what you may claim.
 */
export async function openPathsFor(
  pool: Pool,
  villageId: string,
  archetypeKey: string,
): Promise<OpenPaths> {
  const tagged = "JSON_CONTAINS(`archetypes`, JSON_QUOTE(?))";
  const [roles] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `name`, `seats`, `recruiting`, `circle_id`, `color` FROM `org_roles` " +
      `WHERE \`active\` = 1 AND \`is_example\` = 0 AND ${tagged} ` +
      "ORDER BY `recruiting` DESC, `sort_order`, `name` LIMIT 12",
    [archetypeKey],
  );
  const [quests] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM `quests` " +
      `WHERE \`status\` = 'open' AND \`is_example\` = 0 AND ${tagged}`,
    [archetypeKey],
  );
  return {
    roles: roles.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ""),
      seats: Number(r.seats ?? 1),
      recruiting: !!r.recruiting,
      circleKey: r.circle_id == null ? null : String(r.circle_id),
      color: r.color == null ? null : String(r.color),
    })),
    questCount: Number(quests[0]?.n ?? 0),
  };
}

export interface PlayerCharacter {
  id: string;
  archetypeKey: string;
  presentation: Presentation;
  tone: Tone;
  /**
   * The picture to render. The member's own portrait when they have one this
   * viewer is allowed to see, and the stock art otherwise.
   */
  avatar: string | null;
  /**
   * The stock art alone, always. Kept beside `avatar` so a surface that wants
   * to offer "back to the stock picture" has it without recomputing, and so a
   * reader can tell which of the two `avatar` currently is.
   */
  stockAvatar: string | null;
  /** Set only when a portrait of this member's own is being shown. */
  portrait: { source: PortraitSource; published: boolean } | null;
  isPrimary: boolean;
  chosenAt: string | null;
}

/**
 * One member's party, as a given viewer is allowed to see it.
 *
 * ── `viewerId` IS REQUIRED, AND THAT IS THE PRIVACY RULE ────────────────
 *
 * This function is the ONE read behind every party payload in the product:
 * `/api/me/profile`, `/api/me/characters`, the two character writes, and both
 * halves of `/api/profiles/:handle`. A member's own portrait is private until
 * they publish it, so the question "who is looking" has to be answered on every
 * one of those paths, and the cheapest way to guarantee that is to make it
 * impossible to call this without answering.
 *
 * So there is no default. Pass the signed-in member's id, or `null` for an
 * anonymous reader. `portraitsByArchetype` then reads a DIFFERENT query for a
 * stranger, one whose WHERE clause carries `published_at IS NOT NULL`, so an
 * unpublished filename is never fetched on a stranger's request at all.
 *
 * `PublicProfile.tsx` needs no rule of its own and has none. It renders
 * `c.avatar`, and for a stranger `avatar` can only ever be the stock art or a
 * portrait its owner published.
 */
export async function partyFor(
  pool: Pool,
  villageId: string,
  userId: string,
  viewerId: string | null,
): Promise<PlayerCharacter[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT pc.`id`, pc.`archetype_key`, pc.`presentation`, pc.`tone`, pc.`chosen_at`, " +
      "u.`primary_character_id` AS primary_id " +
      "FROM `player_characters` pc JOIN `users` u ON u.`id` = pc.`user_id` " +
      "WHERE pc.`village_id` = ? AND pc.`user_id` = ? ORDER BY pc.`chosen_at`, pc.`id`",
    [villageId, userId],
  );
  const mine = await portraitsByArchetype(pool, villageId, userId, viewerId);
  return rows.map((r) => {
    const key = String(r.archetype_key);
    const stock = avatarFor(key, String(r.presentation), String(r.tone));
    const own = mine.get(key) ?? null;
    return {
      id: String(r.id),
      archetypeKey: key,
      presentation: String(r.presentation) as Presentation,
      tone: String(r.tone) as Tone,
      avatar: own?.url ?? stock,
      stockAvatar: stock,
      portrait: own ? { source: own.source, published: own.published } : null,
      isPrimary: r.primary_id != null && String(r.primary_id) === String(r.id),
      chosenAt: r.chosen_at ? new Date(r.chosen_at).toISOString() : null,
    };
  });
}

export type CharacterOutcome =
  | { ok: true; character: PlayerCharacter }
  | { ok: false; status: number; error: string };

/**
 * Add a class to the party, or update the look of one already in it.
 *
 * The archetype is checked against THIS VILLAGE's rows rather than the constant
 * above, so a village that has renamed or removed a class gets the answer its
 * own data gives. Presentation and tone are checked against the closed sets,
 * because they are rendered into a filename and a schema enum is not a
 * substitute for refusing bad input at the door.
 */
export async function addCharacter(
  pool: Pool,
  villageId: string,
  userId: string,
  input: { archetypeKey?: unknown; presentation?: unknown; tone?: unknown; primary?: unknown },
): Promise<CharacterOutcome> {
  const archetypeKey = String(input.archetypeKey ?? "");
  if (!isPresentation(input.presentation)) {
    return { ok: false, status: 400, error: "Choose how this character presents" };
  }
  if (!isTone(input.tone)) {
    return { ok: false, status: 400, error: "Choose a skin tone" };
  }
  const [known] = await pool.query<RowDataPacket[]>(
    "SELECT 1 FROM `archetypes` WHERE `village_id` = ? AND `key` = ? LIMIT 1",
    [villageId, archetypeKey],
  );
  if (!known.length) {
    return { ok: false, status: 400, error: "There is no such path in this village" };
  }

  const presentation = input.presentation;
  const tone = input.tone;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // One character per class per player. A double tap on "Walk this path"
    // updates the look instead of putting a second copy in the party row.
    const id = `pc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await conn.query(
      "INSERT INTO `player_characters` (`id`, `village_id`, `user_id`, `archetype_key`, `presentation`, `tone`) " +
        "VALUES (?,?,?,?,?,?) " +
        "ON DUPLICATE KEY UPDATE `presentation` = VALUES(`presentation`), `tone` = VALUES(`tone`)",
      [id, villageId, userId, archetypeKey, presentation, tone],
    );
    const [row] = await conn.query<RowDataPacket[]>(
      "SELECT `id`, `chosen_at` FROM `player_characters` " +
        "WHERE `village_id` = ? AND `user_id` = ? AND `archetype_key` = ?",
      [villageId, userId, archetypeKey],
    );
    const realId = String(row[0]?.id ?? id);

    // The first character a player walks becomes their primary without being
    // asked. A profile whose hero art is blank until somebody finds the star
    // reads as broken rather than as unset.
    const promote = input.primary === true;
    await conn.query(
      promote
        ? "UPDATE `users` SET `primary_character_id` = ? WHERE `id` = ?"
        : "UPDATE `users` SET `primary_character_id` = COALESCE(`primary_character_id`, ?) WHERE `id` = ?",
      [realId, userId],
    );
    await conn.commit();

    return {
      ok: true,
      character: {
        id: realId,
        archetypeKey,
        presentation,
        tone,
        // The look the member just picked, and nothing else. Walking a path
        // does not read their portraits: this payload answers "what did that
        // choice do", and every caller that renders a party rail re-reads
        // `partyFor`, which is the one place the visibility rule lives. Adding
        // a portrait lookup here would be a second answer to the same question,
        // and the second one is always the one that goes stale.
        avatar: avatarFor(archetypeKey, presentation, tone),
        stockAvatar: avatarFor(archetypeKey, presentation, tone),
        portrait: null,
        isPrimary: true,
        chosenAt: row[0]?.chosen_at ? new Date(row[0].chosen_at).toISOString() : null,
      },
    };
  } catch (err: any) {
    try {
      await conn.rollback();
    } catch {
      /* already gone */
    }
    return { ok: false, status: 500, error: String(err?.message ?? err) };
  } finally {
    conn.release();
  }
}

/**
 * Set which character fronts the sheet.
 *
 * One statement, and the WHERE clause is the guard: the id has to belong to
 * this player in this village, so a crafted request cannot point somebody
 * else's character at your profile. Two concurrent calls both write the same
 * single column, so the last one wins and there is still exactly one primary.
 * A boolean flag on each character is what would let both win.
 */
export async function setPrimary(
  pool: Pool,
  villageId: string,
  userId: string,
  characterId: string,
): Promise<boolean> {
  const [res]: any = await pool.query(
    "UPDATE `users` u SET u.`primary_character_id` = ? WHERE u.`id` = ? AND EXISTS (" +
      "SELECT 1 FROM `player_characters` pc WHERE pc.`id` = ? AND pc.`user_id` = ? AND pc.`village_id` = ?)",
    [characterId, userId, characterId, userId, villageId],
  );
  return Number(res?.affectedRows ?? 0) > 0 || Number(res?.changedRows ?? 0) > 0;
}

/**
 * Leave a path.
 *
 * Removing the primary has to hand the crown on in the SAME transaction that
 * removes it. Doing it in two steps leaves a window where the profile points
 * at a character that no longer exists, and the header renders nothing at all.
 * The next party member takes it; if the party is now empty the pointer goes
 * NULL and the header falls back to the medallion, which is the honest state
 * for a player who has walked away from every path.
 */
export async function removeCharacter(
  pool: Pool,
  villageId: string,
  userId: string,
  characterId: string,
): Promise<boolean> {
  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [res]: any = await conn.query(
      "DELETE FROM `player_characters` WHERE `id` = ? AND `user_id` = ? AND `village_id` = ?",
      [characterId, userId, villageId],
    );
    if (Number(res?.affectedRows ?? 0) === 0) {
      await conn.rollback();
      return false;
    }
    const [next] = await conn.query<RowDataPacket[]>(
      "SELECT `id` FROM `player_characters` WHERE `village_id` = ? AND `user_id` = ? " +
        "ORDER BY `chosen_at`, `id` LIMIT 1",
      [villageId, userId],
    );
    await conn.query(
      "UPDATE `users` SET `primary_character_id` = ? WHERE `id` = ? AND `primary_character_id` = ?",
      [next[0]?.id ?? null, userId, characterId],
    );
    await conn.commit();
    return true;
  } catch {
    try {
      await conn.rollback();
    } catch {
      /* already gone */
    }
    return false;
  } finally {
    conn.release();
  }
}
