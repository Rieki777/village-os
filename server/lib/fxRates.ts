/**
 * Daily exchange rates for DISPLAY (0083, P8, N4).
 *
 * One job a day fetches `open.er-api.com/v6/latest/EUR` through
 * `guardedFetchJson`, the SAME pinned, range-checked dialer every other
 * outbound call uses, and upserts one row per (quote, day) into `fx_rates`.
 * The route serves the newest table with an hour of cache. NOTHING here
 * touches settlement: Stripe charges what payments.ts always charged, the
 * ledger never reads this table, and there is no code path from here to any
 * write outside fx_rates (pinned by visionNeverApplies.test.ts).
 *
 * The quote list is fixed in code, not admin input: the URL is built from
 * `FX_BASE` alone, and `FX_QUOTES` only FILTERS the response, so no stored
 * string can steer the fetch. Widening the list therefore costs nothing in
 * reach and nothing in safety.
 *
 * ── CRC, AND A COMMENT THAT OUTLIVED ITS MEASUREMENT ─────────────────────
 *
 * This paragraph used to say CRC was "deliberately ABSENT: measured
 * 2026-08-21, the ECB daily list does not carry it". Both halves had stopped
 * being true and the sentence sat here pointing the next reader at a dead
 * end. Re-measured 2026-10-09:
 *
 *     provider open.er-api.com   166 quotes, EUR->CRC = 509.859732
 *     FX_QUOTES                  165 codes, CRC among them
 *     live GET /api/fx/rates     165 stored, CRC = 509.859732, asOf today
 *
 * So colones convert, and the currency picker's "no daily rate" warning no
 * longer fires for CRC. What that warning still protects is real and the
 * `manual` row path stays: a code this provider does not quote shows
 * unconverted rather than guessing, which is the honest answer and is what
 * `shared/money.ts`'s `crossRate` returning null means.
 *
 * THE LESSON WORTH LEAVING: a comment recording a measurement needs its date
 * AND its command, because the date alone cannot tell you whether the world
 * moved or the code did. Here the code moved — somebody widened FX_QUOTES to
 * 165 codes — and the prose had no way to notice. Prose is not compiled.
 */
import type { Pool } from "mysql2/promise";
import { guardedFetchJson } from "./toolcheck";

/*
 * THE LIST MOVED TO `shared/money.ts`, and is re-exported here so every
 * existing importer and test keeps its address. What it contains is a fact the
 * client needs too: Make This Yours, the member's currency picker and the
 * redemption currencies dial all ask whether a code converts by itself, and a
 * second copy in `shared/` would have gone stale the day a quote was added.
 * How the list is FETCHED is still entirely this file's business.
 */
export { FX_BASE, FX_QUOTES } from "../../shared/money";
import { FX_BASE, FX_QUOTES } from "../../shared/money";

/**
 * THE DAILY URL. No currency codes in it at all, which is stronger than the
 * property this file used to claim.
 *
 * The ECB endpoint built its path from `FX_QUOTES`, so the guarantee had to be
 * "those are literals, so nothing stored can steer the fetch". This one names
 * only the base, so there is nothing in the URL a stored string could steer
 * even if the literals rule were broken. Which quotes are KEPT is decided
 * afterwards, against `FX_QUOTES`, from data rather than from a path.
 *
 * Keyless on purpose (Rye, 2026-09-25: "find a keyless version ... without me
 * having to pay"). Measured the same day: this source answers 166 codes
 * including CRC; frankfurter and anything else derived from the ECB reference
 * list answers 29 and never CRC, because the ECB does not publish colones.
 */
export function dailyRatesUrl(): string {
  return `https://open.er-api.com/v6/latest/${FX_BASE}`;
}

export interface FxRow {
  quote: string;
  rate: number;
  asOf: string; // YYYY-MM-DD
}

/**
 * Read the daily answer. Pure, tested on a captured response.
 *
 * THE ENVELOPE IS CHECKED BEFORE THE RATES. This source answers HTTP 200 with
 * `result: "error"` for a bad request, so a caller that read `rates` first
 * would treat a refusal as an empty day and store nothing, silently, for as
 * long as the refusal lasted. `refreshDailyRates` already reports "no series"
 * on an empty parse, and that sentence would have been true and useless.
 *
 * THE BASE IS CHECKED TOO. Every rate here means "how many of this per one
 * FX_BASE", and `latestRates` hands the table to readers under that meaning.
 * A source answering a different base would invert nothing and break
 * everything, quietly, at whatever ratio the two bases happen to sit.
 *
 * Only quotes in `FX_QUOTES` are kept: the response is data, not a permission.
 */
export function parseDailyRates(doc: any): FxRow[] {
  if (doc?.result !== "success") return [];
  if (String(doc?.base_code ?? "").toUpperCase() !== FX_BASE) return [];
  const asOf = ymdFromUpdate(doc?.time_last_update_unix);
  if (!asOf) return [];
  const rates: Record<string, unknown> = doc?.rates ?? {};
  const wanted = new Set<string>(FX_QUOTES as readonly string[]);
  const out: FxRow[] = [];
  for (const [code, value] of Object.entries(rates)) {
    const quote = String(code).toUpperCase();
    if (!wanted.has(quote)) continue;
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    out.push({ quote, rate, asOf });
  }
  return out.sort((a, b) => a.quote.localeCompare(b.quote));
}

/**
 * The day the source stamped, never this machine's.
 *
 * `time_last_update_unix` is when the rates were published. Taking our own
 * date instead would write today's row from yesterday's numbers whenever the
 * job runs before the source updates, and `latestRates` takes MAX(as_of), so
 * that row would outrank the real one when it arrived.
 */
function ymdFromUpdate(unix: unknown): string | null {
  const n = Number(unix);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Upsert fetched rows. One row per (quote, day); re-runs are idempotent. */
export async function storeRates(pool: Pool, rows: FxRow[], source = "ecb"): Promise<number> {
  let n = 0;
  for (const r of rows) {
    const [res]: any = await pool.query(
      "INSERT INTO fx_rates (quote, rate, as_of, source) VALUES (?,?,?,?) " +
        "ON DUPLICATE KEY UPDATE rate = VALUES(rate), source = VALUES(source)",
      [r.quote, r.rate, r.asOf, source],
    );
    n += res?.affectedRows ? 1 : 0;
  }
  return n;
}

/** The daily job's whole body: fetch through the guard, store, say what happened. */
export async function refreshDailyRates(pool: Pool): Promise<string> {
  const doc = await guardedFetchJson(dailyRatesUrl(), 15_000);
  const rows = parseDailyRates(doc);
  if (!rows.length) return "the rate source answered with nothing usable";
  const stored = await storeRates(pool, rows);
  return `${stored} rate(s) for ${rows[rows.length - 1]?.asOf}`;
}

export interface FxTable {
  base: string;
  asOf: string | null;
  rates: Record<string, number>;
}

/**
 * The newest known rate per quote, manual rows included, within the last 14
 * days so a dead feed decays to "no rate" (original currencies show) instead
 * of quietly serving last quarter's numbers forever.
 */
export async function latestRates(pool: Pool): Promise<FxTable> {
  const [rows]: any = await pool.query(
    `SELECT f.quote, f.rate, f.as_of
       FROM fx_rates f
       JOIN (SELECT quote, MAX(as_of) AS as_of FROM fx_rates
              WHERE as_of >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
              GROUP BY quote) latest
         ON latest.quote = f.quote AND latest.as_of = f.as_of`,
  );
  const rates: Record<string, number> = {};
  let asOf: string | null = null;
  for (const r of rows as any[]) {
    rates[String(r.quote)] = Number(r.rate);
    const day = r.as_of instanceof Date ? r.as_of.toISOString().slice(0, 10) : String(r.as_of).slice(0, 10);
    if (!asOf || day > asOf) asOf = day;
  }
  return { base: FX_BASE, asOf, rates };
}
