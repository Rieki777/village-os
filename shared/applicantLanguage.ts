/**
 * WHICH LANGUAGE AN APPLICANT'S EMAILS AND NOTICES USE. Pure.
 *
 * The lead's rule, in order, first one we can match to a language we write in:
 *   1. the language they chose on the site when they proposed (the form sends
 *      the site's current locale; the server never guesses it),
 *   2. the language on their email-list signup for the same address,
 *   3. their member profile language,
 *   4. the browser's Accept-Language at the moment they proposed,
 *   5. the village's default language,
 *   6. English.
 * A tag we cannot write in (a language with no table in shared/applicantWords.ts)
 * is skipped, and the next source is read. `es-CR` matches `es`.
 */
import { matchLocale } from "./i18nResolve";
import { APPLICANT_LANGUAGES, DEFAULT_APPLICANT_LANGUAGE, type ApplicantLanguage } from "./applicantWords";

export type LanguageSource = "chosen_on_site" | "email_list" | "profile" | "browser" | "village_default" | "english";

export interface LanguageSources {
  chosenOnSite?: string | null;
  emailList?: string | null;
  profile?: string | null;
  /** Accept-Language tags in the browser's order. */
  browser?: readonly string[];
  villageDefault?: string | null;
}

const match = (tag: string | null | undefined): ApplicantLanguage | null => (tag ? (matchLocale(tag, APPLICANT_LANGUAGES) as ApplicantLanguage | null) : null);

export function chooseApplicantLanguage(s: LanguageSources): { language: ApplicantLanguage; source: LanguageSource } {
  const steps: Array<[LanguageSource, ApplicantLanguage | null]> = [
    ["chosen_on_site", match(s.chosenOnSite)],
    ["email_list", match(s.emailList)],
    ["profile", match(s.profile)],
    ["browser", (s.browser ?? []).map(match).find((x) => x) ?? null],
    ["village_default", match(s.villageDefault)],
  ];
  for (const [source, language] of steps) if (language) return { language, source };
  return { language: DEFAULT_APPLICANT_LANGUAGE, source: "english" };
}
