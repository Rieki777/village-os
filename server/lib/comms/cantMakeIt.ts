/**
 * "CAN'T MAKE IT", from an email (the comms build spec 5.7): the signed
 * `cant_make_it` link in a confirmation or a reminder opens the action page,
 * which names the gathering and its date, and one press gives the seat back.
 *
 * The press calls `withdrawRsvp`, the same door the calendar's own button
 * uses: it frees the seat under the gathering's row lock and hands it to the
 * next person waiting, and its trigger stops the person's reminders. A member
 * and a guest are the same here, because the link carries the person key
 * (`p`: a user id or `guest:<contactId>`), the gathering (`e`) and, for an
 * evening of a series, its date (`o`). Ids only, never an address.
 *
 * Nothing acts on GET: `describe` only reads. Pressing twice gives the seat
 * back once; the second press finds no seat and says the same thing.
 *
 * Gated on the events module like the rest of `/api/events`: with the
 * calendar off, the link reaches nothing.
 */
import type { Pool } from "mysql2/promise";
import type { ActionDescription, ActionOutcome } from "../../../shared/comms/preferences";
import { getCalendarRow } from "../calendar";
import { withdrawRsvp } from "../gatherings";
import { villageTimezone } from "../villageReaders";
import { rsvpStatusOf } from "../../repos/eventComms";
import type { ActionHandler } from "./actions";
import { notEnded, occurrenceOf, snapshotOf, whenValues, type GatheringSnapshot } from "./gatheringVars";
import type { LinkPayload } from "./links";

export interface CantMakeItDeps {
  getPool(): Pool;
  /** True while the events module serves anybody. */
  eventsOn(): boolean;
  /** The village's IANA zone. Absent: the zone the seasons turn on. */
  timezone?(): string;
}

interface Target {
  eventId: string;
  personKey: string;
  occurrenceKey: string;
}

const targetOf = (payload: LinkPayload): Target | null => {
  const eventId = typeof payload.e === "string" ? payload.e : "";
  const personKey = typeof payload.p === "string" ? payload.p : "";
  const occurrenceKey = typeof payload.o === "string" ? payload.o : "";
  return eventId && personKey ? { eventId, personKey, occurrenceKey } : null;
};

const GIVE_BACK = "cant";

const freeOutcome = (g: GatheringSnapshot, when: string, description: ActionDescription | null): ActionOutcome => ({
  ok: true,
  title: "Seat given back",
  paragraphs: [`Your seat at ${g.title}, ${when}, goes to the next person waiting.`],
  description,
});

export function cantMakeItAction(deps: CantMakeItDeps): ActionHandler {
  const zone = () => (deps.timezone ? deps.timezone() : villageTimezone()) || "UTC";

  /** The evening the link names, or null when the calendar is off or the gathering is gone. */
  async function load(payload: LinkPayload): Promise<{ t: Target; g: GatheringSnapshot; when: string } | null> {
    if (!deps.eventsOn()) return null;
    const t = targetOf(payload);
    if (!t) return null;
    const row = await getCalendarRow(deps.getPool(), t.eventId);
    if (!row || row.removedAt) return null;
    const occ = occurrenceOf(row, t.occurrenceKey, zone());
    if (!occ) return null;
    const g = snapshotOf(row, occ);
    return { t, g, when: whenValues(g, zone(), null).when };
  }

  async function describe(payload: LinkPayload): Promise<ActionDescription | null> {
    const found = await load(payload);
    if (!found) return null;
    const { t, g, when } = found;
    const base = { purpose: "cant_make_it" as const, input: null };
    if (g.status === "cancelled" || g.occurrenceCancelled) {
      return { ...base, title: `${g.title} is cancelled`, paragraphs: [`It was planned for ${when}. Nothing to do.`], choices: [], current: null };
    }
    if (!notEnded(g, new Date())) {
      return { ...base, title: `${g.title} has ended`, paragraphs: [`It met ${when}.`], choices: [], current: null };
    }
    const status = await rsvpStatusOf(deps.getPool(), t.eventId, t.personKey, g.occurrenceKey);
    if (status !== "going") {
      return {
        ...base,
        title: "No seat held",
        paragraphs: [`You're not down as coming to ${g.title}, ${when}.`, "To come after all, say yes on the calendar."],
        choices: [],
        current: null,
      };
    }
    return {
      ...base,
      title: `Can't make it to ${g.title}?`,
      paragraphs: [when, "Give your seat back and it goes to the next person waiting."],
      choices: [{ value: GIVE_BACK, label: "Give my seat back", primary: true }],
      current: null,
    };
  }

  return {
    purpose: "cant_make_it",
    describe: (payload) => describe(payload),
    async act(payload, body) {
      const found = await load(payload);
      if (!found) return { ok: false, status: 404, error: "This gathering isn't on the calendar any more." };
      if (body.choice !== GIVE_BACK) return { ok: false, status: 400, error: "Press Give my seat back to free it." };
      const { t, g, when } = found;
      if (g.status !== "scheduled" && g.status !== "postponed") {
        return { ok: false, status: 409, error: `${g.title} is cancelled. Nothing to do.` };
      }
      const status = await rsvpStatusOf(deps.getPool(), t.eventId, t.personKey, g.occurrenceKey);
      // A second press finds the seat already free, and says so the same way.
      if (status === "going") await withdrawRsvp(deps.getPool(), t.eventId, t.personKey, g.occurrenceKey);
      return { ok: true, outcome: freeOutcome(g, when, await describe(payload)) };
    },
  };
}
