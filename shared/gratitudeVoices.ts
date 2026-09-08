/**
 * THE VOICES AT THE TOP OF THE GRATITUDE WALL.
 *
 * The wall opens with what people said to each other, before any control, any
 * number and any invitation to spend. This is the shape of that set, shared so
 * the server and the page cannot disagree about how many slots there are or
 * what a labelled example looks like.
 *
 * A voice carries a MESSAGE and nothing else. No sender, no recipient, no
 * amount, no date. That is not a trimmed-down gratitude row, it is a different
 * kind of thing, and the difference is load-bearing three times over:
 *
 *   it is why examples can exist at all. A gratitude row posts to the ledger
 *   at creation, so a seeded one would mint real recognition or break the
 *   conservation invariant that refuses boot. A voice reaches no ledger.
 *
 *   it is why the hero can be public. GET /api/game/gratitude/wall takes no
 *   authentication, and the enriched wall below it deliberately does. Sixty
 *   rows of "who thanked whom" is a directory of the village's most active
 *   members; sixty rows of unattributed sentences is not.
 *
 *   it is what makes the hero readable. Attribution under every line turns a
 *   wall of gratitude into a log of transactions.
 */

/**
 * How many voices the hero holds, and so also the threshold at which a village
 * has enough of its own and the examples retire.
 *
 * ONE NUMBER FOR BOTH, on purpose. If the hero drew ten and the examples
 * retired at the first send, a village would spend a long stretch showing one
 * real voice and nine blanks. Tying the two together means the hero is always
 * full: real voices take the slots as they arrive, labelled examples hold the
 * rest, and the last example leaves exactly when the village can fill it alone.
 */
export const HERO_SLOTS = 8;

/** One line on the hero, and everything the page is allowed to know about it. */
export interface Voice {
  id: string;
  message: string;
  /**
   * True for a line the platform wrote, false for one this village said.
   *
   * Rule 2 of the standing-examples contract is that a row carries its own
   * label so no read path can present platform fiction as real, and this field
   * IS that label. It is not optional and it is not derived on the client:
   * a page that forgets to read it shows an unmarked example, which is the one
   * failure the contract exists to prevent.
   */
  isExample: boolean;
}

/**
 * WHO A LINE ON THE WALL NAMES.
 *
 * The wall carried `from` and `to` as bare first names, which made a hall of
 * strangers: you could read that somebody thanked somebody and never see who.
 * Rye's ruling (2026-09-06) is that portraits and handles may be public, so
 * each side now carries the three facts `publicView` in server/lib/profile.ts
 * already serves without gating: the name, the handle, and which character
 * they front. Nothing gated by a member's privacy flags is added here, and
 * `showHearts` keeps meaning what it meant, which is their BALANCES and not
 * their appearance on this wall.
 *
 * `avatar` is null whenever the server has no portrait to point at, never a
 * path it guesses might resolve. The page renders a medallion for a null and
 * carries onError for a file that goes missing after the answer was sent,
 * which is the same contract `ProfileHero` holds.
 */
export interface WallPerson {
  name: string;
  /** Without the leading @, the way `/profile/:handle` wants it. */
  handle: string | null;
  avatar: string | null;
}

export interface WallEntry {
  id: string;
  from: WallPerson;
  to: WallPerson;
  /**
   * How much was given. It was not on this payload at all, so every thanks on
   * the wall looked the same size when the economy had already decided they
   * were not.
   */
  amount: number;
  message: string;
  at: string;
}

export interface VoicesAnswer {
  voices: Voice[];
  /**
   * How many of this village's own voices exist, which is not the same as how
   * many are ON the hero. The hero holds at most HERO_SLOTS; a village with
   * four hundred real messages still shows eight, and the page says so rather
   * than implying the wall is that short.
   */
  realTotal: number;
}
