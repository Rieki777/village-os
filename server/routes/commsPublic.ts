/**
 * THE PUBLIC COMMS ROUTES, `/api/comms/*`: unsubscribe, preferences, and the
 * one-click actions an email carries (the comms build spec 5.4).
 *
 * STUBS FROM THE FOUNDATION LANE. Each answers 501 with a sentence until the
 * people lane (B2) builds it. They exist now so the addresses the post office
 * writes into an email's headers are routes this server owns, and so the
 * pages under /email/* have their endpoints in place.
 *
 * ── WHERE THIS IS REGISTERED, AND WHY ──────────────────────────────────────
 *
 * After `express.json()`, because the pages post form fields, and with NO
 * module gate, ever. Unsubscribe and preferences are plumbing: a person must
 * be able to stop email whatever the village's comms module is set to, and a
 * "stop" that answered 404 because a module was off would be a promise the
 * platform could not keep (5.16). The delivery-report webhook shares the
 * `/api/comms` prefix and is registered elsewhere, before `express.json()`,
 * for the raw body its signature is over (server/routes/commsWebhook.ts).
 *
 * BOUNDED ALREADY. These answer strangers by design (a person stopping email
 * is usually signed out), so every one takes a per-IP `overLimit` bucket now
 * (5.4), and the lane that builds each one inherits the bound instead of
 * remembering to add it.
 *
 * WHEN B2 FILLS THESE IN: no action on GET, ever. Link scanners GET every link
 * in an email, so a GET shows what will happen and the act is a POST (5.4).
 * One-click unsubscribe is the RFC 8058 POST to `/api/comms/unsubscribe`.
 */
import type { Express, Request, Response } from "express";
import type { AppDeps } from "../lib/appDeps";

type Deps = Pick<AppDeps, "overLimit" | "clientIp">;

/**
 * Generous on purpose: a household behind one address clicking through a
 * week of emails stays well inside it, and a script hammering the routes
 * does not.
 */
const PER_IP = 60;
const WINDOW_MS = 10 * 60 * 1000;

const tooMany = (res: Response) =>
  res.status(429).set("Retry-After", "600").json({ error: "Too many requests. Try again in a few minutes." });

const notYet = (res: Response, what: string) =>
  res.status(501).json({
    error: `${what} is being built. Until it is, reply to the email you received and ask, and a person will do it for you.`,
  });

export function register(app: Express, deps: Deps): void {
  const { overLimit, clientIp } = deps;
  const bucket = (req: Request) => `comms-public:${clientIp(req)}`;

  app.get("/api/comms/preferences", async (req, res) => {
    if (await overLimit(bucket(req), PER_IP, WINDOW_MS)) return tooMany(res);
    notYet(res, "Choosing which emails you get");
  });
  app.post("/api/comms/preferences", async (req, res) => {
    if (await overLimit(bucket(req), PER_IP, WINDOW_MS)) return tooMany(res);
    notYet(res, "Choosing which emails you get");
  });
  app.post("/api/comms/unsubscribe", async (req, res) => {
    if (await overLimit(bucket(req), PER_IP, WINDOW_MS)) return tooMany(res);
    notYet(res, "Unsubscribing in one click");
  });
  app.get("/api/comms/action", async (req, res) => {
    if (await overLimit(bucket(req), PER_IP, WINDOW_MS)) return tooMany(res);
    notYet(res, "Answering from an email");
  });
  app.post("/api/comms/action", async (req, res) => {
    if (await overLimit(bucket(req), PER_IP, WINDOW_MS)) return tooMany(res);
    notYet(res, "Answering from an email");
  });
}
