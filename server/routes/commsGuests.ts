/**
 * GUESTS, ATTENDANCE AND RECAPS ON ONE GATHERING, `/api/events/:id/...` (the
 * comms build spec 5.8 and 5.9), and the three one-click answers their emails
 * carry: `guest_confirm`, `recap_answer` and `rsvp_next`.
 *
 *   GET  /api/events/:id/guest-rsvp?occurrence=   may a visitor come as a guest
 *   POST /api/events/:id/guest-rsvp                a visitor asks; we email a link
 *   GET  /api/events/:id/attendance?occurrence=    the host's list of who came
 *   POST /api/events/:id/attendance                tick who came, or everyone did
 *   GET  /api/events/:id/recap?occurrence=         the composer, the counts, the answers
 *   POST /api/events/:id/recap                     save the draft
 *   POST /api/events/:id/recap/draft               "Draft it for me", saving nothing (polished when the assistant is set)
 *   POST /api/events/:id/recap/send                send it to everybody who said yes
 *
 * ── WHERE THIS IS REGISTERED ───────────────────────────────────────────────
 *
 * From server/routes/commsEvents.ts, which server/index.ts registers right
 * after `app.use("/api/events", requireModule("events"))`. So every route here
 * sits behind the calendar's module gate: with events off each answers the
 * module's own 404. The one-click answers are not routes of their own; they
 * register with the action registry (server/lib/comms/actions.ts) and arrive
 * through `/api/comms/action`, which is plumbing and has no module gate, so
 * each handler asks the guest conditions itself.
 *
 * ── WHO MAY KNOCK ──────────────────────────────────────────────────────────
 *
 * The guest door answers strangers by design, so its POST is bounded twice:
 * per network (`comms-guest:<ip>`) before anything is read, and per address
 * (`comms-guest-addr:<hash>`) once the address is known, so nobody can fill
 * somebody else's inbox with confirmation links. The eleventh request in
 * either window is refused. The bucket holds a hash of the address, never the
 * address, because `rate_hits` is not a table erasure reaches.
 *
 * The host's routes ask the one gate for `event.manage`: a change through
 * `guardCapability`, a look through `mayStillSee`. A look by somebody without
 * the power answers `{ manage: false }` and nothing else, so the gathering
 * card can ask without knowing who is reading it.
 */
import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { emailKeyOf } from "../../shared/comms/address";
import {
  GUEST_ADDRESS_WINDOW_MS,
  GUEST_CHECK_YOUR_EMAIL,
  GUEST_IP_WINDOW_MS,
  GUEST_REQUESTS_PER_ADDRESS,
  GUEST_REQUESTS_PER_IP,
} from "../../shared/comms/guests";
import { hasCapability } from "../../shared/capabilities";
import type { AppDeps } from "../lib/appDeps";
import { registerAction } from "../lib/comms/actions";
import { attendanceView, markAttendance } from "../lib/comms/attendance";
import { guestConfirmAction, guestDoor, requestGuestSeat } from "../lib/comms/guests";
import { assistantReady, polishRecap } from "../lib/comms/recapPolish";
import { draftForMe, recapAnswerAction, recapView, rsvpNextAction, saveRecap, sendRecap, type RecapDeps } from "../lib/comms/recaps";
import { recordEvent } from "../lib/events";
import { isExampleUser } from "../lib/examples";
import { effectiveLifecycle } from "../lib/modules";
import { isTombstone } from "../lib/oauthAccounts";

export type CommsGuestsDeps = Pick<
  AppDeps,
  | "authedUser"
  | "overLimit"
  | "clientIp"
  | "guardCapability"
  | "mayStillSee"
  | "getPool"
  | "commsPostOffice"
  | "members"
  | "capabilityCtx"
  | "deploymentOrigin"
>;

const tooMany = (res: Response) =>
  res.status(429).set("Retry-After", "600").json({ error: "Too many tries. Wait a few minutes, then try again." });

/** The evening a request names: `?occurrence=` on a read, `occurrenceKey` in a body. "" for a one-off. */
const occurrenceOf = (req: Request): string => {
  const raw = req.method === "GET" ? req.query.occurrence : req.body?.occurrenceKey;
  return typeof raw === "string" ? raw.slice(0, 10) : "";
};

/** The deps the comms libraries read, built from the server's. */
export function guestDepsOf(deps: CommsGuestsDeps): RecapDeps {
  const { members, capabilityCtx } = deps;
  return {
    getPool: deps.getPool,
    postOffice: deps.commsPostOffice,
    origin: deps.deploymentOrigin,
    commsLifecycle: () => effectiveLifecycle("comms"),
    eventsLifecycle: () => effectiveLifecycle("events"),
    members,
    memberMayRsvp: async (userId) => {
      const u = await members.byId(userId);
      if (!u || isTombstone({ email: String(u.email ?? "") })) return false;
      return hasCapability("event.rsvp", await capabilityCtx(u));
    },
    member: async (userId) => {
      const u = await members.byId(userId);
      if (!u || !u.email || isExampleUser(u) || isTombstone({ email: String(u.email) })) return null;
      return { id: String(u.id), name: u.name ? String(u.name) : null, email: String(u.email) };
    },
  };
}

export function register(app: Express, deps: CommsGuestsDeps): void {
  const { authedUser, overLimit, clientIp, guardCapability, mayStillSee } = deps;
  const guests = guestDepsOf(deps);

  registerAction(guestConfirmAction(guests));
  registerAction(recapAnswerAction(guests));
  registerAction(rsvpNextAction(guests));

  // ── The guest door ────────────────────────────────────────────────────────

  app.get("/api/events/:id/guest-rsvp", async (req, res) => {
    res.json(await guestDoor(guests, req.params.id, occurrenceOf(req)));
  });

  app.post("/api/events/:id/guest-rsvp", async (req, res) => {
    if (await overLimit(`comms-guest:${clientIp(req)}`, GUEST_REQUESTS_PER_IP, GUEST_IP_WINDOW_MS)) return tooMany(res);
    const email = typeof req.body?.email === "string" ? req.body.email : "";
    const key = emailKeyOf(email);
    if (key) {
      const hashed = crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
      if (await overLimit(`comms-guest-addr:${hashed}`, GUEST_REQUESTS_PER_ADDRESS, GUEST_ADDRESS_WINDOW_MS)) return tooMany(res);
    }
    const outcome = await requestGuestSeat(guests, {
      eventId: req.params.id,
      occurrenceKey: occurrenceOf(req),
      name: req.body?.name,
      email,
      timezone: req.body?.timezone,
    });
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error, reason: outcome.reason ?? null });
    if (!outcome.sent) {
      return res.status(503).json({ error: "Our email didn't go out. Try again in a few minutes." });
    }
    res.json({ ok: true, message: GUEST_CHECK_YOUR_EMAIL });
  });

  // ── Who came ──────────────────────────────────────────────────────────────

  app.get("/api/events/:id/attendance", async (req, res) => {
    // LOOK.
    if (!(await mayStillSee(req, "event.manage"))) return res.json({ manage: false });
    const out = await attendanceView(guests, req.params.id, occurrenceOf(req));
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    res.json(out.view);
  });

  app.post("/api/events/:id/attendance", async (req, res) => {
    if (!(await guardCapability(req, res, "event.manage"))) return;
    const actor = await authedUser(req);
    const out = await markAttendance(
      guests,
      req.params.id,
      occurrenceOf(req),
      { everyone: req.body?.everyone, marks: req.body?.marks },
      String(actor?.id ?? "admin"),
    );
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    res.json(out.view);
  });

  // ── The recap ─────────────────────────────────────────────────────────────

  app.get("/api/events/:id/recap", async (req, res) => {
    // LOOK.
    if (!(await mayStillSee(req, "event.manage"))) return res.json({ manage: false });
    const out = await recapView(guests, req.params.id, occurrenceOf(req));
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    res.json(out.view);
  });

  app.post("/api/events/:id/recap", async (req, res) => {
    if (!(await guardCapability(req, res, "event.manage"))) return;
    const actor = await authedUser(req);
    const out = await saveRecap(
      guests,
      req.params.id,
      occurrenceOf(req),
      { bodyMd: req.body?.bodyMd, missedNoteMd: req.body?.missedNoteMd, recordingUrl: req.body?.recordingUrl },
      String(actor?.id ?? "admin"),
    );
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    const view = await recapView(guests, req.params.id, occurrenceOf(req));
    res.json(view.ok ? view.view : { ok: true });
  });

  app.post("/api/events/:id/recap/draft", async (req, res) => {
    if (!(await guardCapability(req, res, "event.manage"))) return;
    const out = await draftForMe(guests, req.params.id, occurrenceOf(req), req.body?.notes);
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    // With the assistant configured, the host's notes may come back polished (5.14).
    // Twenty an hour per host; past that, or on any failure, the plain draft.
    const host = await authedUser(req);
    const uid = String(host?.id ?? "admin");
    const notes = typeof req.body?.notes === "string" ? req.body.notes.slice(0, 5000) : "";
    const polished =
      notes.trim() && assistantReady() && !(await overLimit(`recap-polish:${uid}`, 20, 60 * 60 * 1000))
        ? await polishRecap({ getPool: deps.getPool }, { draft: out.bodyMd, notes, userId: uid, clientIp: clientIp(req) })
        : null;
    res.json({ bodyMd: polished ?? out.bodyMd, polished: polished !== null });
  });

  app.post("/api/events/:id/recap/send", async (req, res) => {
    if (!(await guardCapability(req, res, "event.manage"))) return;
    const out = await sendRecap(guests, req.params.id, occurrenceOf(req));
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    const actor = await authedUser(req);
    await recordEvent(deps.getPool(), {
      kind: "event_recap_sent",
      text: `sent the recap of a gathering to ${out.came + out.missed} people`,
      actorUserId: actor?.id ?? null,
      entityType: "event",
      entityRef: req.params.id,
      audience: "admin",
    });
    res.json(out);
  });
}
