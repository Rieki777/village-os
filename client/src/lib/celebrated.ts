/**
 * ONCE, EVER. The ledger that keeps a rare moment rare.
 *
 * A quest consented on Tuesday is news the first time its claimant sees it
 * and wallpaper every time after. Nothing in the product polls quest claims,
 * so the consent almost never happens while the member is looking at the
 * card: they learn about it by navigating back, which means "fire on the
 * transition" would fire approximately never, and "fire whenever the state is
 * consented" would fire on every mount forever.
 *
 * So the rule is the one the server already keeps for the same events. Its
 * notification dedupe key is `stage:<user>:<stage>`, one per stage ever, with
 * the comment "re-computation can never re-celebrate". This is that idea on
 * the client: a moment has a stable id, the first sighting plays it, and
 * every sighting after is silent.
 *
 * PER BROWSER, like the first walk's progress and the landing preference. No
 * server state and nothing to migrate; a cleared browser loses the record of
 * a celebration, which costs a member one repeated flourish and no
 * information.
 *
 * NOT PER MEMBER, and that is a decision rather than an omission. The sound
 * mute is keyed by member id because a preference is about the person. A
 * moment id is about an EVENT, and every id this stores is already unique
 * across the whole village: a quest claim id, a gratitude entry id, a stage
 * event's own timestamp. Two people sharing a laptop can never collide,
 * because neither can see the other's rows to begin with. Adding a member
 * scope would mean fetching an id this module has no other use for, and
 * `setSoundMember` is the cautionary tale: it has existed since the kit
 * landed and nothing outside a test has ever called it.
 *
 * THE DECISIONS ARE PURE. `rememberMoment` is the whole policy, including the
 * cap, and it is a function of its arguments so `celebrated.test.ts` can
 * drive it without a DOM.
 */

import { readStored, writeStored } from "./safeStorage";

const KEY = "village.celebrated";

/**
 * How many moment ids are kept. Past this the oldest fall off the front.
 *
 * A member who never clears their browser would otherwise grow this forever,
 * and localStorage is a small shared budget the sound mute and the first walk
 * also live in. Forgetting the oldest entries is the right failure: the worst
 * it can do is replay a celebration from months ago, once.
 */
export const MOMENT_MEMORY = 200;

export interface RememberResult {
  /** The list to store, oldest first. */
  moments: string[];
  /** Whether this moment is news. False when it was already in the list. */
  fresh: boolean;
}

/**
 * Record a moment and say whether it had already happened.
 *
 * Pure: takes the stored list and the id, returns the new list and the
 * verdict. The caller does the reading and writing.
 */
export function rememberMoment(stored: readonly string[], id: string): RememberResult {
  if (!id) return { moments: [...stored], fresh: false };
  if (stored.includes(id)) return { moments: [...stored], fresh: false };
  const moments = [...stored, id];
  return { moments: moments.slice(Math.max(0, moments.length - MOMENT_MEMORY)), fresh: true };
}

/** Parse whatever localStorage handed back. Anything unreadable is no history. */
export function parseMoments(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

// ── The browser side ────────────────────────────────────────────────────────

/**
 * Has this moment already been celebrated for this member, and if not, mark
 * it. One call: asking and claiming have to be the same act, or two mounted
 * components both see "fresh" and play the same celebration twice.
 *
 * Returns false for an empty id, and false anywhere storage is unavailable,
 * because the safe answer when the history cannot be read is silence. A
 * private-browsing member who would otherwise get the same moment on every
 * single navigation is the case that decides this.
 */
export function claimMoment(id: string): boolean {
  if (!id) return false;
  if (typeof window === "undefined") return false;
  const stored = readStored("local", KEY);
  // A store that REFUSES is not a store that is empty, and here the two
  // answers are opposite: empty means this moment is news, refused means
  // nothing is known and silence is the only safe reply.
  if (stored.status === "unavailable") return false;
  const result = rememberMoment(parseMoments(stored.status === "value" ? stored.value : null), id);
  if (!result.fresh) return false;
  // A refused WRITE still plays it this once. The preference never sticks in
  // private browsing, and a moment shown twice is a smaller loss than a
  // member who did the work and saw nothing.
  writeStored("local", KEY, JSON.stringify(result.moments));
  return true;
}
