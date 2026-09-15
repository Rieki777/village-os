/**
 * The Player Profile: a character sheet, and who is allowed to read which part.
 *
 * The sheet itself is assembled from things that already exist. Claims, roles,
 * badges, journeys, RSVPs and the ledger are all older than this file and none
 * of them is copied here: the profile is a LENS over them, so deleting this
 * surface deletes no value and changing a balance in one place changes it
 * everywhere.
 *
 * What is genuinely new is the privacy question, and it has one rule that is
 * easy to get wrong in a way nobody notices:
 *
 *   A MISSING FLAG MUST READ AS ITS DEFAULT, AND THE DEFAULTS ARE THE
 *   CONSERVATIVE ANSWER.
 *
 * Every profile row written before a flag existed has no value for it. If a
 * reader treats absent as permissive, the day a new flag ships every member who
 * has not touched their settings is opted in to something they never saw. So
 * the resolver fills from a frozen default table rather than reading the JSON
 * directly, and the shape of what a stranger receives is decided in ONE place.
 *
 * The split of what defaults which way follows the doctrine: the things a
 * member CHOSE TO EARN are shown, and the things that describe their life are
 * not. Badges, roles and standing are the first kind. Where they sleep, what
 * they have borrowed and where they will be on Thursday are the second.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

export interface Privacy {
  /** Where they sleep is not public data. */
  showHome: boolean;
  /** What they have borrowed and booked. */
  showInventory: boolean;
  /** Where they will be, and when. */
  showCalendar: boolean;
  showBadges: boolean;
  showRoles: boolean;
  /** Standing: the token chips and the ledger drawer behind them. */
  showHearts: boolean;
}

/**
 * Frozen. A row that predates a flag inherits from here, so adding a flag can
 * never opt an existing member into anything.
 */
export const PRIVACY_DEFAULTS: Readonly<Privacy> = Object.freeze({
  showHome: false,
  showInventory: false,
  showCalendar: false,
  showBadges: true,
  showRoles: true,
  showHearts: true,
});

/**
 * Read a stored privacy blob into a complete answer.
 *
 * Only real booleans are honoured. A string "false", a 0, or a null in the
 * column are all junk from a hand-edited row or an older client, and coercing
 * them is how "false" becomes true. Junk falls back to the default.
 */
export function resolvePrivacy(raw: unknown): Privacy {
  const out: Privacy = { ...PRIVACY_DEFAULTS };
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(PRIVACY_DEFAULTS) as Array<keyof Privacy>) {
    if (typeof src[key] === "boolean") out[key] = src[key] as boolean;
  }
  return out;
}

export interface ProfileView {
  handle: string | null;
  name: string;
  title: string | null;
  joinedAt: string | null;
  /** "11 moons on the land". Computed, never stored. */
  moonsOnTheLand: number;
  primaryCharacterId: string | null;
  homeStructureKey?: string | null;
  privacy?: Privacy;
  /** Present only when the viewer may see it. Absent is different from empty. */
  standing?: Array<{ token: string; name: string; balance: number; decimals: number }>;
  gratitude?: { receivedThisSeason: number; givenThisSeason: number; lifetime: number };
}

const MOON_MS = 29.53058867 * 24 * 60 * 60 * 1000;

/** Whole lunations since arrival. A member who arrived today is on moon one. */
export function moonsSince(joinedAt: Date | string | null | undefined, now = new Date()): number {
  if (!joinedAt) return 0;
  const start = new Date(joinedAt).getTime();
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.floor((now.getTime() - start) / MOON_MS));
}

/**
 * What a STRANGER gets.
 *
 * Built by starting from nothing and adding what the flags permit, never by
 * taking a full profile and deleting fields. Deletion is the shape that leaks:
 * a field added later is a field nobody remembered to delete, and it ships
 * public by default. This way a new field is private until somebody writes the
 * line that publishes it.
 */
export function publicView(full: ProfileView, privacy: Privacy): ProfileView {
  const out: ProfileView = {
    handle: full.handle,
    name: full.name,
    title: full.title,
    joinedAt: full.joinedAt,
    moonsOnTheLand: full.moonsOnTheLand,
    primaryCharacterId: full.primaryCharacterId,
  };
  if (privacy.showHome) out.homeStructureKey = full.homeStructureKey ?? null;
  if (privacy.showHearts) {
    out.standing = full.standing;
    out.gratitude = full.gratitude;
  }
  return out;
}

export async function loadProfile(
  pool: Pool,
  villageId: string,
  userId: string,
): Promise<{ view: ProfileView; privacy: Privacy } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `name`, `handle`, `title`, `home_structure_key`, `joined_at`, `privacy`, " +
      "`primary_character_id` FROM `users` WHERE `id` = ? AND `is_example` = 0 LIMIT 1",
    [userId],
  );
  const r = rows[0];
  if (!r) return null;

  const privacy = resolvePrivacy(r.privacy);
  const view: ProfileView = {
    handle: r.handle ?? null,
    name: String(r.name ?? ""),
    title: r.title ?? null,
    joinedAt: r.joined_at ? new Date(r.joined_at).toISOString() : null,
    moonsOnTheLand: moonsSince(r.joined_at),
    primaryCharacterId: r.primary_character_id ?? null,
    homeStructureKey: r.home_structure_key ?? null,
    privacy,
  };
  return { view, privacy };
}

/**
 * The Standing row: one chip per token this member actually holds.
 *
 * Read from the ledger through the registry, so a token added tomorrow appears
 * without this function changing. Zero balances are dropped: a chip reading 0
 * is an accusation, and a member before their first confirmed quest is new on
 * the land rather than empty-handed.
 *
 * `decimals` travels with each chip because the ledger stores minor units. The
 * caller divides; nothing here pretends 100 hundredths of voice is 100.
 */
export async function loadStanding(
  pool: Pool,
  userId: string,
): Promise<Array<{ token: string; name: string; balance: number; decimals: number }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT b.`token_type` AS slug, b.`balance` AS balance, t.`name` AS name, " +
      "t.`decimals` AS decimals, t.`sort_order` AS sort_order " +
      "FROM `token_balances` b JOIN `tokens` t ON t.`slug` = b.`token_type` " +
      "WHERE b.`account_id` = ? AND b.`balance` > 0 AND t.`active` = 1 " +
      "ORDER BY t.`sort_order`, t.`slug`",
    [`mem:${userId}`],
  );
  return rows.map((r) => ({
    token: String(r.slug),
    name: String(r.name ?? r.slug),
    balance: Number(r.balance ?? 0),
    decimals: Number(r.decimals ?? 0),
  }));
}

/**
 * Gratitude, both directions.
 *
 * Given sits co-equal with received on purpose: generosity is a status axis in
 * this village and not only accumulation, and a sheet that shows one number
 * teaches members to collect rather than to notice each other.
 *
 * The headline counts PEOPLE this season, not hearts. "Thanked by 14 members"
 * says something true about a person; a running total says something about a
 * scoreboard.
 */
export async function loadGratitude(
  pool: Pool,
  villageId: string,
  userId: string,
  seasonStart: Date,
): Promise<{ receivedThisSeason: number; givenThisSeason: number; lifetime: number }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT " +
      "(SELECT COUNT(DISTINCT `from_id`) FROM `gratitude_log` " +
      "  WHERE `village_id` = ? AND `to_id` = ? AND `at` >= ?) AS received_people, " +
      "(SELECT COUNT(DISTINCT `to_id`) FROM `gratitude_log` " +
      "  WHERE `village_id` = ? AND `from_id` = ? AND `at` >= ?) AS given_people, " +
      "(SELECT COALESCE(SUM(`amount`), 0) FROM `gratitude_log` " +
      "  WHERE `village_id` = ? AND `to_id` = ?) AS lifetime",
    [villageId, userId, seasonStart, villageId, userId, seasonStart, villageId, userId],
  );
  return {
    receivedThisSeason: Number(rows[0]?.received_people ?? 0),
    givenThisSeason: Number(rows[0]?.given_people ?? 0),
    lifetime: Number(rows[0]?.lifetime ?? 0),
  };
}

/** Find a member by the name a stranger reaches them with. */
export async function userIdForHandle(pool: Pool, handle: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id` FROM `users` WHERE `handle` = ? AND `is_example` = 0 LIMIT 1",
    [handle],
  );
  return rows[0] ? String(rows[0].id) : null;
}
