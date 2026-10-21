/**
 * ONE GATHERING'S EMAIL ROUTES (the comms build spec 5.7), registered from
 * server/routes/commsEvents.ts, so the events module's gate stands in front of
 * every one of them:
 *
 *   GET  /api/events/comms-access     whether the viewer may change gatherings'
 *                                     email settings, asked once per page
 *   GET  /api/events/:id/comms        one gathering's reminders, guests and
 *                                     host, for holders of `event.manage`
 *   PUT  /api/events/:id/comms        change them
 *   GET  /api/events/:id/join         the link every gathering email carries
 *                                     into the online room: a redirect to the
 *                                     room the gathering has NOW
 *
 * and the `cant_make_it` answer for the email action page
 * (server/lib/comms/cantMakeIt.ts), registered with the action registry.
 *
 * WHO MAY DO WHAT. A change is an ACT, so it asks `guardCapability`, which
 * carries the break-glass and the public record. Reading the settings is a
 * LOOK that refuses, so it asks `mayStillSee`. The access answer only reports,
 * so it asks the pure gate and records nothing. The join link answers whoever
 * may see the gathering on the calendar, by the calendar's own layer rule.
 */
import type { Express, Request, Response } from "express";
import { capabilityDecision } from "../../shared/capabilities";
import {
  effectiveGuests,
  effectiveReminders,
  GATHERING_GOING_JOURNEY,
  journeyReminderMinutes,
  guestSettingFromColumn,
  guestSettingToColumn,
  reminderSettingFromColumn,
  reminderSettingToColumn,
  settingsChangeOf,
  type GatheringEmailSettingsView,
} from "../../shared/comms/gatheringSettings";
import type { AppDeps } from "../lib/appDeps";
import { canViewRow, getCalendarRow } from "../lib/calendar";
import { registerAction } from "../lib/comms/actions";
import { cantMakeItAction } from "../lib/comms/cantMakeIt";
import { afterSettingsChange, villageReminderMinutes } from "../lib/comms/eventEmails";
import { journeyStatus } from "../lib/comms/journeyDefinitions";
import { gatheringUrl, hostUserIdOf, memberName } from "../lib/comms/gatheringVars";
import { effectiveLifecycle } from "../lib/modules";
import { boolVar } from "../lib/variables";
import { eventCreatorOf, goingAnswers, memberNamesOf, readEventComms, saveEventComms } from "../repos/eventComms";

export type GatheringRoutesDeps = Pick<
  AppDeps,
  "authedUser" | "isAdmin" | "guardCapability" | "mayStillSee" | "capabilityCtx" | "getPool" | "overLimit" | "clientIp" | "commsPostOffice"
>;

/** A redirect a stranger can ask for, bounded per address. */
const JOIN_PER_IP = 120;
const JOIN_WINDOW_MS = 10 * 60 * 1000;

const NOT_HERE = { error: "That gathering isn't on the calendar." };
const HOSTS_ONLY = { error: "Only a gathering's organisers change its emails." };

/** An http or https link, or null. The room is a host's link; nothing else is followed. */
function roomUrl(raw: string | null): string | null {
  const s = String(raw ?? "").trim();
  if (!s || /[\s\u0000-\u001f\u007f]/.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function register(app: Express, deps: GatheringRoutesDeps): void {
  const { authedUser, isAdmin, guardCapability, mayStillSee, capabilityCtx, getPool, overLimit, clientIp, commsPostOffice } = deps;

  registerAction(cantMakeItAction({ getPool, eventsOn: () => effectiveLifecycle("events") !== "off" }));

  /** The settings view of one gathering, or null when there is no such gathering. */
  async function viewOf(eventId: string, viewerId: string | null): Promise<GatheringEmailSettingsView | null> {
    const pool = getPool();
    const row = await getCalendarRow(pool, eventId);
    if (!row) return null;
    const stored = await readEventComms(pool, eventId);
    const reminders = reminderSettingFromColumn(stored.reminders);
    const guests = guestSettingFromColumn(stored.guests);
    // The village's times are its journey's: the dial until an admin edits a reminder on the Journeys screen.
    const going = await journeyStatus({ getPool }, GATHERING_GOING_JOURNEY);
    const villageMinutes = going ? journeyReminderMinutes(going.definition) : villageReminderMinutes();
    const villageGuests = boolVar("comms.guests_default");
    const host = await hostUserIdOf(pool, eventId);
    const candidates = [
      ...(await goingAnswers(pool, eventId)).map((a) => a.personKey),
      ...[await eventCreatorOf(pool, eventId), stored.hostUserId, viewerId].filter((v): v is string => Boolean(v)),
    ];
    return {
      eventId,
      title: row.title,
      reminders,
      guests,
      hostUserId: stored.hostUserId,
      effective: {
        reminderMinutes: effectiveReminders(reminders, villageMinutes),
        guests: effectiveGuests(guests, villageGuests),
        hostName: await memberName(pool, host),
      },
      village: { reminderMinutes: villageMinutes, guests: villageGuests },
      hostChoices: await memberNamesOf(pool, candidates),
      icsSequence: stored.icsSequence,
    };
  }

  app.get("/api/events/comms-access", async (req: Request, res: Response) => {
    const user = await authedUser(req);
    if (!user) return res.json({ manage: false });
    res.json({ manage: capabilityDecision("event.manage", await capabilityCtx(user)).allowed });
  });

  app.get("/api/events/:id/comms", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in first." });
    if (!(await mayStillSee(req, "event.manage"))) return res.status(403).json(HOSTS_ONLY);
    const view = await viewOf(req.params.id, user.id);
    if (!view) return res.status(404).json(NOT_HERE);
    res.json({ settings: view });
  });

  app.put("/api/events/:id/comms", async (req, res) => {
    if (!(await guardCapability(req, res, "event.manage", { status: 403, body: HOSTS_ONLY }))) return;
    const user = await authedUser(req);
    const pool = getPool();
    const eventId = req.params.id;
    if (!(await getCalendarRow(pool, eventId))) return res.status(404).json(NOT_HERE);
    const parsed = settingsChangeOf(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const { change } = parsed;
    if (change.hostUserId) {
      const [found] = await memberNamesOf(pool, [change.hostUserId]);
      if (!found) return res.status(400).json({ error: "Choose a member of the village to host." });
    }
    const hostBefore = await hostUserIdOf(pool, eventId);
    await saveEventComms(pool, eventId, {
      ...(change.reminders ? { reminders: reminderSettingToColumn(change.reminders) } : {}),
      ...(change.guests ? { guests: guestSettingToColumn(change.guests) } : {}),
      ...(change.hostUserId !== undefined ? { hostUserId: change.hostUserId } : {}),
    });
    const hostAfter = await hostUserIdOf(pool, eventId);
    await afterSettingsChange({ getPool, postOffice: commsPostOffice }, eventId, {
      reminders: change.reminders !== undefined,
      host: change.hostUserId !== undefined ? { from: hostBefore, to: hostAfter } : null,
    });
    res.json({ settings: await viewOf(eventId, user?.id ?? null) });
  });

  app.get("/api/events/:id/join", async (req, res) => {
    if (await overLimit(`comms-join:${clientIp(req)}`, JOIN_PER_IP, JOIN_WINDOW_MS)) {
      return res.status(429).set("Retry-After", "600").json({ error: "Too many requests. Try again in a few minutes." });
    }
    const row = await getCalendarRow(getPool(), req.params.id);
    const user = await authedUser(req);
    const viewer = { userId: user?.id ?? null, isAdmin: user ? await isAdmin(req) : false };
    if (!row || !canViewRow(row, viewer)) return res.status(404).json(NOT_HERE);
    const room = row.attendanceMode !== "offline" ? roomUrl(row.onlineUrl) : null;
    // Never cached: the room is whatever the gathering has now.
    res.set("Cache-Control", "no-store");
    if (!room || row.status === "cancelled") return res.redirect(302, gatheringUrl(commsPostOffice.origin(), row.id));
    res.redirect(302, room);
  });
}
