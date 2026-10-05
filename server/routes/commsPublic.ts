/**
 * THE PUBLIC COMMS ROUTES, `/api/comms/*`: unsubscribe, preferences, and the
 * one-click actions an email carries (the comms build spec 5.4).
 *
 * The routes themselves live in server/routes/commsPeople.ts, with the
 * address book they read and write; this file is where they join the app, and
 * where later lanes' public comms routes join it too. A purpose answered from
 * the action page (a guest confirming, a time vote, a recap answer) is not a
 * new route: its lane registers a handler with `registerAction`
 * (server/lib/comms/actions.ts) and `/api/comms/action` reaches it.
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
 * BOUNDED. These answer strangers by design (a person stopping email is
 * usually signed out), so every one takes a per-IP `overLimit` bucket (5.4);
 * the buckets and their reasons are in server/routes/commsPeople.ts.
 *
 * No action on GET, ever. Link scanners GET every link in an email, so a GET
 * shows what will happen and the act is a POST. One-click unsubscribe is the
 * RFC 8058 POST to `/api/comms/unsubscribe`.
 */
import type { Express } from "express";
import { registerPublic as registerPeoplePublic, type PublicDeps } from "./commsPeople";

type Deps = PublicDeps;

export function register(app: Express, deps: Deps): void {
  registerPeoplePublic(app, deps);
}
