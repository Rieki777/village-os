/**
 * The "a gate was consulted" marker, and nothing else.
 *
 * DEFAULT-DENY UNDER /api/admin has two halves. This file is the half that
 * RECORDS that a gate ran; the middleware in server/index.ts is the half that
 * refuses to let an admin response succeed unless one did.
 *
 * There are hundreds of `/api/admin` route registrations and every one of them
 * calls a gate inside its own handler. That is hundreds of correct decisions
 * and zero enforcement: nothing in the framework requires the next one to make
 * it. The guard that was supposed to catch a miss cannot, either, because
 * `scripts/check-auth-fetch.mjs` derives the set of routes it checks FROM THE
 * PRESENCE of a gate call in the handler, so a route with no gate is not a
 * route that fails the guard, it is a route the guard has never heard of.
 * Forgetting the gate deletes you from the checked set.
 *
 * The flag means "a gate was consulted", never "a gate said yes". The helpers
 * keep owning the answer; this only owns the question having been asked.
 *
 * Deliberately request-scoped and set by the gate helpers themselves rather
 * than inferred by a middleware from a route table. A route table has to be
 * kept in step with the routes; a helper that marks on entry cannot drift from
 * the thing it is describing, because it IS the thing.
 *
 * WHY THIS IS ITS OWN MODULE. Route handlers are moving out of
 * server/index.ts into server/routes/<domain>.ts (see docs/ARCHITECTURE.md).
 * A handler in another file still has to be able to say that it consulted a
 * gate, and the middleware in index.ts still has to be able to hear it. The
 * key is a `Symbol.for` entry in the runtime-wide registry rather than a
 * module-local symbol, so the two halves agree even if this module is somehow
 * instantiated twice (two bundles, a test importing the source while the app
 * runs the build). A module-local `Symbol()` would silently answer "no gate
 * ran" for every request in that case, and default-deny would turn every
 * admin route into a 403.
 */
import type express from "express";

// brand-ok: a Symbol.for key, not a rendered string. It is the shared name the
// gate helpers and the default-deny middleware find each other by in the
// runtime-wide registry, and it arrived here verbatim from server/index.ts.
// Renaming it to drop the word would silently split the two halves apart: the
// middleware would see "no gate ran" for every request and 403 every admin
// route. A fork renaming its platform does not rename this.
const ADMIN_GATE_CONSULTED = Symbol.for("village.adminGateConsulted"); // a registry key named for no village (R066)

/** Called by every gate helper on entry. Idempotent, and never a decision. */
export function markAdminGate(req: express.Request): void {
  (req as any)[ADMIN_GATE_CONSULTED] = true;
}

/** True when some gate helper ran for this request. Never a grant on its own. */
export function adminGateWasConsulted(req: express.Request): boolean {
  return (req as any)[ADMIN_GATE_CONSULTED] === true;
}
