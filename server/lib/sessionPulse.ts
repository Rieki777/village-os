/**
 * Live Sessions: a circle's season (shared/sessionPulse.ts). The reads are
 * server/repos/sessionPulse.ts; the door is server/routes/sessionPulse.ts.
 *
 *   circlePulse   how a circle has been doing this season, in counts
 *
 * ── THE SEASON ───────────────────────────────────────────────────────────
 *
 * The season is the one a session opened now would be stamped with, read from
 * the instant it began (server/lib/liveSessions.ts `seasonNow`): the village's
 * own seasons when it has written them, the natural ones by hemisphere
 * otherwise. The circle's meetings since then are its season, so a season
 * named twice in a year is two seasons and a long one is read whole; a village
 * that keeps no seasons (the tropics) reads its last three months instead. A
 * meeting is a closed session two or more people were in, counted the house's
 * one way (server/repos/liveSessions.ts `heldWithAtLeast`), so it stays a
 * meeting after one of its people leaves the village.
 *
 * ── WHO ──────────────────────────────────────────────────────────────────
 *
 * The circle's members by standing and admins, the audience its decision log
 * has (`mayKeepRhythm`). Counts only: no name and no words leave here.
 */
import type { Pool } from "mysql2/promise";
import * as store from "../repos/sessionPulse";
import { memberNo, seasonNow, type Outcome, type Refusal } from "./liveSessions";
import { libraryViewer } from "./sessionLibrary";
import { villageTimezone } from "./villageReaders";
import type { LapseContext } from "./orgChart";
import { mayKeepRhythm, villageKey } from "../../shared/sessionRhythm";
import { PULSE_LIMITS, PULSE_REFUSALS, medianOf, type CirclePulse } from "../../shared/sessionPulse";

const refuse = (status: number, error: string): Refusal => ({ ok: false, status, error });
const done = <T>(value: T): Outcome<T> => ({ ok: true, value });

const asDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));

/** A JSON column, read whether the driver handed back text or an object. */
function readJson(raw: unknown): Record<string, any> | null {
  if (raw && typeof raw === "object") return raw as Record<string, any>;
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

export interface PulseDeps {
  circles: () => { id: string; name: string }[];
  lapseContext?: () => LapseContext;
}

export interface PulseAsker {
  userId: string;
  admin: boolean;
}

/**
 * How one circle has been doing this season. Refused in this order: a circle
 * that is not a live one (404), and an asker who is not one of its members or
 * an admin (403).
 */
export async function circlePulse(pool: Pool, who: PulseAsker, circleId: string, deps: PulseDeps, now = new Date()): Promise<Outcome<CirclePulse>> {
  if (!deps.circles().some((c) => c.id === circleId)) return refuse(404, PULSE_REFUSALS.circleUnknown);
  const no = await memberNo(pool, who.userId);
  const viewer = await libraryViewer(pool, { userId: who.userId, no, admin: who.admin }, deps);
  if (!mayKeepRhythm(circleId, viewer)) return refuse(403, PULSE_REFUSALS.notYours);

  const zone = villageTimezone();
  const { season, startedAt } = await seasonNow(pool, now);
  const from = startedAt ?? new Date(now.getTime() - PULSE_LIMITS.noSeasonDays * 86_400_000);
  const met = await store.meetingsSince(pool, circleId, from);
  const ids = met.map((r) => Number(r.id));

  const entries = await store.entryCounts(pool, ids);
  const states = new Map((await store.actionStates(pool, ids)).map((r) => [String(r.status), Number(r.n)] as const));
  const arrivals = met
    .map((r) => readJson(r.summary)?.arrival?.median)
    .filter((m): m is number => typeof m === "number" && Number.isFinite(m));

  return done({
    circleId,
    season,
    since: villageKey(from, zone),
    sessions: met.length,
    people: await store.distinctPeople(pool, ids),
    decisions: entries.decisions,
    tensions: entries.tensions,
    actions: { open: states.get("open") ?? 0, done: states.get("done") ?? 0, letGo: states.get("let_go") ?? 0 },
    arrival: medianOf(arrivals),
  });
}
