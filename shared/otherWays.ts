/**
 * "OTHER WAYS TO JOIN" ON /roles: the two tiles beside the founding team that
 * name the village's open ways in besides a founding role (QA2-07, the lead,
 * 12 Nov 2026; build list "Other ways to join": Founding Seeders, quests,
 * volunteer or work-trade, and propose a new role).
 *
 *   - The resident path tile, to the village's way to stay close
 *     (`org.stay_close_link`), or /resident while that is empty.
 *   - The gifts tile, to the work-with-us door, for volunteering and
 *     work-trade.
 *
 * The words are VILLAGE DATA, four settings under "The founding team" in
 * shared/gameVariables.ts, with the lead's words as their defaults. The page
 * shows its own translated words while a setting still holds the default, so
 * a Spanish reader is never handed the English default.
 *
 * PURE: the server reads the settings and hands them in as `get`; the page
 * reads the result back with `otherWaysOf`, which never throws.
 */

export const OTHER_WAYS_KEYS = {
  seederTitle: "org.other_ways_seeder_title",
  seederLine: "org.other_ways_seeder_line",
  giftsTitle: "org.other_ways_gifts_title",
  giftsLine: "org.other_ways_gifts_line",
} as const;

export type OtherWaysKey = (typeof OTHER_WAYS_KEYS)[keyof typeof OTHER_WAYS_KEYS];

/** The defaults, the lead's words (12 Nov 2026). The page translates a word that still equals its default. */
export const OTHER_WAYS_DEFAULTS = {
  seederTitle: "Become a Founding Seeder",
  seederLine: "Live here one day? Start on the resident path.",
  giftsTitle: "Offer your gifts",
  giftsLine: "Volunteer or work-trade: tell us what you would like to give.",
} as const;

/** Where the resident path tile goes while the village has written no way to stay close. */
export const SEEDER_FALLBACK_HREF = "/resident";
/** The work-with-us door, where volunteering and work-trade are offered. */
export const GIFTS_HREF = "/work-with-us";

export interface OtherWayTile {
  title: string;
  line: string;
  href: string;
}

export interface OtherWays {
  seeder: OtherWayTile;
  gifts: OtherWayTile;
}

const word = (raw: unknown, fallback: string, max = 200): string => {
  const s = typeof raw === "string" ? raw.trim().slice(0, max) : "";
  return s || fallback;
};

/** A page of this site ("/resident", never "//elsewhere") or an https address; anything else is the fallback. */
export function safeHref(raw: unknown, fallback: string): string {
  const s = typeof raw === "string" ? raw.trim().slice(0, 300) : "";
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  if (/^https:\/\/[^\s]+$/i.test(s)) return s;
  return fallback;
}

/** The two tiles from the village's settings. `get` returns the setting's value, or "" for a key the registry does not know. */
export function otherWaysFrom(get: (key: OtherWaysKey | "org.stay_close_link") => string): OtherWays {
  return {
    seeder: {
      title: word(get(OTHER_WAYS_KEYS.seederTitle), OTHER_WAYS_DEFAULTS.seederTitle),
      line: word(get(OTHER_WAYS_KEYS.seederLine), OTHER_WAYS_DEFAULTS.seederLine, 300),
      href: safeHref(get("org.stay_close_link"), SEEDER_FALLBACK_HREF),
    },
    gifts: {
      title: word(get(OTHER_WAYS_KEYS.giftsTitle), OTHER_WAYS_DEFAULTS.giftsTitle),
      line: word(get(OTHER_WAYS_KEYS.giftsLine), OTHER_WAYS_DEFAULTS.giftsLine, 300),
      href: GIFTS_HREF,
    },
  };
}

/** The defaults, for a page whose read failed. */
export const DEFAULT_OTHER_WAYS: OtherWays = otherWaysFrom(() => "");

/** The tiles as an answer carried them, read back safely: anything missing or malformed is its default. */
export function otherWaysOf(raw: unknown): OtherWays {
  const o = raw && typeof raw === "object" ? (raw as Record<string, any>) : {};
  const tile = (t: any, d: OtherWayTile): OtherWayTile => ({
    title: word(t?.title, d.title),
    line: word(t?.line, d.line, 300),
    href: safeHref(t?.href, d.href),
  });
  return { seeder: tile(o.seeder, DEFAULT_OTHER_WAYS.seeder), gifts: tile(o.gifts, DEFAULT_OTHER_WAYS.gifts) };
}
