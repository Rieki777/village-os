/**
 * THE LOAD CHECK on a role proposal's terms step (role proposals PR C).
 *
 * Rye, 2026-10-22, one of the ideas he loved: "a load check across the
 * roles". Each role's time is the words on its time chip (`timeCommitment`,
 * CCOS Time Commitment), which a member writes as they like: "8 hours a week",
 * "2 days a week", "Half time", "Part of a full-time season". This adds up the
 * ones it can read as hours and says plainly when they go past a full season.
 *
 * A FULL SEASON is 40 hours a week (`FULL_SEASON_HOURS`), and the sentence
 * says so, so nobody has to guess what the number is measured against.
 *
 * A time it cannot read as hours is never guessed at. It is named, with why,
 * and left out of the sum, and the sentence says the sum leaves it out.
 *
 * The platform never judges load (Rye, 2026-10-22: the card's own load read is
 * the owner's). This counts what the member wrote and says what it adds up to.
 *
 * Pure: no clock, no pool, no imports.
 */

/** Hours a week in a full-time season. */
export const FULL_SEASON_HOURS = 40;
/** Working days in a week, for "N days a week". */
const DAY_HOURS = FULL_SEASON_HOURS / 5;
/** Weeks in a moon (29.53 days), for "N hours a moon" or "a month". */
const WEEKS_A_MOON = 29.53 / 7;

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;
const RANGE = String.raw`${NUMBER}(?:\s*(?:-|to|or)\s*${NUMBER})?`;
const EVERY = String.raw`(?:a|an|per|each|every|\/)`;

const num = (s: string | undefined): number => (s ? Number(s.replace(",", ".")) : NaN);
/** The larger end of "6 to 8", so a check about going past a full season never reads low. */
const upper = (a: string | undefined, b: string | undefined): number => Math.max(num(a), Number.isNaN(num(b)) ? -Infinity : num(b));

/**
 * One role's time as hours a week, or null when the words do not say an
 * amount of time. PURE.
 */
export function hoursAWeek(words: string | null | undefined): number | null {
  const s = String(words ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!s) return null;
  let m = new RegExp(String.raw`${RANGE}\s*(?:hours?|hrs?|h)\b\s*${EVERY}?\s*(?:week|wk)\b`).exec(s);
  if (m) return upper(m[1], m[2]);
  m = new RegExp(String.raw`${RANGE}\s*(?:hours?|hrs?|h)\b\s*${EVERY}?\s*(?:moon|month)\b`).exec(s);
  if (m) return upper(m[1], m[2]) / WEEKS_A_MOON;
  m = new RegExp(String.raw`${RANGE}\s*days?\s*${EVERY}?\s*(?:week|wk)\b`).exec(s);
  if (m) return upper(m[1], m[2]) * DAY_HOURS;
  m = new RegExp(String.raw`${RANGE}\s*(?:%|percent)`).exec(s);
  if (m) return (upper(m[1], m[2]) / 100) * FULL_SEASON_HOURS;
  // "Part of a full-time season" says the role is a share of one, and not how big a share.
  if (/\bpart\b/.test(s)) return null;
  if (/\bhalf[- ]?time\b/.test(s)) return FULL_SEASON_HOURS / 2;
  if (/\bfull[- ]?time\b/.test(s)) return FULL_SEASON_HOURS;
  return null;
}

export interface LoadRoleIn {
  name: string;
  /** The role's time words as proposed, or null when none are written. */
  time: string | null;
}

export interface LoadCheck {
  /** The roles whose time reads as hours, each with its hours a week. */
  counted: Array<{ name: string; hours: number }>;
  /** The roles left out of the sum, each with why. */
  notCounted: Array<{ name: string; why: string }>;
  /** The sum, rounded to a whole hour. */
  hours: number;
  /** The sum goes past a full season. */
  over: boolean;
  /** The sentences a page draws, in order. */
  lines: string[];
}

export const LOAD_WORDS = {
  heading: "Load check",
  lede: `Each role's time, added up. A full season here is ${FULL_SEASON_HOURS} hours a week.`,
  over: (hours: number) =>
    `Together these roles ask for about ${hours} hours a week. That is more than a full season of ${FULL_SEASON_HOURS} hours a week.`,
  within: (hours: number) => `Together these roles ask for about ${hours} hours a week. That fits in a full season of ${FULL_SEASON_HOURS} hours a week.`,
  noneCounted: "None of these roles says its time in hours or days yet, so there is nothing to add up.",
  leftOut: "The roles below are left out of that sum.",
  noTime: "No time written yet",
  notHours: (words: string) => `"${words}" does not say how many hours`,
  noRoles: "Pick a role first, and its time is added up here.",
  oneRole: (name: string, hours: number) => `${name}: about ${hours} hours a week`,
} as const;

/** The whole check for a proposal's roles. PURE. */
export function loadCheck(roles: readonly LoadRoleIn[]): LoadCheck {
  const counted: LoadCheck["counted"] = [];
  const notCounted: LoadCheck["notCounted"] = [];
  for (const r of roles) {
    const time = String(r.time ?? "").trim();
    if (!time) {
      notCounted.push({ name: r.name, why: LOAD_WORDS.noTime });
      continue;
    }
    const h = hoursAWeek(time);
    if (h === null || !Number.isFinite(h)) notCounted.push({ name: r.name, why: LOAD_WORDS.notHours(time) });
    else counted.push({ name: r.name, hours: Math.round(h * 10) / 10 });
  }
  const hours = Math.round(counted.reduce((n, c) => n + c.hours, 0));
  const over = hours > FULL_SEASON_HOURS;
  const lines: string[] = [];
  if (!roles.length) lines.push(LOAD_WORDS.noRoles);
  else if (!counted.length) lines.push(LOAD_WORDS.noneCounted);
  else {
    lines.push(over ? LOAD_WORDS.over(hours) : LOAD_WORDS.within(hours));
    if (notCounted.length) lines.push(LOAD_WORDS.leftOut);
  }
  return { counted, notCounted, hours, over, lines };
}
