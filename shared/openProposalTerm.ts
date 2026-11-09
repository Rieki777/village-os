/**
 * WHEN A PUBLIC PROPOSAL'S ROLES RUN (Rye, 9 Nov 2026).
 *
 * The open proposal (shared/openProposals.ts) was only ever for next season:
 * adopted, the roles start on that season's first day. Rye: "for this batch of
 * roles going out this week they'll be making proposals that start at this new
 * moon (today) for the next new moon". So a village chooses, in the
 * open-proposals desk, what its public proposals are for:
 *
 *   "season"  next season, as before (the default, so no village changes by
 *             a deploy);
 *   "moon"    the moon: from the new moon it is sent in to the next new moon,
 *             under the village's own cycle clock.
 *
 * A moon proposal stores its days in the proposal's own body (`term`), so what
 * was offered is what is adopted, however late the adoption lands. Adopted, the
 * roles start at adoption (never before the moon's first day) and their term
 * ends on the moon's last day, through the seat term the application already
 * carries (`settings.term.endsOn`, server/lib/seatApplicationWrite.ts).
 *
 * LATE IN A MOON the proposal is for the next one: with fewer than
 * MOON_TERM_MIN_DAYS left, nobody should be adopted into a role that ends days
 * later.
 */
import type { CycleClock } from "./cycleClock";
import { civilDateKey } from "./lunar";
import { civilDayWords } from "./seasonPlans";

export const OPEN_PROPOSAL_TERM_MODES = ["season", "moon"] as const;
export type OpenProposalTermMode = (typeof OPEN_PROPOSAL_TERM_MODES)[number];

export interface OpenProposalTerm {
  kind: "moon";
  /** Civil days in the village's timezone, "2026-11-09". */
  startsOn: string;
  endsOn: string;
}

/** Fewer days than this left in a moon, and a moon proposal is for the next one. */
export const MOON_TERM_MIN_DAYS = 7;

const DAY_MS = 86_400_000;
const CIVIL = /^\d{4}-\d{2}-\d{2}$/;

/** The moon a proposal sent at `now` is for. */
export function moonTermFor(now: Date, clock: CycleClock, timeZone: string): OpenProposalTerm {
  let b = clock.boundsFor(now);
  if (b.endsAt.getTime() - now.getTime() < MOON_TERM_MIN_DAYS * DAY_MS) b = clock.boundsFor(new Date(b.endsAt.getTime() + 60_000));
  // The cycle ends at the instant the next one starts, so its last civil day is the day before that instant.
  return { kind: "moon", startsOn: civilDateKey(b.startsAt, timeZone), endsOn: civilDateKey(new Date(b.endsAt.getTime() - 1), timeZone) };
}

/** A stored term, made safe to read; anything else is no term (a season proposal). */
export function termOf(raw: unknown): OpenProposalTerm | undefined {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!o || o.kind !== "moon") return undefined;
  const startsOn = String(o.startsOn ?? "");
  const endsOn = String(o.endsOn ?? "");
  if (!CIVIL.test(startsOn) || !CIVIL.test(endsOn) || endsOn < startsOn) return undefined;
  return { kind: "moon", startsOn, endsOn };
}

/** "this moon, from 9 November 2026 to 8 December 2026". */
export function moonTermWords(t: OpenProposalTerm): string {
  return `this moon, from ${civilDayWords(t.startsOn)} to ${civilDayWords(t.endsOn)}`;
}

export function isTermMode(v: unknown): v is OpenProposalTermMode {
  return typeof v === "string" && (OPEN_PROPOSAL_TERM_MODES as readonly string[]).includes(v);
}
