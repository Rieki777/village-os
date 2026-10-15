/**
 * THE PATHS ROUTES (the comms build spec 5.11), and the one place the paths
 * lane plugs into the journey engine at boot.
 *
 *   GET  /api/admin/comms/paths/:key   one path journey's two options, whether
 *                                      it is held, and how many walk the path
 *   PUT  /api/admin/comms/paths/:key   change the options
 *   GET  /api/comms/consent            the words of the "walk me through the
 *                                      next steps" box, for the public forms
 *
 * Registered by one line each: the admin routes from server/routes/comms.ts,
 * the public read from server/routes/commsPublic.ts.
 *
 * ── THE GATES ───────────────────────────────────────────────────────────────
 *
 * The admin routes follow the Journeys screen they serve: behind
 * `requireModule("comms")`, one route at a time, then the one capability gate
 * for `comms.manage` (a change through `guardCapability`, a look through
 * `mayStillSee`).
 *
 * The public read is one setting and nothing else, rate limited per IP like
 * every public comms route. While the module is off it answers `show: false`,
 * because a box promising emails that nothing will send is a promise the
 * village cannot keep; the forms then draw no box, and nothing is recorded.
 *
 * ── AT BOOT ─────────────────────────────────────────────────────────────────
 *
 * `register` hands the engine the path, member and joining rules, their
 * emails' values and the day 21 hand-off (server/lib/comms/pathParts.ts), and
 * puts the hourly rung emails on the scheduler.
 */
import type { Express, Request, Response } from "express";
import { DEFAULT_CONSENT_TEXT } from "../../shared/comms/settings";
import { hasLadder } from "../../shared/pathLadders";
import type { AppDeps } from "../lib/appDeps";
import { journeyStatus } from "../lib/comms/journeyDefinitions";
import { PATH_RUNGS_EVERY_MS, PATH_RUNGS_JOB, registerPathJourneyParts, runPathRungs, type PathPartsDeps } from "../lib/comms/pathParts";
import { optionsOf, pathIdOfJourney, setPathJourneyOptions } from "../lib/comms/paths";
import { readCommsSettings } from "../lib/comms/settings";
import { effectiveLifecycle, requireModule } from "../lib/modules";
import { registerJob } from "../lib/scheduler";
import { pathCounts } from "../repos/pathEnrollments";

type AdminDeps = Pick<
  AppDeps,
  "authedUser" | "guardCapability" | "mayStillSee" | "getPool" | "commsPostOffice" | "members" | "notify" | "lapseContext"
> & { emailConfigRepo: { get(): any } };

type PublicDeps = Pick<AppDeps, "overLimit" | "clientIp" | "getPool">;

const REFUSAL = { status: 403, body: { error: "Running the village's email is an appointment" } };
const KEY = /^path\.[a-z0-9][a-z0-9-]{0,62}$/;

/** The public read's bucket: one look per form page, generous for a shared connection. */
const CONSENT_PER_IP = 120;
const CONSENT_WINDOW_MS = 10 * 60 * 1000;

/** Why a path journey is held, in a sentence, or null when it is not. */
export function heldReason(pathId: string, investorWordsReviewed: unknown): string | null {
  if (pathId !== "investor" || investorWordsReviewed) return null;
  return "Held until the investor words are reviewed. Until then it sends only the welcome and the day 21 hand-off. Mark the words reviewed in Comms Settings.";
}

/** The parts the engine is handed, from the server's own deps. */
export function pathPartsDepsOf(deps: AdminDeps): PathPartsDeps {
  return {
    getPool: deps.getPool,
    postOffice: deps.commsPostOffice,
    members: deps.members,
    notify: deps.notify,
    emailConfig: () => deps.emailConfigRepo.get() ?? null,
    commsLifecycle: () => effectiveLifecycle("comms"),
    eventsLifecycle: () => effectiveLifecycle("events"),
    lapseContext: deps.lapseContext,
  };
}

export function register(app: Express, deps: AdminDeps): void {
  const { authedUser, guardCapability, mayStillSee, getPool } = deps;
  const moduleGate = requireModule("comms");
  const parts = pathPartsDepsOf(deps);
  const pathDeps = { getPool, members: deps.members };

  registerPathJourneyParts(parts);
  registerJob(PATH_RUNGS_JOB, PATH_RUNGS_EVERY_MS, async () => {
    if (parts.commsLifecycle() === "off") return "nothing looked at: the comms module is off";
    const r = await runPathRungs(parts);
    return `looked at ${r.looked}, posted ${r.posted}, recorded ${r.recorded}`;
  });

  /** What one path journey's panel reads. */
  async function view(key: string) {
    const pathId = pathIdOfJourney(key);
    const status = pathId ? await journeyStatus({ getPool }, key) : null;
    if (!pathId || !status) return null;
    const settings = await readCommsSettings(getPool());
    return {
      key,
      pathId,
      ...optionsOf(status.definition),
      rungsAvailable: hasLadder(pathId),
      held: heldReason(pathId, settings.investorWordsReviewed),
      people: await pathCounts(getPool(), pathId),
    };
  }

  async function mayLook(req: Request, res: Response): Promise<boolean> {
    if (!(await authedUser(req))) {
      res.status(401).json({ error: "Sign in to see the village's email" });
      return false;
    }
    if (!(await mayStillSee(req, "comms.manage"))) {
      res.status(REFUSAL.status).json(REFUSAL.body);
      return false;
    }
    return true;
  }

  const notFound = (res: Response, key: string) => res.status(404).json({ error: `There is no path journey called "${key.slice(0, 100)}".` });

  app.get("/api/admin/comms/paths/:key", moduleGate, async (req, res) => {
    if (!(await mayLook(req, res))) return;
    const key = String(req.params.key ?? "");
    const v = KEY.test(key) ? await view(key) : null;
    if (!v) return notFound(res, key);
    res.json(v);
  });

  app.put("/api/admin/comms/paths/:key", moduleGate, async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSAL))) return;
    const key = String(req.params.key ?? "");
    if (!KEY.test(key)) return notFound(res, key);
    const b = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const patch: { includeExisting?: boolean; rungEmails?: boolean } = {};
    for (const field of ["includeExisting", "rungEmails"] as const) {
      if (b[field] === undefined) continue;
      if (typeof b[field] !== "boolean") return res.status(400).json({ error: "Choose on or off." });
      patch[field] = b[field] as boolean;
    }
    const user = await authedUser(req);
    const saved = await setPathJourneyOptions(pathDeps, key, patch, user?.id ?? null);
    if (!saved) return notFound(res, key);
    res.json({ ...(await view(key)), started: saved.started, version: saved.status.version });
  });
}

export function registerPublic(app: Express, deps: PublicDeps): void {
  const { overLimit, clientIp, getPool } = deps;

  /** The words of the box on every public form that feeds a path, and whether to draw it at all. */
  app.get("/api/comms/consent", async (req, res) => {
    if (await overLimit(`comms-consent:${clientIp(req)}`, CONSENT_PER_IP, CONSENT_WINDOW_MS)) {
      return res.status(429).set("Retry-After", "600").json({ error: "Too many tries. Wait a few minutes, then try again." });
    }
    if (effectiveLifecycle("comms") === "off") return res.json({ show: false, text: "" });
    const { consentText } = await readCommsSettings(getPool());
    res.set("Cache-Control", "no-store").json({ show: true, text: consentText || DEFAULT_CONSENT_TEXT });
  });
}
