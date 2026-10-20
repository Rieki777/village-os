/**
 * WHO CAME: the host ticks each person on the gathering's card, or presses
 * "everyone who said yes came" (the comms build spec 5.9).
 *
 * Marks are per evening and per person key (`event_attendance`), `came` or
 * `missed`. They decide which recap a person gets (shared/comms/recap.ts,
 * `recapAudience`), and the journey engine reads them for steps aimed at the
 * people who came or the people who missed it.
 *
 * WHO MAY BE MARKED: anybody who answered this evening, or who was marked
 * before. A key the evening has never heard of is refused, so a mark can
 * never put a stranger, or a guess at somebody's id, on the list.
 *
 * NOT BEFORE IT BEGINS. Marking who came to something that has not happened
 * is a mistake waiting to be sent as a recap, so marks open at the start.
 *
 * Names only, never addresses: the list is for the host's eyes, and a guest
 * reads as their name with "guest" beside it.
 *
 * No raw SQL: the statements are in server/repos/eventRecaps.ts.
 */
import { ATTENDANCE_MARKS, type AttendanceMark, type AttendanceView } from "../../../shared/comms/recap";
import { answersWithNames, attendanceMarks, markEveryoneCame, setAttendance } from "../../repos/eventRecaps";
import { namesOfPeople } from "../../repos/eventGuests";
import { readEvening } from "./gatheringEvening";
import { zoneOf, type GuestDeps } from "./guests";

export type AttendanceOutcome = { ok: true; view: AttendanceView } | { ok: false; status: number; error: string };

const NOT_FOUND = { ok: false as const, status: 404, error: "This gathering isn't on the calendar." };

/** The host's list for one evening: everybody who answered or was marked, with their mark. */
export async function attendanceView(deps: GuestDeps, eventId: string, occurrenceKey: string): Promise<AttendanceOutcome> {
  const pool = deps.getPool();
  const evening = await readEvening(pool, eventId, occurrenceKey, zoneOf(deps));
  if (!evening) return NOT_FOUND;
  const occ = evening.occurrenceKey;
  const answers = await answersWithNames(pool, eventId, occ);
  const marks = await attendanceMarks(pool, eventId, occ);
  const listed = new Set(answers.map((a) => a.personKey));
  const extra = Array.from(marks.keys()).filter((k) => !listed.has(k));
  const extraNames = extra.length ? await namesOfPeople(pool, extra) : new Map<string, string | null>();
  const people = [
    // Somebody who said no is not on a list of who might have come.
    ...answers
      .filter((a) => a.status !== "declined" || marks.has(a.personKey))
      .map((a) => ({ personKey: a.personKey, name: a.name, guest: a.guest, answer: a.status, mark: marks.get(a.personKey) ?? null })),
    ...extra.map((k) => ({
      personKey: k,
      name: extraNames.get(k) ?? null,
      guest: k.startsWith("guest:"),
      answer: null,
      mark: marks.get(k) ?? null,
    })),
  ];
  const now = deps.now ? deps.now() : Date.now();
  return {
    ok: true,
    view: { manage: true, eventId, occurrenceKey: occ, started: evening.startsAt.getTime() <= now, people, marked: marks.size > 0 },
  };
}

/**
 * Save who came. `everyone: true` marks every yes as came; otherwise `marks`
 * lists each person and their mark. Answers the list as it now stands.
 */
export async function markAttendance(
  deps: GuestDeps,
  eventId: string,
  occurrenceKey: string,
  input: { everyone?: unknown; marks?: unknown },
  markedBy: string,
): Promise<AttendanceOutcome> {
  const pool = deps.getPool();
  const evening = await readEvening(pool, eventId, occurrenceKey, zoneOf(deps));
  if (!evening) return NOT_FOUND;
  const occ = evening.occurrenceKey;
  const now = deps.now ? deps.now() : Date.now();
  if (evening.startsAt.getTime() > now) return { ok: false, status: 409, error: "Opens once the gathering begins." };

  if (input.everyone === true) {
    await markEveryoneCame(pool, eventId, occ, markedBy);
    return attendanceView(deps, eventId, occ);
  }
  if (!Array.isArray(input.marks) || input.marks.length === 0 || input.marks.length > 1000) {
    return { ok: false, status: 400, error: "Tick who came, then save." };
  }
  const known = new Set((await answersWithNames(pool, eventId, occ)).map((a) => a.personKey));
  for (const k of Array.from((await attendanceMarks(pool, eventId, occ)).keys())) known.add(k);
  const marks: Array<{ personKey: string; status: AttendanceMark }> = [];
  for (const m of input.marks as unknown[]) {
    const personKey = typeof (m as any)?.personKey === "string" ? String((m as any).personKey) : "";
    const status = (m as any)?.status;
    if (!(ATTENDANCE_MARKS as readonly unknown[]).includes(status)) return { ok: false, status: 400, error: "Mark each person came or missed." };
    if (!known.has(personKey)) return { ok: false, status: 400, error: "Only people who answered this gathering can be marked." };
    marks.push({ personKey, status: status as AttendanceMark });
  }
  await setAttendance(pool, eventId, occ, marks, markedBy);
  return attendanceView(deps, eventId, occ);
}
