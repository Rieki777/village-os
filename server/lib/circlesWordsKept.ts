/**
 * CIRCLES, STEP 2, WITH NO SAVE FOR ANYONE TO REMEMBER (2026-11-01).
 *
 * Step 1 put the words around /circles on the page content system with the
 * words the page had always typed as its defaults: "Our Sociocratic Circles",
 * a consent process, the four leads and the Finance & Business Circle. Step 2
 * makes those defaults neutral, so a new village reads no one village's
 * structure or method as its own, and the `keep-circles-words-2026-11-01`
 * runOnce keeps an established village's wording at boot.
 *
 * The rule is How We Govern's (#732), shared in server/lib/pageWordsKept.ts:
 * a village that already holds any other `page-*` section, or part of this
 * page, keeps the words it shows today; every box it saved stays as saved; a
 * new village gets the neutral starter page. This file names the snapshot:
 * server/seeds/page-circles-before-neutral.json, the step-1 defaults as
 * `adoptedDocument` wrote them, `{coordinator}` kept as a word.
 */
import BEFORE_NEUTRAL from "../seeds/page-circles-before-neutral.json";
import { CIRCLES_PAGE } from "../../shared/pageContent/circles";
import { keepPageWords, keptPageSection, type PageWordsRepo } from "./pageWordsKept";

type Doc = Record<string, unknown>;

export const CIRCLES_WORDS_BEFORE_NEUTRAL: Doc = BEFORE_NEUTRAL as Doc;

/** The circles section this village should hold, or null when it needs nothing written. */
export function keptCirclesSection(content: Doc | null | undefined): Doc | null {
  return keptPageSection(CIRCLES_PAGE, CIRCLES_WORDS_BEFORE_NEUTRAL, content);
}

/** The boot fixup: writes the kept section once, and reports whether it wrote. */
export function keepCirclesWords(repo: PageWordsRepo): Promise<boolean> {
  return keepPageWords(CIRCLES_PAGE, CIRCLES_WORDS_BEFORE_NEUTRAL, repo);
}
