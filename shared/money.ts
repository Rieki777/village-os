/**
 * Money as words, for DISPLAY only (0083, P8, N4).
 *
 * Amounts live as minor units plus an ISO code, the `ModulePricing` rule.
 * This file turns them into a sentence, optionally through a display
 * currency: a member who thinks in colones reads colones, and what Stripe
 * charges never passes through here. There is no rounding-safe way to move
 * money through a float, so nothing here ever feeds a charge, a ledger row
 * or a settlement; `server/lib/payments.ts` has an empty diff this round and
 * a test asserting its currency, which is the whole point.
 *
 * The exponent comes from `Intl`, exactly like `priceLine` in modules.ts: a
 * price in yen has no decimals, and assuming two would misprice it a
 * hundredfold. Unknown codes (a village's own CR, a token symbol) fall back
 * to two decimals and a plain "123.45 CRC" spelling, which is honest and
 * never throws inside a render.
 */

/** Decimal places for a currency, per Intl; 2 when the code is unknown. */
export function exponentOf(currency: string): number {
  try {
    const fmt = new Intl.NumberFormat("en", { style: "currency", currency });
    return fmt.resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Minor units -> "CHF 12.50" / "$12.50", falling back to "12.5 XXX". */
function plainFormat(amountMinor: number, currency: string): string {
  const digits = exponentOf(currency);
  const major = amountMinor / Math.pow(10, digits);
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(major);
  } catch {
    return `${major} ${currency}`;
  }
}

/**
 * Convert minor units between currencies given ONE pairwise rate: units of
 * `toCurrency` per one unit of `fromCurrency`. Exponents of both sides are
 * honoured, so 500 JPY minor (¥500) at 0.006 becomes 300 USD minor ($3.00).
 * Display arithmetic only; the result is rounded to the nearest minor unit.
 */
export function convertMinor(
  amountMinor: number,
  fromCurrency: string,
  toCurrency: string,
  rate: number,
): number {
  const fromMajor = amountMinor / Math.pow(10, exponentOf(fromCurrency));
  const toMajor = fromMajor * rate;
  return Math.round(toMajor * Math.pow(10, exponentOf(toCurrency)));
}

/**
 * The cross rate between two currencies from a base-EUR table (the fx_rates
 * cache): units of `to` per one unit of `from`. Null when either side is
 * missing, and the CALLER then shows the original currency: a rate invented
 * from nothing is worse than a foreign number.
 */
export function crossRate(
  rates: Record<string, number>,
  from: string,
  to: string,
): number | null {
  if (from === to) return 1;
  const table: Record<string, number> = { EUR: 1, ...rates };
  const f = table[from];
  const t = table[to];
  if (!Number.isFinite(f) || !Number.isFinite(t) || f <= 0 || t <= 0) return null;
  return t / f;
}

/**
 * The one formatter (coordinator amendment 2): minor units and their ISO
 * code, optionally through a display currency.
 *
 *   formatMoney(1250, "USD")                                  -> "$12.50"
 *   formatMoney(1250, "USD", { currency: "CHF", rate: 0.8 })  -> "CHF 10.00"
 *   formatMoney(1250, "CRC", { currency: "CHF", rate: null }) -> "CRC 12.50"
 *
 * WHEN NO RATE EXISTS THE ORIGINAL CURRENCY SHOWS, converted nowhere: the
 * ECB's daily list carries no CRC (measured 2026-08-21), so a colones price
 * stays a colones price until an admin records a manual rate, and the
 * currency picker says so rather than pretending.
 */
export function formatMoney(
  amountMinor: number,
  currency: string,
  display?: { currency: string; rate: number | null },
): string {
  if (!display || display.currency === currency || display.rate === null || !Number.isFinite(display.rate) || display.rate <= 0) {
    return plainFormat(amountMinor, currency);
  }
  return plainFormat(convertMinor(amountMinor, currency, display.currency, display.rate), display.currency);
}

/**
 * The display currency to start a viewer on (P8): the project's own fiat
 * currency, and CHF when the project has not said, the universal default the
 * ruling names. A per-member preference (`users.prefs.displayCurrency`)
 * overrides both.
 */
export function defaultDisplayCurrency(project: { country?: string | null; fiatCurrency?: string | null }): string {
  const declared = String(project.fiatCurrency ?? "").trim().toUpperCase();
  if (declared) return declared;
  return "CHF";
}

/**
 * THE DAILY RATE LIST, HERE RATHER THAN BESIDE THE FETCHER.
 *
 * `server/lib/fxRates.ts` fetches the ECB's daily reference list and owns
 * everything about HOW. What the list CONTAINS is a fact three surfaces need
 * before any fetching happens: Make This Yours, the member's currency picker,
 * and the redemption currencies dial. A copy in `shared/` would answer them
 * and go stale the day a quote is added, so the list lives here and the
 * fetcher imports it. One definition, and the question below is derived from
 * it rather than hand-typed.
 *
 * CRC WAS DELIBERATELY ABSENT UNTIL 2026-09-25, and the reason is worth
 * keeping because it shaped everything around it. The ECB daily reference list
 * does not carry colones and never will, and the free providers built on that
 * list inherit the same hole (frankfurter, measured the same day: 29 quotes,
 * no CRC). So the first village this platform serves could not get a daily
 * rate for its own currency, and `hasDailyRate` had to be a question rather
 * than a rule.
 *
 * The source now carries it, and 164 others, with no key. That does NOT make
 * this a rule: a village may still name a currency nobody quotes, and the
 * hand-recorded row is still the answer when it does.
 */
export const FX_BASE = "EUR";

/**
 * Every quote the daily source publishes against EUR, pinned as literals.
 *
 * LITERALS, NOT WHATEVER THE RESPONSE HAPPENS TO CARRY. The URL contains no
 * currency codes at all now, so nothing stored can steer the fetch; this list
 * is the second half of that property, deciding which of the answer is kept.
 * A source that quietly began returning a code we do not recognise would be
 * ignored rather than stored.
 *
 * Captured 2026-09-25 from the live answer: 166 codes, of which EUR is the base
 * and the other 165 are here. Every one of the fourteen ECB quotes this list
 * used to hold is present, so the swap took nothing away.
 */
export const FX_QUOTES = [
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN",
  "BAM", "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BRL",
  "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHF", "CLF", "CLP",
  "CNH", "CNY", "COP", "CRC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP",
  "DZD", "EGP", "ERN", "ETB", "FJD", "FKP", "FOK", "GBP", "GEL", "GGP",
  "GHS", "GIP", "GMD", "GNF", "GTQ", "GYD", "HKD", "HNL", "HRK", "HTG",
  "HUF", "IDR", "ILS", "IMP", "INR", "IQD", "IRR", "ISK", "JEP", "JMD",
  "JOD", "JPY", "KES", "KGS", "KHR", "KID", "KMF", "KRW", "KWD", "KYD",
  "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "LYD", "MAD", "MDL", "MGA",
  "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR", "MWK", "MXN", "MYR",
  "MZN", "NAD", "NGN", "NIO", "NOK", "NPR", "NZD", "OMR", "PAB", "PEN",
  "PGK", "PHP", "PKR", "PLN", "PYG", "QAR", "RON", "RSD", "RUB", "RWF",
  "SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SHP", "SLE", "SLL", "SOS",
  "SRD", "SSP", "STN", "SYP", "SZL", "THB", "TJS", "TMT", "TND", "TOP",
  "TRY", "TTD", "TVD", "TWD", "TZS", "UAH", "UGX", "USD", "UYU", "UZS",
  "VES", "VND", "VUV", "WST", "XAF", "XCD", "XCG", "XDR", "XOF", "XPF",
  "YER", "ZAR", "ZMW", "ZWG", "ZWL",
] as const;

/**
 * DOES THIS CURRENCY CONVERT BY ITSELF, every day, with nobody typing a rate?
 *
 * A QUESTION, AND NOT A REFUSAL. It answers what the rate source carries and
 * stops there; whether a surface refuses an unquoted code, warns about it, or
 * says nothing at all is a product decision and belongs to the surface. Rye's
 * words on the currency picker, read literally, would refuse CRC, which is the
 * first village's own currency, so no caller of this refuses anything until he
 * has said which he meant.
 *
 * "No daily rate" is not "no rate": an admin can record a manual row, and the
 * amounts still show, unconverted, to anyone viewing in another currency. So
 * this is the narrow fact it claims to be.
 */
export function hasDailyRate(code: unknown): boolean {
  const c = String(code ?? "").trim().toUpperCase();
  if (!c) return false;
  return c === FX_BASE || (FX_QUOTES as readonly string[]).includes(c);
}

/**
 * NORMALISE THE CURRENCY ON AN INCOMING BRAND OVERLAY, IN PLACE, or say what
 * is wrong with it.
 *
 * The caller is `PUT /api/admin/brand`, which merges the whole Make This Yours
 * form in one body. The guard matters as much as the rule: a body that does
 * NOT carry `fiatCurrency` must be left alone, because normalising an absent
 * field would write blank over a currency the village had already answered,
 * on every unrelated brand save.
 *
 * Returns null when there is nothing to refuse, so the route reads as two
 * lines. It lives here rather than there for the same reason the reasoning
 * does: `server/index.ts` sits at exactly its line baseline, and the rule is
 * about currency rather than about routing.
 */
export function normaliseProjectCurrency(project: unknown): string | null {
  if (!project || typeof project !== "object") return null;
  const bag = project as Record<string, unknown>;
  if (!("fiatCurrency" in bag)) return null;
  const result = projectCurrencyToStore(bag.fiatCurrency);
  if (!result.ok) return result.error;
  bag.fiatCurrency = result.value;
  return null;
}

/**
 * WHAT THE PROJECT'S OWN CURRENCY BECOMES ON ITS WAY INTO STORAGE.
 *
 * `PUT /api/admin/brand` merged whatever arrived, so a value of spaces stored
 * as spaces, and the three surfaces then told three different stories: the
 * site fell back (every reader trims), the admin box showed empty with the
 * platform's own code as its placeholder, and anything asking "has this
 * village said?" saw a non-empty string and answered yes.
 *
 * TRIMMED AND UPPERCASED FIRST, THEN JUDGED. So whitespace alone becomes
 * blank, and blank MEANS INHERIT: an overlay field left empty, exactly like
 * every other field in `brand.project`, never an error. A code that is still
 * wrong after trimming is refused by the sentence `displayCurrencyProblem`
 * already gives a member setting their own display currency, because two
 * sentences for one rule is how they drift.
 *
 * WHY WHITESPACE IS NORMALISED RATHER THAN REFUSED: the brand save carries
 * the whole Make This Yours form in one request. Refusing it over characters
 * the form never showed anybody would throw away the name, the tagline and
 * the rest of a founder's afternoon.
 */
export function projectCurrencyToStore(
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = String(raw ?? "").trim().toUpperCase();
  const problem = displayCurrencyProblem(value);
  return problem ? { ok: false, error: problem } : { ok: true, value };
}

/** A display-currency preference is three letters, or nothing at all. */
export function displayCurrencyProblem(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !/^[A-Za-z]{3}$/.test(v)) {
    return "A display currency is a three letter code, like CHF or CRC";
  }
  return null;
}
