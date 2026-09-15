/**
 * What a member is told when their browser will not keep them signed in, and
 * the one check that decides it.
 *
 * THE RULING (Rye, 2026-09-04). Sign-in stops with a plain message when
 * storage is blocked. Not a silent failure, not a session that lasts one tab,
 * not a signed-out browse: tell them, and tell them how to fix it, so they can
 * change the setting and come back.
 *
 * WHY THIS IS NOT THE `safeStorage` ANSWER. Every other preference in the
 * client carries on quietly when the store refuses, because a member who
 * cannot remember a currency can still use the page. A member who cannot
 * remember a session cannot use the page at all, and swallowing that produces
 * a sign-in that looks like it worked and did not. Same helper, same
 * three-way reading, opposite decision on `unavailable`.
 *
 * WHAT THE SENTENCE HAS TO DO. Name the cause in a member's words with no
 * mention of ours. Name the setting they can find, and not "your settings".
 * Say what happens if they leave it, which is that sign-in does not finish.
 * The tone follows the give refusal in `checkGive` (`server/lib/economy.ts`),
 * which states the live figure and what is left and then stops.
 *
 * WHAT ABOUT A MEMBER ALREADY SIGNED IN WHOSE STORAGE IS BLOCKED MID SESSION.
 * That moment does not exist in this app as a separate one, and it was worth
 * checking before writing words for it. The session token is read from
 * storage on every request (`authToken`, `client/src/lib/gameApi.ts`) and
 * re-read into React state only at mount, so a store that starts refusing
 * READS mid page would make every request anonymous with no reload. In every
 * mainstream engine the setting that causes this takes effect on the next
 * load, and on that load the member arrives signed out at the sign-in door,
 * where this sentence already fires and is actionable. The mid-session WRITES
 * on this path are both removals (sign-out, and clearing a token the server
 * has rejected), where carrying on is the right answer and a refusal would
 * trap somebody in a session they asked to leave. So there is one sentence,
 * at one moment, and no banner.
 */
import { storageAvailable, type StorageWrite } from "./safeStorage";

/**
 * Signing in, registering, and finishing a Google round trip all say this.
 * One sentence, one moment: three wordings would be three chances to drift.
 */
export const SIGN_IN_STORAGE_BLOCKED =
  "This browser is blocking site data, so signing in cannot finish here. Allow cookies and site data for this address in your browser settings, or use an ordinary window if this one is private, then try again.";

/**
 * Setting a password is its own moment, and it needs its own first clause.
 * The password IS saved by the time this can fire, so a member who read only
 * the sign-in sentence would go and set it a second time.
 */
export const PASSWORD_SET_STORAGE_BLOCKED =
  "Your new password is saved. This browser is blocking site data, so signing in cannot finish here. Allow cookies and site data for this address in your browser settings, or use an ordinary window if this one is private, then sign in again.";

/**
 * Ask before sending anybody's password.
 *
 * The check goes ahead of the network call on purpose. Registering behind a
 * blocked store would otherwise create an account the member cannot reach,
 * and signing in would spend a session the browser drops on the floor. The
 * write is still checked afterwards, because a store can fill between the two.
 */
export function canKeepSignedIn(): boolean {
  return storageAvailable("local");
}

/** True when a session write refused. The caller turns this into the sentence. */
export function sessionWriteRefused(result: StorageWrite): boolean {
  return result.status !== "saved";
}
