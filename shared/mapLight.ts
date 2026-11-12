/**
 * THE MAP'S LIGHTS (Phase D, D2): where people meet today, drawn as fireflies
 * at a circle's hearth on the circles map, and only for members who chose it.
 *
 * Presence is personal data, so four rules hold here and the server and the
 * client both read them from this one file:
 *
 *  1. OFF BY DEFAULT. A member's light shows only when their own setting says
 *     `true`, read strictly (`readMapLight`): a missing key, a string "true",
 *     a 1, anything else, is off.
 *  2. MEMBERS ONLY. The read that carries lights answers a signed-in member
 *     and nobody else (server/routes/mapLight.ts); a visitor gets no lights.
 *  3. NEVER A LIST OF NAMES. What crosses the wire is a number per circle and
 *     nothing that names or points at a person: no ids, no names, no times.
 *     The number is held between a floor and a cap (`lightsShown`), so a lone
 *     light can never stand for one known person and a full hearth never
 *     becomes a count to compare.
 *  4. GONE ON ERASURE. The setting lives in the member's `prefs`, which the
 *     erasure tombstone empties (server/lib/erasure.ts, `writeTombstone`), and
 *     the read also refuses anyone who is not a present member
 *     (server/lib/memberPresence.ts), so a departed member is never a light.
 *
 * What makes a light: an opted-in member who joined a circle's live session
 * today, in the village's own day. A circle "meets today" when its rhythm
 * names today or a session of it opened today. Neither needs a migration.
 */

/** The key in a member's `prefs` that holds their choice. */
export const MAP_LIGHT_PREF = "mapLight" as const;

/**
 * Fewer lights than this at a hearth show none. Two, so a single light never
 * stands for the one person a reader already knows went.
 */
export const LIGHT_FLOOR = 2;

/** More lights than this show this many: a gathering, never a tally. */
export const LIGHT_CAP = 8;

/** A member's own choice, read strictly. Only a literal `true` is on. */
export function readMapLight(prefs: unknown): boolean {
  if (!prefs || typeof prefs !== "object") return false;
  return (prefs as Record<string, unknown>)[MAP_LIGHT_PREF] === true;
}

/** How many lights a hearth shows for this many opted-in people. */
export function lightsShown(people: number): number {
  if (!Number.isFinite(people) || people < LIGHT_FLOOR) return 0;
  return Math.min(Math.floor(people), LIGHT_CAP);
}

/** One circle's hearth today. Nothing in it names or points at a person. */
export interface HearthToday {
  circleId: string;
  /** The circle meets today: its rhythm names today, or a session of it opened today. */
  meetsToday: boolean;
  /** Lights to draw, already held to the floor and the cap. 0 draws none. */
  lights: number;
}

/** What `GET /api/map/hearths` answers a signed-in member. */
export interface HearthsPayload {
  /** The village date these lights are for, YYYY-MM-DD. */
  day: string;
  /** Only circles with something to draw: a meeting today or lights. */
  hearths: HearthToday[];
  /** Whether THIS viewer's own light is on. Their own setting, never anybody else's. */
  myLight: boolean;
}

/** What the setting's read and write answer. */
export interface MapLightSetting {
  on: boolean;
}

/** The words a refused write carries. */
export const MAP_LIGHT_REFUSALS = {
  notBoolean: "Say on or off: send { on: true } or { on: false }.",
  signIn: "Sign in to choose whether your light shows on the map.",
} as const;
