/**
 * HOW WE GOVERN, STEP 2, WITH NO SAVE FOR ANYONE TO REMEMBER (2026-11-01).
 *
 * Step 1 (#697) put /governance on the page content system with the words it
 * had always shown as its defaults. Step 2 makes those defaults neutral, so a
 * new village starts with a page that describes nobody in particular, and the
 * `keep-governance-words-2026-11-01` runOnce keeps an established village's
 * wording at boot.
 *
 * The rule (who keeps the old words, and never over a village's own word) is
 * shared with every page that goes neutral the same way, and lives in
 * server/lib/pageWordsKept.ts. This file names How We Govern's snapshot:
 * server/seeds/page-governance-before-neutral.json, the step-1 defaults as
 * `adoptedDocument` wrote them, `{words}` kept as words.
 */
import BEFORE_NEUTRAL from "../seeds/page-governance-before-neutral.json";
import { GOVERNANCE_PAGE } from "../../shared/pageContent/governance";
import { keepPageWords, keptPageSection, type PageWordsRepo } from "./pageWordsKept";

type Doc = Record<string, unknown>;

export const GOVERNANCE_WORDS_BEFORE_NEUTRAL: Doc = BEFORE_NEUTRAL as Doc;

/**
 * The governance section this village should hold, or null when it needs
 * nothing written. Pure: the same content in gives the same answer out.
 */
export function keptGovernanceSection(content: Doc | null | undefined): Doc | null {
  return keptPageSection(GOVERNANCE_PAGE, GOVERNANCE_WORDS_BEFORE_NEUTRAL, content);
}

/** The boot fixup: writes the kept section once, and reports whether it wrote. */
export function keepGovernanceWords(repo: PageWordsRepo): Promise<boolean> {
  return keepPageWords(GOVERNANCE_PAGE, GOVERNANCE_WORDS_BEFORE_NEUTRAL, repo);
}
