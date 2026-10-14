/**
 * ONE EVENING OF A GATHERING, as the guest and recap emails read it, and the
 * person an email about it goes to (the comms build spec 5.8 and 5.9).
 *
 * THE EVENING comes through server/lib/calendar.ts and never around it: the
 * base row from `getCalendarRow`, and for a recurring gathering the one
 * occurrence `expandOccurrences` finds under its village-time date. That is
 * the same expansion the calendar page, the RSVP and the waitlist use, so the
 * evening a guest confirms is the evening their seat is counted against. A
 * one-off has exactly one evening and its key is "" whatever a caller passes,
 * the rule `rsvp()` keeps.
 *
 * THE VALUES are the gathering's own facts for the merge fields the guest and
 * recap words use. `gathering.when` and `gathering.whenLocal` come from
 * `gatheringWhen` (shared/comms/mergeFields.ts), never formatted here. The
 * online room is left out on purpose: the guest's confirmation email asks for
 * one press, and the room arrives with the confirmation that follows, through
 * the join link that always points at the current room.
 *
 * THE ADDRESSEE is a person key turned into somebody to write to: a guest's
 * contact row, or a member's account with their contact made sure of. Nothing
 * here decides whether they may be written to; the post office asks that of
 * every email.
 */
import type { Pool } from "mysql2/promise";
import { contactIdOfGuestKey } from "../../../shared/comms/kinds";
import { gatheringWhen, type MergeValues } from "../../../shared/comms/mergeFields";
import { contactById } from "../../repos/commsContacts";
import { expandOccurrences, getCalendarRow, type CalendarRow } from "../calendar";
import { ensureContact } from "./contacts";

const DAY_MS = 86_400_000;
const OCCURRENCE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export interface Evening {
  row: CalendarRow;
  /** Village-time YYYY-MM-DD; "" for a one-off. */
  occurrenceKey: string;
  startsAt: Date;
  endsAt: Date | null;
  title: string;
  /** True when this one evening of a series was called off. */
  cancelled: boolean;
}

/** One evening of a gathering, or null when there is no such gathering or no such evening. */
export async function readEvening(pool: Pool, eventId: string, occurrenceKey: string, timezone: string): Promise<Evening | null> {
  const row = await getCalendarRow(pool, eventId);
  if (!row || row.removedAt) return null;
  if (!row.recurrence) {
    return { row, occurrenceKey: "", startsAt: row.startsAt, endsAt: row.endsAt, title: row.title, cancelled: false };
  }
  const key = String(occurrenceKey ?? "");
  if (!OCCURRENCE_KEY.test(key)) return null;
  const noon = Date.parse(`${key}T12:00:00Z`);
  if (!Number.isFinite(noon)) return null;
  const found = expandOccurrences(row, new Date(noon - 2 * DAY_MS), new Date(noon + 2 * DAY_MS), timezone).find(
    (o) => o.occurrenceKey === key,
  );
  if (!found) return null;
  return { row, occurrenceKey: key, startsAt: found.startsAt, endsAt: found.endsAt, title: found.title, cancelled: found.cancelled };
}

/** The first word of a name, or "" (the words then say "there"). */
export const firstNameOf = (name: string | null | undefined): string => String(name ?? "").trim().split(/\s+/)[0] ?? "";

/** The gathering's facts as merge values, with the time in village time and in the reader's zone when known. */
export function eveningValues(e: Evening, zones: { village: string; reader: string | null }): MergeValues {
  const { when, whenLocal } = gatheringWhen(e.startsAt, zones.village, zones.reader);
  const description = String(e.row.description ?? "").trim();
  return {
    "gathering.title": e.title,
    "gathering.when": when,
    "gathering.whenLocal": whenLocal,
    "gathering.where": e.row.attendanceMode === "online" ? "" : String(e.row.locationText ?? ""),
    "gathering.description": description ? { markdown: description } : null,
  };
}

/** The merge values that greet one person. */
export function personValues(name: string | null): MergeValues {
  const full = String(name ?? "").trim();
  return { "person.firstName": firstNameOf(full), "person.name": full };
}

export interface Addressee {
  personKey: string;
  contactId: string;
  email: string;
  name: string | null;
  timezone: string | null;
  /** The member's user id, or null for a guest. */
  userId: string | null;
  guest: boolean;
}

/** A member's name and address by user id. Null for nobody, an example account, or somebody who has left. */
export type MemberLookup = (userId: string) => Promise<{ id: string; name: string | null; email: string } | null>;

/** Somebody to write to for one person key, or null when nobody can be reached under it. */
export async function addresseeOf(deps: { getPool(): Pool; member: MemberLookup }, personKey: string): Promise<Addressee | null> {
  const pool = deps.getPool();
  const guestContact = contactIdOfGuestKey(personKey);
  if (guestContact) {
    const c = await contactById(pool, guestContact);
    if (!c) return null;
    return { personKey, contactId: c.id, email: c.email, name: c.name, timezone: c.timezone, userId: null, guest: true };
  }
  const m = await deps.member(personKey);
  if (!m || !m.email) return null;
  const made = await ensureContact(deps, { email: m.email, name: m.name, userId: m.id, source: "account" });
  if (!made) return null;
  const c = await contactById(pool, made.id);
  return {
    personKey,
    contactId: made.id,
    email: m.email,
    name: m.name ?? c?.name ?? null,
    timezone: c?.timezone ?? null,
    userId: m.id,
    guest: false,
  };
}
