/**
 * Daily exchange rates for DISPLAY (0083, P8, N4).
 *
 * One job a day fetches the ECB's daily reference list (base EUR) through
 * `guardedFetchJson`, the SAME pinned, range-checked dialer every other
 * outbound call uses, and upserts one row per (quote, day) into `fx_rates`.
 * The route serves the newest table with an hour of cache. NOTHING here
 * touches settlement: Stripe charges what payments.ts always charged, the
 * ledger never reads this table, and there is no code path from here to any
 * write outside fx_rates (pinned by visionNeverApplies.test.ts).
 *
 * The quote list is fixed in code, not admin input: the URL is built from
 * these literals only, so no stored string can steer the fetch. CRC is
 * deliberately ABSENT: measured 2026-08-21, the ECB daily list does not
 * carry it (a request for CRC returns the other series and no CRC), so a
 * colones amount shows unconverted until an admin records a `manual` row,
 * and the currency picker says so.
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

export function ecbDailyUrl(quotes: readonly string[] = FX_QUOTES): string {
  return (
    "https://data-api.ecb.europa.eu/service/data/EXR/" +
    `D.${quotes.join("+")}.${FX_BASE}.SP00.A` +
    "?lastNObservations=1&format=jsondata"
  );
}

export interface FxRow {
  quote: string;
  rate: number;
  asOf: string; // YYYY-MM-DD
}

/**
 * Read the SDMX JSON the ECB data portal answers with. Pure, tested on a
 * captured response. Series are keyed `0:i:0:0:0` where `i` indexes the
 * CURRENCY dimension; observations are keyed by the TIME_PERIOD index. A
 * quote the list does not carry simply has no series, which is how the CRC
 * absence arrives: silently, so the caller must not infer from silence.
 */
export function parseEcbSeries(doc: any): FxRow[] {
  const out: FxRow[] = [];
  const seriesDims: any[] = doc?.structure?.dimensions?.series ?? [];
  const currencyDim = seriesDims.find((d) => d?.id === "CURRENCY");
  const currencyIdx = seriesDims.findIndex((d) => d?.id === "CURRENCY");
  const timeValues: any[] = doc?.structure?.dimensions?.observation?.[0]?.values ?? [];
  const series: Record<string, any> = doc?.dataSets?.[0]?.series ?? {};
  if (!currencyDim || currencyIdx < 0) return out;
  for (const [key, s] of Object.entries(series)) {
    const parts = key.split(":");
    const quote = currencyDim.values?.[Number(parts[currencyIdx])]?.id;
    if (!quote || typeof quote !== "string") continue;
    for (const [obsKey, obs] of Object.entries((s as any)?.observations ?? {})) {
      const asOf = timeValues[Number(obsKey)]?.id;
      const rate = Array.isArray(obs) ? Number(obs[0]) : NaN;
      if (!asOf || !Number.isFinite(rate) || rate <= 0) continue;
      out.push({ quote: quote.toUpperCase(), rate, asOf: String(asOf) });
    }
  }
  return out.sort((a, b) => a.quote.localeCompare(b.quote) || a.asOf.localeCompare(b.asOf));
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
  const doc = await guardedFetchJson(ecbDailyUrl(), 15_000);
  const rows = parseEcbSeries(doc);
  if (!rows.length) return "ECB answered with no series";
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
