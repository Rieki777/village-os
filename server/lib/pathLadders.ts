/**
 * WHERE A MEMBER STANDS ON EACH PATH, worked out from the live rows, every
 * time somebody looks.
 *
 * `shared/pathLadders.ts` names the rungs. This file decides which of them are
 * lit, and it is a PURE FUNCTION of the rows it is handed: no pool, no clock of
 * its own beyond the one passed in, no cache, and above all no write. That
 * matters more than it looks. A position that is computed cannot be stale, and
 * a position that is stored cannot be told apart from one that is.
 *
 * ── HOW A RUNG DROPS ────────────────────────────────────────────────────────
 *
 * It drops because the row it read stopped answering. Every predicate here
 * reads a LIVE fact:
 *
 *   steward   `ended_at IS NULL` on the seating, and `isLapsed` over the
 *             season and the term
 *   resident  `status`, where withdrawn maps to no rung at all
 *   investor  `ended_at IS NULL` on the fact
 *   creator   `closed_at IS NULL` on the venture, and `listed_at`
 *
 * So a founder withdrawing a reservation, a member closing a venture, a fact
 * being ended, or a season simply turning all lower the answer on the next
 * read with nothing written anywhere and no job to run. There is no update
 * path because there is no stored position to update.
 *
 * ── AND WHY HISTORY DOES NOT DROP WITH IT ───────────────────────────────────
 *
 * The three new models are INTERVALS, not flags: `started_at`/`ended_at`,
 * `opened_at`/`listed_at`/`closed_at`. The row survives the fact ending, so it
 * can still say the rung was reached and why it ended. That is what `fell` on
 * each rung carries, and it is set ONLY where a column proves it. Three places
 * in here the record genuinely cannot tell us, and all three are commented at
 * the point where a guess would otherwise be easy:
 *
 *   1. A lapsed steward mandate. `isLapsed` needs the season that was running
 *      when the seating was made, and nothing stores that.
 *   2. A withdrawn reservation above the first rung. `status` is one mutable
 *      column with no history and no date for the change.
 *   3. A venture that was unlisted. `setVentureListed(false)` writes NULL back
 *      into `listed_at`, so the evidence erases itself.
 *
 * In every one of those the rung goes dark and says nothing it cannot prove.
 * A crossing-event table would answer all three, and it would have to store a
 * rung with a date against it, which is the one shape this design forbids.
 *
 * ── EXAMPLE ROWS NEVER MOVE A REAL MEMBER ───────────────────────────────────
 *
 * Every model carries `is_example`, and a standing example seeded to fill a
 * display surface in an empty village must never promote somebody. The repo
 * reads already exclude them; this file excludes them again on the rows it is
 * handed, so a caller that asks for examples on purpose cannot accidentally
 * push a member up a rung.
 */
import {
  PATH_LADDERS,
  hasLadder,
  type LadderPathId,
  type LadderRung,
  type PathLadder,
  type RungDef,
} from "../../shared/pathLadders";
import type { VillageMoon } from "../../shared/villageMoon";
import { isReservationStatus, RESERVATION_STATUSES } from "./housing";
import { isLapsed, type LapseContext } from "./orgChart";

/** Turn an instant into the moon this village calls it. Injected, so this file stays pure. */
export type MoonOf = (at: string | Date | null | undefined) => VillageMoon | null;

/** A moon resolver that names no moon, for a caller that shows no dates. */
export const NO_MOONS: MoonOf = () => null;

// ── The row shapes this file reads ──────────────────────────────────────────
//
// Structural on purpose, and narrower than the repo rows they come from. A
// derivation that took `ReservationRow` whole would be handed a name, an email
// and a phone number it has no business reading, and a test would have to
// invent them to call it.

export interface SeatingFacts {
  orgRoleId: string;
  holderKind: string;
  seasonId: string | null;
  termEndsAt: Date | null;
  startedAt: Date | string;
  endedAt: Date | string | null;
  endedReason: string | null;
  isExample: boolean;
  /** org_roles.expires_each_season. Null inherits the village setting. */
  roleExpiresEachSeason: boolean | null;
  /** org_roles.represents_circle. */
  roleRepresentsCircle: boolean;
  /** org_roles.active. */
  roleActive: boolean;
  /** org_roles.is_example. */
  roleIsExample: boolean;
}

export interface ReservationFacts {
  status: string;
  createdAt: Date | string;
}

export interface InvestorFacts {
  fact: string;
  startedAt: Date | string;
  endedAt: Date | string | null;
  endedReason: string | null;
  isExample?: boolean;
}

export interface VentureFacts {
  openedAt: Date | string;
  listedAt: Date | string | null;
  closedAt: Date | string | null;
  closedReason: string | null;
  isExample?: boolean;
}

export interface PathRows {
  seatings?: readonly SeatingFacts[];
  reservations?: readonly ReservationFacts[];
  investorFacts?: readonly InvestorFacts[];
  ventures?: readonly VentureFacts[];
}

// ── Small shared arithmetic ─────────────────────────────────────────────────

/** Milliseconds, or NaN for anything this build cannot read as an instant. */
const at = (v: Date | string | null | undefined): number => {
  if (v == null) return Number.NaN;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : Number.NaN;
};

/**
 * The row with the earliest (or latest) readable instant, falling back to the
 * first row when none of them can be read. The fallback matters: an unreadable
 * timestamp must still let the row's REASON reach the member, and it costs only
 * the date, which this file is happy to leave null.
 */
function pickBy<T>(rows: readonly T[], of: (r: T) => Date | string | null, latest: boolean): T | null {
  let best: T | null = null;
  let bestAt = Number.NaN;
  for (const r of rows) {
    const t = at(of(r));
    if (Number.isNaN(t)) continue;
    if (Number.isNaN(bestAt) || (latest ? t > bestAt : t < bestAt)) {
      best = r;
      bestAt = t;
    }
  }
  return best ?? rows[0] ?? null;
}

const earliest = <T>(rows: readonly T[], of: (r: T) => Date | string | null): T | null => pickBy(rows, of, false);
const latest = <T>(rows: readonly T[], of: (r: T) => Date | string | null): T | null => pickBy(rows, of, true);

/** A rung starts dark and silent; the ladder below turns on only what it can prove. */
const dark = (def: RungDef): LadderRung => ({ ...def, lit: false, fell: false, note: null, moon: null });

/**
 * The finished ladder. `position` is the HIGHEST lit rung and never a count of
 * them, for the reason `shared/pathLadders.ts` sets out: the investor ladder is
 * four independent facts and a gap under a lit rung is a real state.
 */
function assemble(pathId: LadderPathId, rungs: LadderRung[]): PathLadder {
  let position = 0;
  for (let i = 0; i < rungs.length; i += 1) {
    if (rungs[i]?.lit) position = i + 1;
  }
  const bare = rungs.every((r) => !r.lit && !r.fell && r.note === null);
  return { pathId, rungs, position, empty: bare ? PATH_LADDERS[pathId].empty : null };
}

// ── STEWARD ─────────────────────────────────────────────────────────────────

/**
 * Why a mandate is no longer current, keyed by the union `isLapsed` answers
 * with. Typed `Record<string, string>` this would be a promise nobody checks:
 * a third lapse reason would render an empty line where a sentence belonged.
 *
 * Neither sentence says anything was taken away, because nothing was.
 * `isLapsed` revokes no power at a season turn; the seat is saying out loud
 * that it is ready to be re-chosen.
 */
const LAPSE_WORDS: Record<"term" | "season", string> = {
  term: "Your term on this seat has run out, and the village has not re-chosen it yet.",
  season: "The season you were seated in has turned, and the village has not re-chosen this seat yet.",
};

export function stewardLadder(
  rows: readonly SeatingFacts[],
  ctx: LapseContext,
  moonOf: MoonOf,
): PathLadder {
  const defs = PATH_LADDERS.steward.rungs;
  const [seatedDef, mandateDef, speaksDef] = defs;
  const seated = dark(seatedDef!);
  const mandate = dark(mandateDef!);
  const speaks = dark(speaksDef!);

  // The same filter `mayDeclare` applies, so the top rung and the door it
  // describes can never disagree: a member seating, no example on either side.
  const own = rows.filter((r) => r.holderKind === "member" && !r.isExample && !r.roleIsExample);
  const live = own.filter((r) => r.endedAt === null);
  const over = own.filter((r) => r.endedAt !== null);

  if (live.length > 0) {
    seated.lit = true;
    seated.moon = moonOf(earliest(live, (r) => r.startedAt)?.startedAt ?? null);
  } else if (over.length > 0) {
    // The seating ended. The row stays, carrying its dates and its reason,
    // which is where the history lives now that nothing logs a crossing.
    const last = latest(over, (r) => r.endedAt);
    seated.fell = true;
    seated.note = last?.endedReason ?? null;
    seated.moon = moonOf(last?.endedAt ?? null);
  }

  const current = live.filter(
    (r) =>
      !isLapsed(
        { termEndsAt: r.termEndsAt, seasonId: r.seasonId, endedAt: null },
        { expiresEachSeason: r.roleExpiresEachSeason },
        ctx,
      ).lapsed,
  );
  if (current.length > 0) {
    mandate.lit = true;
    mandate.moon = moonOf(earliest(current, (r) => r.startedAt)?.startedAt ?? null);
  } else if (live.length > 0) {
    // NOT `fell`, however tempting. Proving this rung was once lit needs the
    // season that was running on the day the seating was made, and nothing
    // stores that: `season_id` is the season somebody TYPED, and a seating
    // backfilled into an old season was never current for a moment. So the
    // rung goes dark and says why it is dark, which is the part a column can
    // actually stand behind.
    const freshest = latest(live, (r) => r.startedAt);
    const reason = freshest
      ? isLapsed(
          { termEndsAt: freshest.termEndsAt, seasonId: freshest.seasonId, endedAt: null },
          { expiresEachSeason: freshest.roleExpiresEachSeason },
          ctx,
        ).reason
      : null;
    mandate.note = reason ? LAPSE_WORDS[reason] : null;
  }

  const speaking = (r: SeatingFacts) => r.roleRepresentsCircle && r.roleActive;
  const liveSpeaking = live.filter(speaking);
  const overSpeaking = over.filter(speaking);
  if (liveSpeaking.length > 0) {
    // Lit even while the mandate above is dark, and that is the code's own
    // rule rather than a slip here: `mayDeclare` opens for a lapsed holder in
    // as many words, so dimming this rung with the middle one would claim a
    // power had been taken away when it has not.
    speaks.lit = true;
    speaks.moon = moonOf(earliest(liveSpeaking, (r) => r.startedAt)?.startedAt ?? null);
  } else if (overSpeaking.length > 0) {
    const last = latest(overSpeaking, (r) => r.endedAt);
    speaks.fell = true;
    speaks.note = last?.endedReason ?? null;
    speaks.moon = moonOf(last?.endedAt ?? null);
  }

  return assemble("steward", [seated, mandate, speaks]);
}

// ── RESIDENT ────────────────────────────────────────────────────────────────

/**
 * How far up the ladder each reservation status stands, keyed by the union
 * `server/lib/housing.ts` already defines. Zero for withdrawn, which is the
 * fall: a closed request holds no rung at all.
 *
 * Keyed by the union rather than by `string`, so a fifth status added there is
 * a compile error here instead of a member silently pinned at nothing.
 */
const RESERVATION_RUNG: Record<(typeof RESERVATION_STATUSES)[number], number> = {
  new: 1,
  contacted: 2,
  reserved: 3,
  withdrawn: 0,
};

/** A status this build does not know holds no rung. Fail closed, never up. */
const rungOf = (status: string): number => (isReservationStatus(status) ? RESERVATION_RUNG[status] : 0);

export function residentLadder(rows: readonly ReservationFacts[], moonOf: MoonOf): PathLadder {
  const defs = PATH_LADDERS.resident.rungs;
  const rungs = defs.map((d) => dark(d));

  // The FURTHEST request, because the question is where the member stands on
  // the path: a second request left at "new" does not undo a home held under
  // the first one.
  let best = 0;
  for (const r of rows) best = Math.max(best, rungOf(r.status));

  for (let i = 0; i < rungs.length; i += 1) {
    const rung = rungs[i]!;
    rung.lit = best >= i + 1;
  }

  // `created_at` dates the ASKING and nothing else, so it belongs to the first
  // rung and to no other. There is no column anywhere on this table saying
  // when a status changed, so the two rungs above carry no date and are given
  // none. A "contacted on" drawn from the row's creation date would be a
  // number that looks like a fact.
  const open = rows.filter((r) => rungOf(r.status) > 0);
  const first = rungs[0]!;
  if (best > 0) {
    first.moon = moonOf(earliest(open, (r) => r.createdAt)?.createdAt ?? null);
  } else if (rows.some((r) => isReservationStatus(r.status) && RESERVATION_RUNG[r.status] === 0)) {
    // A status this build KNOWS that holds no rung, which today is exactly
    // `withdrawn`. Tested through the map above instead of against a typed
    // literal, so a village adding a second closing status gets the same
    // sentence for free and an unrecognised status still proves nothing.
    // The row survives the withdrawal and still proves the member asked, so
    // the bottom rung is honestly `fell`. It carries NO date: `status` is one
    // mutable column with no history behind it, so nothing on this table says
    // when the request was closed.
    first.fell = true;
    first.note = "This request is closed, and no home is held for you.";
  }

  // The two rungs above get no `fell` in any case, for the same reason: a row
  // moved back down, or withdrawn from `reserved`, leaves no trace that it was
  // ever there. Claiming otherwise would be inventing the history this table
  // does not keep.

  return assemble("resident", rungs);
}

// ── INVESTOR ────────────────────────────────────────────────────────────────

export function investorLadder(rows: readonly InvestorFacts[], moonOf: MoonOf): PathLadder {
  const real = rows.filter((r) => r.isExample !== true);
  const rungs = PATH_LADDERS.investor.rungs.map((def) => {
    const rung = dark(def);
    // The rung id IS the fact string. `shared/pathLadders.test.ts` holds the
    // four of them against INVESTOR_FACTS, so this lookup cannot drift into
    // matching nothing.
    const mine = real.filter((r) => r.fact === def.id);
    const live = mine.filter((r) => r.endedAt === null);
    const over = mine.filter((r) => r.endedAt !== null);
    if (live.length > 0) {
      rung.lit = true;
      rung.moon = moonOf(earliest(live, (r) => r.startedAt)?.startedAt ?? null);
    } else if (over.length > 0) {
      // `endFact` sets one `ended_at` and deletes nothing, so the fact is
      // still on the record with the reason it ended. This is the whole of
      // "position falls, history does not" in one branch.
      const last = latest(over, (r) => r.endedAt);
      rung.fell = true;
      rung.note = last?.endedReason ?? null;
      rung.moon = moonOf(last?.endedAt ?? null);
    }
    return rung;
  });
  return assemble("investor", rungs);
}

// ── PROSPERITY CREATOR ──────────────────────────────────────────────────────

export function prosperityLadder(rows: readonly VentureFacts[], moonOf: MoonOf): PathLadder {
  const defs = PATH_LADDERS["prosperity-creator"].rungs;
  const [openedDef, listedDef] = defs;
  const opened = dark(openedDef!);
  const listed = dark(listedDef!);

  const real = rows.filter((r) => r.isExample !== true);
  const live = real.filter((r) => r.closedAt === null);
  const closed = real.filter((r) => r.closedAt !== null);

  if (live.length > 0) {
    opened.lit = true;
    opened.moon = moonOf(earliest(live, (r) => r.openedAt)?.openedAt ?? null);
  } else if (closed.length > 0) {
    const last = latest(closed, (r) => r.closedAt);
    opened.fell = true;
    opened.note = last?.closedReason ?? null;
    opened.moon = moonOf(last?.closedAt ?? null);
  }

  const liveListed = live.filter((r) => r.listedAt !== null);
  const closedListed = closed.filter((r) => r.listedAt !== null);
  if (liveListed.length > 0) {
    listed.lit = true;
    listed.moon = moonOf(earliest(liveListed, (r) => r.listedAt)?.listedAt ?? null);
  } else if (closedListed.length > 0) {
    // A CLOSED venture keeps its `listed_at`, so it still proves the member
    // published one. An UNLISTED live venture proves nothing: taking it down
    // writes NULL back into the column, and the evidence erases itself. So
    // this rung falls silently in one of the two cases and says why in the
    // other, and neither of them invents the missing half.
    const last = latest(closedListed, (r) => r.closedAt);
    listed.fell = true;
    listed.note = last?.closedReason ?? null;
    listed.moon = moonOf(last?.closedAt ?? null);
  }

  return assemble("prosperity-creator", [opened, listed]);
}

// ── THE WHOLE ANSWER ────────────────────────────────────────────────────────

/**
 * Every ladder this member is entitled to see, and no others.
 *
 * A path the member does not walk gets no ladder, because a ladder is a claim
 * about somebody's journey and holding rows is not the same as walking a path.
 * A path this build has no columns for gets no ladder either: `hasLadder` is
 * the gate, so a fork that renames a path or invents a fifth one sees nothing
 * instead of an empty frame nobody can ever fill.
 *
 * The order follows the member's own claims, so the panel draws them in the
 * order the tiles do.
 */
export function laddersFor(
  paths: readonly string[],
  rows: PathRows,
  ctx: LapseContext,
  moonOf: MoonOf,
): PathLadder[] {
  const out: PathLadder[] = [];
  const seen = new Set<string>();
  for (const raw of paths) {
    const id = String(raw);
    if (seen.has(id) || !hasLadder(id)) continue;
    seen.add(id);
    if (id === "steward") out.push(stewardLadder(rows.seatings ?? [], ctx, moonOf));
    else if (id === "resident") out.push(residentLadder(rows.reservations ?? [], moonOf));
    else if (id === "investor") out.push(investorLadder(rows.investorFacts ?? [], moonOf));
    else out.push(prosperityLadder(rows.ventures ?? [], moonOf));
  }
  return out;
}

export type { LadderPathId };
