/**
 * THE FACTS OF A MEMBER'S PATH, gathered for shared/yourPath.ts and served as
 * `me.path` (the Root, game feel wave 2; docs/journey/STATE_MAP.md section 6).
 *
 * WHY A REGISTRY. Each fact lives behind a route module that already holds
 * what it takes to read it (the agreements gate, the moon's clock, the
 * proposal window). server/index.ts may not grow and those modules do not
 * import each other, so each one hands this file a reader at registration and
 * `pathFor` asks them all. A reader that throws contributes nothing and is
 * logged once per kind: a member's profile must never fail because one fact
 * could not be read, and the path then answers from what it has.
 *
 * NOT READ YET, and left empty on purpose (the conductor's rules for them are
 * written and tested, so each needs only its reader): a live session room, a
 * task due within two days, an agent's term, and an account's own open-form
 * proposals. STATE_MAP 6.7 lists what each one needs.
 */
import type { Pool } from "mysql2/promise";
import { civilDay, civilDayOf, sayPath, yourPath, yourPathAll, type MemberFacts, type PathAnswer, type PathFacts, type PathMilestone, type SaidPath, type SeatingFacts } from "../../shared/yourPath";
import { termWarningOpensFor, type CycleClock } from "../../shared/cycleClock";
import { openExitOf, ownSeatings, recapEverSent } from "../repos/pathFacts";
import { adoptedUnseatedSeats } from "../repos/seatRenewals";

type Reader = (userId: string, now: Date) => Promise<Partial<PathFacts>>;

const readers = new Map<string, Reader>();
const warned = new Set<string>();

/** A route module hands over its reader. A later registration of the same kind replaces the earlier one. */
export function providePathFacts(kind: "applications" | "onboarding" | "moon" | "proposeWindow", read: Reader): void {
  readers.set(kind, read);
}

/** For tests: forget every reader. */
export function clearPathFactReaders(): void {
  readers.clear();
  warned.clear();
}

export interface PathEnv {
  pool: Pool;
  now: Date;
  timeZone: string;
  clock: CycleClock;
  /** The account's platform role ("founder", "admin", "user"). */
  role: string;
  founderPowerStands: boolean;
  member: MemberFacts;
  /** The village's word for what members sign. */
  commitment: string;
}

/** A seating as the conductor reads it, its days in village time. */
export function seatingFact(s: { roleId: string; role: string; startedAt: Date; termEndsAt: Date | null }, env: Pick<PathEnv, "now" | "timeZone" | "clock">, renewing: boolean): SeatingFacts {
  const lapsed = !!s.termEndsAt && s.termEndsAt.getTime() <= env.now.getTime();
  const warningOpen = !!s.termEndsAt && !lapsed && termWarningOpensFor(s.startedAt, s.termEndsAt, env.clock).getTime() <= env.now.getTime();
  return { roleId: s.roleId, role: s.role, startedOn: civilDayOf(s.startedAt, env.timeZone), termEndsOn: civilDayOf(s.termEndsAt, env.timeZone), warningOpen, lapsed, renewing };
}

/** Everything the conductor reads about one member, now. */
export async function pathFactsFor(env: PathEnv, userId: string): Promise<PathFacts> {
  const facts: PathFacts = {
    now: env.now,
    timeZone: env.timeZone,
    person: { kind: "account", role: env.role, founderPowerStands: env.founderPowerStands, proposals: [] },
    applications: [],
    seatings: [],
    agentsKept: [],
    onboarding: null,
    moon: null,
    sessionLive: null,
    tasksDue: null,
    proposeWindow: null,
    exit: null,
    member: env.member,
    commitment: env.commitment,
  };
  const quietly = async <T>(kind: string, read: () => Promise<T>): Promise<T | null> => {
    try {
      return await read();
    } catch (err) {
      if (!warned.has(kind)) {
        warned.add(kind);
        console.warn(`[path] could not read ${kind}; the path answers without it:`, (err as Error)?.message ?? err);
      }
      return null;
    }
  };
  const own = await quietly("seatings", () => ownSeatings(env.pool, userId));
  if (own?.length) {
    const renewing = (await quietly("renewals", () => adoptedUnseatedSeats(env.pool))) ?? new Set<string>();
    facts.seatings = own.map((s) => seatingFact(s, env, renewing.has(`${userId}@${s.roleId}`)));
    facts.recapEverSent = (await quietly("recaps", () => recapEverSent(env.pool, userId))) ?? false;
  }
  const exit = await quietly("exit", () => openExitOf(env.pool, userId));
  if (exit) facts.exit = { status: exit };
  for (const [kind, read] of Array.from(readers.entries())) {
    const part = await quietly(kind, () => read(userId, env.now));
    if (part) Object.assign(facts, part);
  }
  // The moon speaks only to somebody seated in it.
  if (!facts.seatings.some((s) => !s.lapsed)) facts.moon = null;
  return facts;
}

export interface ServedPath extends PathAnswer {
  /** The village's day, so the page can say "today" in village time. */
  today: string;
  /** The answer in English, for a reader with no words of its own (the connector, an older client). */
  said: SaidPath;
  /** Every other rule that matches, in order: the whole-path page. */
  also: PathAnswer[];
  /** The civil day of a milestone, where the village holds one: walked, or still ahead. */
  dates: Partial<Record<PathMilestone, string>>;
}

/** The days the whole-path page can honestly name. A milestone with no recorded day gets none. */
export function milestoneDates(f: PathFacts): Partial<Record<PathMilestone, string>> {
  const out: Partial<Record<PathMilestone, string>> = {};
  const started = f.seatings.map((s) => s.startedOn).filter((d): d is string => !!d).sort()[0];
  const starts = f.applications.map((a) => a.firstDay).filter((d): d is string => !!d).sort()[0];
  if (started) out.seated = started;
  else if (starts) out.seated = starts;
  if (f.onboarding) out.first_days = f.onboarding.dueOn;
  if (f.moon && f.seatings.length) out.first_recap = f.moon.sendBy;
  return out;
}

/** `me.path`: the one next step, with everything else that waits behind it. */
export async function pathFor(env: PathEnv, userId: string): Promise<ServedPath> {
  const facts = await pathFactsFor(env, userId);
  const all = yourPathAll(facts);
  const first = all[0] ?? yourPath(facts);
  return { ...first, today: civilDay(env.now, env.timeZone), said: sayPath(first, "en"), also: all.slice(1), dates: milestoneDates(facts) };
}
