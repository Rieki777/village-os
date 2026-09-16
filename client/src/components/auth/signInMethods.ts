/**
 * Which ways in this village actually has, asked once and shared.
 *
 * WHY THIS IS ASKED AT ALL, INSTEAD OF ASSUMED. Thirteen villages run this
 * same bundle. Twelve of them may have Google credentials and one may not, and
 * the bundle cannot know which one it is running in. A button that is always
 * drawn would be a dead button on any village that never set Google up: it
 * would send a member to a 404 and teach them that sign-in is broken.
 *
 * THE THREE STATES ARE KEPT APART ON PURPOSE. `null` means nobody has asked
 * yet, which is not the same fact as "this village has no Google". A component
 * that treated the unanswered state as false would flash the button in after
 * the answer landed, or, worse, a component that treated a failed fetch as
 * true would draw the dead button this file exists to prevent. So an
 * unanswered question and a real no both render nothing, and only a real yes
 * renders the button.
 */
export interface SignInMethods {
  password: boolean;
  google: boolean;
  /** Whether making an account here needs an invitation link. */
  inviteOnly: boolean;
}

let cached: SignInMethods | null = null;
let inFlight: Promise<SignInMethods> | null = null;

/**
 * A failure answers "password only", and "no invitation needed".
 *
 * That is the safe direction: the password form is always rendered by the page
 * itself, so a village that really does have Google loses a button until the
 * next load, and a village that does not gets what it should. The opposite
 * default would put a broken button in front of every member during any blip.
 *
 * The invitation answer fails the same way for the same reason. The sign-up
 * form is drawn, and a village that joins by invitation refuses it with its own
 * sentence, so nobody meets a wall that the server itself would not put up.
 */
export function fetchSignInMethods(): Promise<SignInMethods> {
  if (cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  inFlight = fetch("/api/auth/methods")
    .then((r) => (r.ok ? r.json() : { password: true, google: false }))
    .then((data: any) => {
      cached = { password: data?.password !== false, google: data?.google === true, inviteOnly: data?.inviteOnly === true };
      return cached;
    })
    .catch(() => ({ password: true, google: false, inviteOnly: false }) as SignInMethods)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Drops the cache. For tests, and for a sign-out that may change nothing else. */
export function forgetSignInMethods(): void {
  cached = null;
  inFlight = null;
}
