/**
 * THE COMMS ROUTES ON ONE GATHERING, `/api/events/:id/...`: a guest's RSVP,
 * the time vote, the recap, attendance, and the gathering's own email
 * settings (the comms build spec 5.7 to 5.10).
 *
 * Each lane's routes live in their own file and register from here, behind
 * the same gate: the gathering's email settings (C2,
 * server/routes/commsGatherings.ts), guests, attendance and the recap (C3,
 * server/routes/commsGuests.ts), and the time vote (C4,
 * server/routes/commsPolls.ts).
 *
 * ── WHERE THIS IS REGISTERED, AND WHY IT MUST STAY THERE ───────────────────
 *
 * AFTER `app.use("/api/events", requireModule("events"))` in server/index.ts,
 * so the calendar module's gate applies to every route below: with events
 * off, each answers the module's own 404, the same as the RSVP route beside
 * them. Express matches in registration order, so a `register` call moved
 * above that mount would put these routes in FRONT of their own module gate
 * and every check in the gate set would stay green (nothing in it reads
 * order). server/comms.foundation.e2e.test.ts asks one of these routes with
 * the events module off and expects the 404; a moved registration turns it
 * red.
 *
 * WHO MAY KNOCK, ALREADY SETTLED. The guest door answers strangers by
 * design, so it takes a per-IP `overLimit` bucket now (C3 adds the
 * per-address one with the form, 5.8). Every other write here is a member's
 * or a host's, so it refuses somebody signed out before anything else.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { register as registerGatheringRoutes, type GatheringRoutesDeps } from "./commsGatherings";
import { register as registerGuestRoutes, type CommsGuestsDeps } from "./commsGuests";
import { register as registerTimePolls, type PollRouteDeps } from "./commsPolls";

type Deps = Pick<AppDeps, "authedUser" | "overLimit" | "clientIp"> & GatheringRoutesDeps & CommsGuestsDeps & PollRouteDeps;

export function register(app: Express, deps: Deps): void {
  // A gathering's own email settings, its join link, and "can't make it" (lane C2).
  registerGatheringRoutes(app, deps);

  // Guests, attendance and the recap (the guests and recaps lane, C3).
  registerGuestRoutes(app, deps);

  // The live time vote (C4, 5.10).
  registerTimePolls(app, deps);
}
