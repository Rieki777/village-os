/**
 * A village's own seasons, read from the `calendar.seasons` dial.
 *
 * WHY A VILLAGE NAMES ITS OWN. The platform's default seasons are the four
 * temperate ones, turned by hemisphere at the solstices and equinoxes. That is
 * a true description of a year in a temperate place and a wrong one in the
 * tropics, where the year turns on rain: a village near the equator was told
 * it met in "autumn". So a village can write its seasons down, each with the
 * day it starts, and the live room's stamp names the season the village would
 * say aloud.
 *
 * THE SHAPE, and the one place it is written down. A list of `Name: MM-DD`
 * separated by commas, the same comma list the other date dials use
 * (`economy.claims_week_starts`). For example:
 *
 *   Dry: 12-01, Green: 05-01, Little summer: 07-10, Green: 08-01
 *
 * A name may come back later in the year, as the green season does there,
 * because some places have two of one season. Two seasons starting on one
 * day is refused, since the second could never be on. Order does not matter:
 * the list is sorted by its dates.
 *
 * STRICT ON PURPOSE. `villageSeasonsProblem` refuses the whole list at the
 * Admin door when any part is wrong, and `parseVillageSeasons` reads a list
 * with any wrong part as no list at all. A typo that quietly dropped one
 * season would stretch its neighbour over months, and nobody would see why.
 * Blank is a real answer and means "use the platform's own seasons".
 *
 * Which season is on: the one whose start most recently passed, counting by
 * the village's own month and day and wrapping the year, so a season that
 * starts in December is still on in March when the next one starts in May.
 */

/** One season: its name and the month and day it starts. */
export interface VillageSeason {
  name: string;
  month: number;
  day: number;
}

/** A season's name stays short, so the room's stamp fits on one line. */
export const VILLAGE_SEASON_NAME_MAX = 40;
/** Twelve is a season a month, which is already more than any year needs. */
export const VILLAGE_SEASONS_MAX = 12;

/**
 * The Tropics of Cancer and Capricorn, in degrees of latitude. Inside them the
 * sun is overhead twice a year and the four temperate seasons do not describe
 * the year, so the room names none unless the village has named its own.
 */
export const TROPIC_LATITUDE = 23.44;

/**
 * Letters, marks and digits in any script, spaces, and a few marks names use.
 * Built with the constructor because the app's typecheck targets ES5, which
 * refuses the `u` flag on a regular expression literal.
 */
const NAME_SHAPE = new RegExp("^[\\p{L}\\p{M}\\p{N}][\\p{L}\\p{M}\\p{N} '.&()/-]*$", "u");
const PART_SHAPE = /^(.+?)\s*:\s*(\d{1,2})-(\d{1,2})$/;

/** A real day of a real month. 02-29 counts, since it is real in a leap year. */
function realMonthDay(month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // 2024 is a leap year, so the probe accepts the 29th of February.
  const probe = new Date(Date.UTC(2024, month - 1, day));
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

type Parsed = { ok: true; seasons: VillageSeason[] } | { ok: false; problem: string };

function read(raw: string): Parsed {
  const parts = String(raw ?? "")
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  const shape = "Write each season as a name, a colon and the day it starts, separated by commas, such as Planting: 03-01, Harvest: 09-01.";
  if (parts.length > VILLAGE_SEASONS_MAX) return { ok: false, problem: `At most ${VILLAGE_SEASONS_MAX} seasons.` };
  const seasons: VillageSeason[] = [];
  const days = new Set<number>();
  for (const part of parts) {
    const m = PART_SHAPE.exec(part);
    if (!m) return { ok: false, problem: shape };
    const name = m[1].replace(/\s+/g, " ").trim();
    if (name.length > VILLAGE_SEASON_NAME_MAX || !NAME_SHAPE.test(name)) {
      return { ok: false, problem: `A season's name is letters, numbers and spaces, up to ${VILLAGE_SEASON_NAME_MAX} characters.` };
    }
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (!realMonthDay(month, day)) return { ok: false, problem: `"${part}" does not name a real day. ${shape}` };
    const key = month * 100 + day;
    if (days.has(key)) return { ok: false, problem: "Two seasons cannot start on the same day." };
    days.add(key);
    seasons.push({ name, month, day });
  }
  seasons.sort((a, b) => a.month * 100 + a.day - (b.month * 100 + b.day));
  return { ok: true, seasons };
}

/** Why a value cannot be stored as the village's seasons, or null when it can (blank included). */
export function villageSeasonsProblem(raw: string): string | null {
  const r = read(raw);
  return r.ok ? null : r.problem;
}

/**
 * The village's seasons in calendar order, or null when it has named none or
 * the stored value cannot be read whole.
 */
export function parseVillageSeasons(raw: string | null | undefined): VillageSeason[] | null {
  const r = read(String(raw ?? ""));
  return r.ok && r.seasons.length ? r.seasons : null;
}

/**
 * The season on at a month and day: the one whose start most recently passed,
 * and before the year's first start, the last season of the year before.
 */
export function villageSeasonOn(seasons: readonly VillageSeason[], month: number, day: number): string | null {
  if (!seasons.length) return null;
  const today = month * 100 + day;
  const start = (s: VillageSeason) => s.month * 100 + s.day;
  // The latest start on or before today; with none, the latest start of all,
  // which is the season that began last year and is still on.
  let passed: VillageSeason | null = null;
  let latest: VillageSeason = seasons[0];
  for (const s of seasons) {
    if (start(s) > start(latest)) latest = s;
    if (start(s) <= today && (passed == null || start(s) > start(passed))) passed = s;
  }
  return (passed ?? latest).name;
}

/** True when a latitude sits between the two tropics. */
export function isTropicalLatitude(latitude: number): boolean {
  return Number.isFinite(latitude) && Math.abs(latitude) < TROPIC_LATITUDE;
}
