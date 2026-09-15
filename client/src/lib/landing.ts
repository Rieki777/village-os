/**
 * WHERE A RETURNING MEMBER LANDS.
 *
 * The welcome page is written for someone who has never heard of the village:
 * a hero, the four journeys, an invitation to choose a path. That is exactly
 * right the first time and slightly insulting the tenth, when what you
 * actually want is to see where everyone is and what is happening.
 *
 * The map was promoted to home automatically on the third visit. That is
 * TURNED OFF. The map is not finished enough to be the first thing a
 * returning member sees, and a half-built page arriving unasked is worse
 * than a welcome page they have already read. Nobody is routed there now
 * unless they went and asked for it.
 *
 * The DECISION is kept whole, because the map becoming home is still where
 * this is going. The surfaces around it are not: while the switch is off,
 * NOTHING IN THE PRODUCT WRITES A PREFERENCE. The one control that did
 * (`LandingToggle` on the map page) could never render, because the only
 * preference it offered to undo was one nothing set, so it and `setPreference`
 * are both gone. `getPreference` therefore returns null for every member
 * today, and the preference branches below are the shape of the restore
 * rather than live behaviour.
 *
 * Turning this back on is two things, and both are needed or the first one
 * traps people: restore the visit-count branch at the end of chooseLanding,
 * AND give a member a way to choose, on the page they get sent to.
 *
 * The rules that stay true either way:
 *
 *   - An EXPLICIT choice always wins, in both directions and forever. Someone
 *     who says "give me the welcome page" gets it on visit five hundred. No
 *     surface offers that choice while the switch is off.
 *   - It never routes anyone to a module they cannot see. The map is an
 *     optional module; a village can run without it, and a visitor below its
 *     lifecycle rank must not be bounced into a page that will refuse them.
 *
 * The decision is deliberately pure and synchronous. Waiting on the module
 * catalogue before deciding would mean rendering the welcome page and then
 * yanking it away, which is worse than either outcome on its own — so the
 * caller passes what it already knows, cached from the previous visit.
 */

/**
 * The visit the map WOULD take over on, once it is ready to be a home page.
 * Nothing reads it while the automatic switch is off; it is the number to
 * restore, kept beside the rule it belongs to.
 */
import { storedText, writeStored } from "./safeStorage";

export const LANDING_SWITCH_VISIT = 3;

/** Whether visit count alone may promote the map to the landing page. */
export const AUTO_LANDING_ENABLED = false;

export type LandingChoice = "home" | "map";
/** null = the member has not expressed a preference; the count decides. */
export type LandingPreference = LandingChoice | null;

export interface LandingInputs {
  /** How many times this browser has opened the site, including this one. */
  visits: number;
  /** An explicit member choice, if one has ever been made. */
  preference: LandingPreference;
  /** Whether the map module is visible to THIS viewer, not merely enabled. */
  mapAvailable: boolean;
}

export function chooseLanding({ visits, preference, mapAvailable }: LandingInputs): LandingChoice {
  // An explicit choice outranks everything, including the map being gone —
  // "map" simply cannot be honoured in that case, which the next line handles.
  if (preference === "home") return "home";
  if (!mapAvailable) return "home";
  if (preference === "map") return "map";
  // The automatic promotion is off. A member who never asked for the map
  // keeps the welcome page however many times they come back.
  if (!AUTO_LANDING_ENABLED) return "home";
  return visits >= LANDING_SWITCH_VISIT ? "map" : "home";
}

const VISITS_KEY = "village.landing.visits";
const PREFERENCE_KEY = "village.landing.preference";
const MAP_SEEN_KEY = "village.landing.mapAvailable";

/**
 * Every accessor here fails to the first-visit defaults, which land on the
 * welcome page, the safe direction to be wrong in. See `./safeStorage` for
 * what a browser that refuses actually does.
 */
function read(key: string): string | null {
  return storedText("local", key);
}

function write(key: string, value: string): void {
  /* private browsing: the member simply always sees the welcome page */
  writeStored("local", key, value);
}

/** Increment and return this browser's visit count. Call once per page load. */
export function recordVisit(): number {
  const next = (Number.parseInt(read(VISITS_KEY) ?? "0", 10) || 0) + 1;
  write(VISITS_KEY, String(next));
  return next;
}

export function getVisits(): number {
  return Number.parseInt(read(VISITS_KEY) ?? "0", 10) || 0;
}

/**
 * A member's explicit choice, if one was ever stored. Nothing writes this key
 * while the automatic switch is off, so today this answers null for everyone.
 * It stays because it is the read half of the restore, and because a value
 * left in a browser from an older build must still be honoured.
 */
export function getPreference(): LandingPreference {
  const raw = read(PREFERENCE_KEY);
  return raw === "home" || raw === "map" ? raw : null;
}

/**
 * Remember whether the map was visible last time, so the next visit can decide
 * without waiting for the module catalogue to load. Stale by exactly one visit
 * if an admin turns the map off, which the map page itself corrects.
 */
export function rememberMapAvailable(available: boolean): void {
  write(MAP_SEEN_KEY, available ? "1" : "0");
}

export function wasMapAvailable(): boolean {
  return read(MAP_SEEN_KEY) === "1";
}
