/**
 * The `money` section of the runtime content document, and the one reader two
 * pages share.
 *
 * WHY IT EXISTS. Four member-facing financial claims shipped as compiled
 * client constants with no source anywhere in the code: a deposit range, eight
 * venture investment ranges, and one sentence about what the value token
 * converts to, printed on two different pages. The founder ruled on each of
 * them on 2026-09-03 and the ruling is the same shape every time: the claims
 * are real, and a real claim belongs somewhere he can correct without a
 * deploy.
 *
 * WHERE IT LIVES. `app_config['content'].money`, read by any page through
 * `useVillageContent("money")` and written by a founder at Admin, Content,
 * Money & Value Claims. No new server route: `GET /api/content/:section` and
 * `PUT /api/admin/content/:section` both key on whatever string is in the URL,
 * which is exactly how the `legal` section landed (see
 * `client/src/components/admin/contentSections.ts`).
 *
 * BLANK PUBLISHES NOTHING, everywhere, and that rule is the point. An empty
 * setting and a real zero are different facts, and a default figure inherited
 * from whichever village this platform was forked from is the defect all of
 * this exists to remove. `landFacts` in `server/index.ts` says the same thing
 * about the land figures and says it first.
 */
import { useVillageContent } from "@/hooks/useVillageContent";

export interface MoneyContent {
  /** The clause inside the Deposit step's sentence, comma supplied by the page. */
  depositRange?: string;
  /** The short form of the same figure, for the Deposit step's bullet list. */
  depositSummary?: string;
  /** Venture cost, keyed by the venture's stable key on the Opportunities page. */
  ventureInvestment?: Record<string, string>;
  /**
   * What happens to the value token, in the founder's words. Printed on the
   * Quests explainer and on the Prosperity journey, and on neither of them
   * when it is blank.
   */
  valueConversion?: string;
}

/**
 * The names a stored sentence may fill in, so a village that renames its
 * tokens or itself does not have to retype its own copy. Same `{token}` shape
 * `ProsperityJourney` already uses for its guide's name.
 */
export interface ClaimNames {
  village: string;
  value: string;
}

/**
 * The value-token sentence, ready to print, or "" when a village has published
 * none. Callers test the empty string and render nothing.
 */
export function valueConversionFrom(money: MoneyContent | null, names: ClaimNames): string {
  const said = money?.valueConversion?.trim();
  if (!said) return "";
  return said.replace(/\{village\}/g, names.village).replace(/\{value\}/g, names.value);
}

/**
 * The same sentence, read straight from the document, for the five pages that
 * print it. ONE line per page on purpose: `CoCreatorsGuide.tsx` is held by the
 * `check-file-lines` ratchet with two lines of headroom, and a claim published
 * in five places has to be cheap to read in all five or it gets fixed in four.
 */
export function useValueConversion(names: ClaimNames): string {
  return valueConversionFrom(useVillageContent<MoneyContent>("money").content, names);
}
