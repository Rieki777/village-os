/**
 * THE LANGUAGE OF AN APPLICANT'S EMAILS, read from where the app records one
 * (the rule and its order: shared/applicantLanguage.ts).
 *
 *   1. the site language the form sent (`locale`, from the page's own switcher),
 *   2. `comms_contacts.locale` for the address (0371), set by a signup that sent one,
 *   3. the member's saved language (`users.prefs.locale`, server/routes/i18n.ts),
 *   4. Accept-Language on the request,
 *   5. `village.default_locale`, then English.
 *
 * It is read ONCE, when the proposal is made, and kept on the proposal's body.
 */
import { emailKeyOf } from "../../shared/comms/address";
import { chooseApplicantLanguage } from "../../shared/applicantLanguage";
import { DEFAULT_APPLICANT_LANGUAGE, isApplicantLanguage, type ApplicantLanguage } from "../../shared/applicantWords";
import { contactByEmailKey } from "../repos/commsContacts";
import { parseAcceptLanguage } from "./i18nShell";
import { stringVar } from "./variables";
import type { Pool } from "mysql2/promise";

export async function languageForNewProposal(
  deps: { getPool(): Pool; members: { byEmail(email: string): Promise<any> }; villageDefault?: () => string | null },
  i: { clientLocale: unknown; email: string; acceptLanguage: string | undefined },
): Promise<ApplicantLanguage> {
  let emailList: string | null = null;
  let profile: string | null = null;
  try {
    emailList = (await contactByEmailKey(deps.getPool(), emailKeyOf(i.email)))?.locale ?? null;
  } catch (e) {
    console.warn("[open-proposals] the address book's language could not be read", e);
  }
  try {
    const m = await deps.members.byEmail(i.email);
    const saved = m?.prefs?.locale;
    profile = typeof saved === "string" ? saved : null;
  } catch (e) {
    console.warn("[open-proposals] the member's language could not be read", e);
  }
  return chooseApplicantLanguage({
    chosenOnSite: typeof i.clientLocale === "string" ? i.clientLocale.slice(0, 16) : null,
    emailList,
    profile,
    browser: parseAcceptLanguage(i.acceptLanguage),
    villageDefault: deps.villageDefault ? deps.villageDefault() : stringVar("village.default_locale"),
  }).language;
}

/** The language kept on a proposal; a proposal from before this reads the village default, then English. */
export function languageOf(p: { body: { locale?: unknown } }): ApplicantLanguage {
  if (isApplicantLanguage(p.body.locale)) return p.body.locale;
  return chooseApplicantLanguage({ villageDefault: stringVar("village.default_locale") }).language ?? DEFAULT_APPLICANT_LANGUAGE;
}
