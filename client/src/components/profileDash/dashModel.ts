/**
 * THE PROFILE DASHBOARD'S ARITHMETIC, kept pure so it can be tested without a
 * render (approved design, Rye, 2026-10-30).
 *
 * Every function here reads a payload the page already holds and says either
 * something true about it or nothing: a figure with no payload behind it is
 * `null`, and the component draws nothing for a null. Whole numbers only
 * (Rye, 2026-09-04), so every count is rounded once, here.
 */

/** A whole number, grouped for the reader's locale: 1240 reads "1,240". */
export const whole = (n: number): string =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.round(n));

/** Whole days from `now` until `iso`, never below zero. Null for a date that does not parse. */
export function daysUntil(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.ceil((t - now.getTime()) / 86_400_000));
}

/** A ledger amount in MINOR units, read in whole human units. */
const human = (amount: number, decimals: number) => (Number(amount) || 0) / Math.pow(10, Math.max(0, Number(decimals) || 0));

/**
 * What a token EARNED inside a window: credits only, in whole units.
 *
 * A send or a redemption is a debit and is not "earned", so a member who gave
 * thanks away this moon still sees what came in. `start` is inclusive and
 * `end` exclusive, the way the cycle rows bound a moon.
 */
export function earnedIn(
  ledger: ReadonlyArray<{ tokenType: string; amount: number; decimals: number; at: string }>,
  token: string,
  start: string,
  end?: string | null,
): number {
  const a = Date.parse(start);
  const b = end ? Date.parse(end) : Infinity;
  if (!Number.isFinite(a)) return 0;
  return Math.round(
    ledger
      .filter((e) => e.tokenType === token && e.amount > 0)
      .filter((e) => {
        const t = Date.parse(e.at);
        return t >= a && t < b;
      })
      .reduce((n, e) => n + human(e.amount, e.decimals), 0),
  );
}

export interface CashSummary {
  /** Owed and claimed together: what the village has yet to send, in minor units. */
  outstandingMinor: number;
  currency: string | null;
  owed: number;
  claimed: number;
  paid: number;
}

/**
 * The cash purse in one pass. Mixed currencies are possible in principle and
 * would make one total a lie, so `currency` is null when the outstanding lines
 * disagree, and the purse then names the lines rather than a sum.
 */
export function cashSummary(entries: ReadonlyArray<{ amountMinor: number; currency: string; state: "owed" | "claimed" | "paid" }>): CashSummary {
  const out = entries.filter((e) => e.state !== "paid");
  const currencies = new Set(out.map((e) => e.currency));
  return {
    outstandingMinor: out.reduce((n, e) => n + (Number(e.amountMinor) || 0), 0),
    currency: currencies.size === 1 ? Array.from(currencies)[0] : null,
    owed: entries.filter((e) => e.state === "owed").length,
    claimed: entries.filter((e) => e.state === "claimed").length,
    paid: entries.filter((e) => e.state === "paid").length,
  };
}

export interface MoonRow {
  label: string;
  tokens: number;
  voice: number;
  /** Cash that came due in the moon, and whether all of it has been paid. */
  cashMinor: number;
  cashPaid: boolean;
}

/**
 * Earned by moon: this moon and the two closed ones before it, off the cycle
 * rows the server keeps, so a boundary is the village's own and never a
 * twenty-nine-day guess. A moon the village has no row for is left out.
 */
export function moonRows(
  ledger: ReadonlyArray<{ tokenType: string; amount: number; decimals: number; at: string }>,
  moons: { current: { startsAt: string; endsAt: string } | null; past: ReadonlyArray<{ startsAt: string; endsAt: string; cycleNumber: number }> },
  tokens: { village: string | null; voice: string | null },
  cash: ReadonlyArray<{ amountMinor: number; state: string; owedAt: string }>,
): MoonRow[] {
  const windows: Array<{ label: string; startsAt: string; endsAt: string | null }> = [];
  if (moons.current) windows.push({ label: "This moon", startsAt: moons.current.startsAt, endsAt: null });
  const past = [...moons.past].sort((a, b) => b.cycleNumber - a.cycleNumber).slice(0, windows.length ? 2 : 3);
  past.forEach((m, i) => windows.push({ label: i === 0 ? "Last moon" : `${i + 1} moons ago`, startsAt: m.startsAt, endsAt: m.endsAt }));
  return windows.map((w) => {
    const a = Date.parse(w.startsAt);
    const b = w.endsAt ? Date.parse(w.endsAt) : Infinity;
    const due = cash.filter((c) => {
      const t = Date.parse(c.owedAt);
      return t >= a && t < b;
    });
    return {
      label: w.label,
      tokens: tokens.village ? earnedIn(ledger, tokens.village, w.startsAt, w.endsAt) : 0,
      voice: tokens.voice ? earnedIn(ledger, tokens.voice, w.startsAt, w.endsAt) : 0,
      cashMinor: due.reduce((n, c) => n + (Number(c.amountMinor) || 0), 0),
      cashPaid: due.length > 0 && due.every((c) => c.state === "paid"),
    };
  });
}

/**
 * Which wallet rows are the village's value token and Voice.
 *
 * The value token is picked BY NAME, the slug `/api/game/config` serves as
 * `currency.value.slug` (the `gratitude.pool_token` variable, the token the
 * village pays work and its cycle pool in). It used to be the first row that
 * was neither Voice nor recognition, in the wallet's own order, and the wallet
 * lists claimable rows first: Earned Equity came before Village Credits, so
 * the Tokens tile read 0 for a member holding 25 (E2E finding E6,
 * 2026-10-31). No slug yet (the config has not answered) or no row for it
 * (the member's wallet does not list it) is null, which the tile draws as
 * nothing, never as some other token's balance. A recognition row is never
 * the value token, even if a village points the variable at one.
 */
export function pickTokens<T extends { token: string; kind: string; role: string }>(
  rows: ReadonlyArray<T>,
  valueSlug: string | null | undefined,
): { village: T | null; voice: T | null } {
  return {
    voice: rows.find((r) => r.kind === "voice") ?? null,
    village: valueSlug
      ? (rows.find((r) => r.token === valueSlug && r.role !== "gratitude" && r.kind !== "recognition") ?? null)
      : null,
  };
}

/**
 * Money in whole units of its currency, "CRC 45,000" for 4,500,000 minor
 * (Rye, 2026-09-04: whole numbers). The currency's own exponent comes off
 * Intl, so a zero-decimal currency is never divided twice.
 */
export function wholeMoney(amountMinor: number, currency: string): string {
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    const major = Math.round((Number(amountMinor) || 0) / Math.pow(10, digits));
    return new Intl.NumberFormat("en", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(major);
  } catch {
    return `${Math.round(Number(amountMinor) || 0)} ${currency}`;
  }
}
