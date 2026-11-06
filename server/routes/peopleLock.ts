/**
 * THE SECRET-SOCIETY LOCK, IN FRONT OF EVERY ROUTE (readiness finding R097).
 *
 * No route of its own. `register` installs `peopleLockMiddleware`
 * (server/lib/peopleLock.ts, which says what it does and what it cannot see)
 * so that while `org.public_people` is off, no GET answered to a signed-out
 * caller carries a member's name, handle, id or email, whichever route
 * answered it and whether the name was a field or frozen into a sentence.
 *
 * REGISTERED IMMEDIATELY AFTER THE BODY PARSER, before any route, because
 * Express runs middleware in registration order and a route registered above
 * this line would answer unscrubbed.
 *
 * The ballot projections (R098) and the handle rule are re-exported here so
 * `server/index.ts` takes them on the same import line as `register`, which
 * the size ratchet (scripts/check-server-index-size.mjs) does not count.
 */
import type { Express } from "express";
import { peopleLockMiddleware, type PeopleLockDeps } from "../lib/peopleLock";

export { ballotCardForViewer, ballotForViewer, firstNameOf, hiddenFromStranger, peopleTier } from "../lib/peopleLock";

export function register(app: Express, deps: PeopleLockDeps): void {
  app.use(peopleLockMiddleware(deps));
}
