/**
 * THE EXIT-POLICY DOCUMENT'S WRITES, ONE AT A TIME
 * (W2-exit-policy-lost-update, W3b-exit-term-reverted).
 *
 * Three doors write the `exit-policy` document: the Departures editor
 * (`PUT /api/admin/exit-policy`), the closing-policy door
 * (`PUT /api/admin/exit-policy/closing`), and the canvas adopt door, which
 * calls the same `saveExitPolicy` (server/routes/exits.ts). Each reads the
 * cached document and puts it back whole, and `dbDocument.put` sets its cache
 * only after the INSERT resolves. Two writes inside one database round trip
 * both started from the same copy, both answered 200, and the later one
 * erased the other.
 *
 * `withExitPolicyLock` runs each read-modify-write after the one before it
 * has landed. One server process serves a village, so a promise chain in the
 * process is the whole lock.
 *
 * A DRAFT NAMES THE TERMS IT WAS OPENED ON. The Departures editor loads the
 * policy when the tab opens and saves the whole draft later, so a term the
 * canvas adopted in between went back to the old value with nobody told. The
 * editor now sends `x-content-was` with `exitPolicyTermsVersion` of what it
 * loaded (GET /api/admin/exits serves it as `policyVersion`), and a save
 * whose terms moved since is refused with 409, the way a Pages save is
 * (constitution IV.6). The closing section is left out of the version: the
 * editor's save carries closing forward as stored, so a closing adoption
 * never makes an open draft stale.
 */
import { contentVersion } from "../../shared/pageContent/resolve";

/** A fingerprint of the stored policy's terms, closing section left out. */
export function exitPolicyTermsVersion(doc: unknown): string {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return contentVersion(doc);
  const { closing: _closing, ...terms } = doc as Record<string, unknown>;
  return contentVersion(terms);
}

let chain: Promise<unknown> = Promise.resolve();

/** Run one read-modify-write of the exit-policy document after every earlier one has landed. */
export function withExitPolicyLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

/** What a save whose draft was opened before the terms moved is told. */
export const EXIT_POLICY_MOVED =
  "The exit policy changed since this page was opened, so nothing was saved. Reload it to see the change, then make yours again.";
