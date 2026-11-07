import { formatMoney } from "@shared/money";
import { getFormattingLocale } from "./i18n";

/**
 * Dates, numbers and money in the reader's language (internal spec i18n,
 * US5.2; §8 R10, R11, R17).
 *
 * One place reads the active locale, so a page never passes `undefined` (the
 * browser's own locale, which may not be the one the member chose) or a
 * hardcoded "en-US". Display only: what is stored or computed never goes
 * through here. Digits stay Latin (`numberingSystem: "latn"`) so a figure a
 * member reads can be typed back into an input, and dates stay Gregorian so a
 * vote's deadline means one day for everyone.
 */
const DISPLAY = { numberingSystem: "latn" } as const;

export function formatNumber(n: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(getFormattingLocale(), { ...DISPLAY, ...options }).format(n);
}

export function formatDate(d: Date | number, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  return new Intl.DateTimeFormat(getFormattingLocale(), { calendar: "gregory", ...DISPLAY, ...options }).format(d);
}

/** Minor units in the village's currency, written the reader's way. Never converts. */
export function formatMoneyMinor(amountMinor: number, currency: string): string {
  return formatMoney(amountMinor, currency, undefined, `${getFormattingLocale()}-u-nu-latn`);
}
