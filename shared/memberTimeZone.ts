/**
 * Time zones for people (role journey L6). Pure, so the server, the client, the
 * open form and the interview screens share one reading of "a zone".
 *
 * A zone is an IANA name such as "America/Costa_Rica". Anything else (an
 * offset, an abbreviation, free text) is refused, because only a name keeps
 * its meaning across daylight-saving changes.
 */

export const TIME_ZONE_MAX = 64;

/** True when the runtime knows this IANA name. */
export function isValidTimeZone(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const zone = raw.trim();
  if (!zone || zone.length > TIME_ZONE_MAX) return false;
  // A person's zone is a place name, never a signed offset.
  if (/^[+-]/.test(zone)) return false;
  // Region/City, or UTC itself: bare abbreviations ("CST", "EST5EDT") are refused.
  if (zone !== "UTC" && !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The zone trimmed, or null when it is empty or not a zone. */
export function normalizeTimeZone(raw: unknown): string | null {
  return isValidTimeZone(raw) ? (raw as string).trim() : null;
}

/** The zone this browser lives in, or null when the browser will not say. */
export function browserTimeZone(): string | null {
  try { return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { return null; }
}

/** What a person's zone is: their saved choice, else the browser's, else UTC. */
export function effectiveTimeZone(saved: string | null | undefined, browser: string | null = browserTimeZone()): string {
  return normalizeTimeZone(saved) ?? browser ?? "UTC";
}

/** "CST" or "GMT-6": the short name a zone prints beside a time. */
export function shortZoneName(timeZone: string, at: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(at);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  } catch { return timeZone; }
}

function clock(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone }).format(at);
}

/** The parts of one instant as read in two zones. */
export interface TwoZones {
  /** True when the two zones read a different wall clock at this instant. */
  differ: boolean;
  /** The reader's own reading, zone named: "Mon, Nov 16, 7:00 PM CST". */
  mine: string;
  /** The other person's reading, or null when it reads the same. */
  theirs: string | null;
  /** One line carrying both, or just `mine` when they agree. */
  line: string;
}

/**
 * One instant in the viewer's zone and, when it reads differently, in the
 * other person's zone too. Used wherever an applicant and a holder meet.
 * Bad zones fall back to UTC rather than throwing, so a screen never breaks.
 */
export function twoZones(instant: Date | string | number, viewerZone: string, otherZone: string | null | undefined, otherLabel = "for them"): TwoZones {
  const at = instant instanceof Date ? instant : new Date(instant);
  const mineZone = isValidTimeZone(viewerZone) ? viewerZone.trim() : "UTC";
  const mineClock = clock(at, mineZone);
  const mine = `${mineClock} ${shortZoneName(mineZone, at)}`;
  const other = normalizeTimeZone(otherZone);
  if (!other || other === mineZone) return { differ: false, mine, theirs: null, line: mine };
  const otherClock = clock(at, other);
  if (otherClock === mineClock) return { differ: false, mine, theirs: null, line: mine };
  const theirs = `${otherClock} ${shortZoneName(other, at)}`;
  return { differ: true, mine, theirs, line: `${mine} (${theirs} ${otherLabel})` };
}
