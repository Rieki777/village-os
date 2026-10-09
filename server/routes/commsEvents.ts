/**
 * THE COMMS ROUTES ON ONE GATHERING, `/api/events/:id/...`: a guest's RSVP,
 * the time vote, the recap, attendance, and the gathering's own email
 * settings (the comms build spec 5.7 to 5.10).
 *
 * STUBS FROM THE FOUNDATION LANE, each answering 501 with a sentence. The
 * event email lane (C2), the guests and recaps lane (C3) and the time vote
 * lane (C4) fill them in, here. The time vote's routes live in
 * server/routes/commsPolls.ts and register from here, behind the same gate.
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
import type { Express, Response } from "express";
import type { AppDeps } from "../lib/appDeps";
import { register as registerTimePolls, type PollRouteDeps } from "./commsPolls";

type Deps = Pick<AppDeps, "authedUser" | "overLimit" | "clientIp"> & PollRouteDeps;

const GUEST_PER_IP = 20;
const GUEST_WINDOW_MS = 10 * 60 * 1000;

const notYet = (res: Response, what: string) =>
  res.status(501).json({ error: `${what} for a gathering is being built.` });

const signedOut = (res: Response) => res.status(401).json({ error: "Sign in first" });

export function register(app: Express, deps: Deps): void {
  const { authedUser, overLimit, clientIp } = deps;

  app.post("/api/events/:id/guest-rsvp", async (req, res) => {
    if (await overLimit(`comms-guest:${clientIp(req)}`, GUEST_PER_IP, GUEST_WINDOW_MS)) {
      return res.status(429).set("Retry-After", "600").json({ error: "Too many requests. Try again in a few minutes." });
    }
    notYet(res, "Saying yes without an account");
  });
  // The live time vote (C4, 5.10): server/routes/commsPolls.ts.
  registerTimePolls(app, deps);
  app.get("/api/events/:id/recap", (_req, res) => notYet(res, "The recap"));
  app.post("/api/events/:id/recap", async (req, res) => {
    if (!(await authedUser(req))) return signedOut(res);
    notYet(res, "The recap");
  });
  app.get("/api/events/:id/attendance", (_req, res) => notYet(res, "Marking who came"));
  app.post("/api/events/:id/attendance", async (req, res) => {
    if (!(await authedUser(req))) return signedOut(res);
    notYet(res, "Marking who came");
  });
  app.get("/api/events/:id/comms", (_req, res) => notYet(res, "Email settings"));
  app.put("/api/events/:id/comms", async (req, res) => {
    if (!(await authedUser(req))) return signedOut(res);
    notYet(res, "Email settings");
  });
}
