/**
 * PEOPLE ON JOURNEYS: enroll, stop, touch, and the tick
 * (the comms build spec 5.6).
 *
 * `enroll`, `stop` and `touch` work today over `comms_enrollments`, so the
 * lanes that fire triggers can put people on journeys and take them off
 * before the engine exists. `tick` is a stub that answers zeros: the journey
 * lane (C1) builds the planner and the tick that reads these rows and posts
 * each due step with the key `j:<journey>:<step>:<enrollmentId>`.
 *
 * Every write is a repository call (server/repos/commsJourneys.ts). Nothing
 * here touches SQL.
 */
import crypto from "node:crypto";
import type { Pool } from "mysql2/promise";
import { defaultJourney } from "../../../shared/comms/defaults/journeys";
import { insertEnrollment, stopEnrollments, touchEnrollments, villageJourneyVersion } from "../../repos/commsJourneys";

export interface JourneyDeps {
  getPool(): Pool;
}

const newEnrollmentId = (): string => `enr_${crypto.randomBytes(12).toString("hex")}`;

/** A caller's bug, said in words. */
function need(ok: boolean, what: string): void {
  if (!ok) throw new RangeError(`journeys: ${what}`);
}

/**
 * Put a person on a journey for one subject.
 *
 * The version recorded is the village's own when it holds one and the
 * platform default's otherwise, and the person keeps it when the journey is
 * edited later. `anchorAt` dates the enrollment, for a person who joined
 * before the trigger reached here; it defaults to now.
 *
 * Calling it twice for the same person, journey and subject is one
 * enrollment, and the second call says it created nothing.
 */
export async function enroll(
  deps: JourneyDeps,
  input: { journeyKey: string; contactId: string; subjectRef: string; facts?: Record<string, unknown>; anchorAt?: Date },
): Promise<{ enrollmentId: string; created: boolean }> {
  need(typeof input.journeyKey === "string" && input.journeyKey.length > 0 && input.journeyKey.length <= 100, "a journey key is 1 to 100 characters");
  need(typeof input.contactId === "string" && input.contactId.length > 0 && input.contactId.length <= 64, "a contact id is 1 to 64 characters");
  need(typeof input.subjectRef === "string" && input.subjectRef.length > 0 && input.subjectRef.length <= 191, "a subject is 1 to 191 characters");
  const pool = deps.getPool();
  const version = (await villageJourneyVersion(pool, input.journeyKey)) ?? defaultJourney(input.journeyKey)?.version ?? 1;
  const anchor = input.anchorAt instanceof Date && Number.isFinite(input.anchorAt.getTime())
    ? Math.floor(input.anchorAt.getTime() / 1000)
    : null;
  return insertEnrollment(pool, {
    id: newEnrollmentId(),
    journeyKey: input.journeyKey,
    journeyVersion: version,
    contactId: input.contactId,
    subjectRef: input.subjectRef,
    facts: input.facts ?? null,
    enrolledAt: anchor,
  });
}

/**
 * Stop every active enrollment matching ALL the given conditions, and say how
 * many. A subject matches exactly or as a prefix that ends where an id does,
 * so `{ subjectRef: "event:ev-1" }` stops every evening of one gathering.
 * With no condition at all it stops nothing.
 */
export async function stop(
  deps: JourneyDeps,
  where: { journeyKey?: string; contactId?: string; subjectRef?: string },
  reason: string,
): Promise<number> {
  need(typeof reason === "string" && reason.length > 0, "a stop needs a reason");
  return stopEnrollments(deps.getPool(), where, reason);
}

/**
 * Ask the next tick to re-plan every active enrollment on a subject, because
 * something about it moved. `touch("event:<id>")` runs on every change to a
 * gathering, so a moved time re-plans its reminders.
 */
export async function touch(deps: JourneyDeps, subjectRefPrefix: string): Promise<number> {
  return touchEnrollments(deps.getPool(), subjectRefPrefix);
}

/**
 * Plan and post every due step. A STUB until the journey lane (C1) builds it,
 * answering zeros so the admin "run now" button and the scheduler can be
 * wired to it today.
 */
export async function tick(
  _deps: JourneyDeps,
  _opts: { limit?: number } = {},
): Promise<{ checked: number; posted: number; stopped: number }> {
  return { checked: 0, posted: 0, stopped: 0 };
}
