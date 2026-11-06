/**
 * WHAT A CARD SAYS A PIECE OF WORK PAYS, in words (0265).
 *
 * Rye, 2026-10-21: quest and role cards show every token assigned to them, or
 * "inquire for payment details" when no value is set, with live token names and
 * a live currency conversion (to USD, say) so the cards stay accurate.
 *
 * The server decides every figure (`questPay` and `rolePay`, server/lib/workPay.ts,
 * from the same function the consent and the settlement pay from). This file
 * only turns that answer into sentences:
 *
 *   the value     in the village's own currency, and beside it the same value
 *                 in the viewer's display currency, or in US dollars when the
 *                 viewer has not chosen one, through the daily rates
 *   the tokens    by their live names, never converted into money: a token only
 *                 has a price when the exchange posts one, and "no price set" is
 *                 not "worth nothing"
 *   the cash      what the work itself pays in cash (0285), and a role's
 *                 agreement; both stated, and never paid by the platform, which
 *                 records what the village owes instead
 *
 * Pure apart from `useDisplayRates`, which reads the day's rates once per page.
 */
import { useEffect, useState } from "react";
import { crossRate, exponentOf, formatMoney } from "@shared/money";
import type { PayBadge, PayLine, StatedCash, WorkPay, WorkValue } from "@shared/workValue";
import { storedText } from "@/lib/safeStorage";
import { configNow } from "@/lib/gameApi";

export type { WorkPay } from "@shared/workValue";

/** The day's display rates, base EUR, as `/api/fx/rates` serves them. */
export interface DisplayRates {
  base: string;
  asOf: string | null;
  rates: Record<string, number>;
}

/**
 * The viewer's chosen display currency, or "" for the village's own. The same
 * stored key the currency picker on the map writes (components/power/CurrencyPicker.tsx).
 */
export function chosenDisplayCurrency(): string {
  return String(storedText("local", "power-display-currency") ?? "").trim().toUpperCase();
}

let ratesOnce: Promise<DisplayRates | null> | null = null;

/** One read of the day's rates per page, shared by every card on it. */
export function loadDisplayRates(): Promise<DisplayRates | null> {
  if (!ratesOnce) {
    ratesOnce = fetch("/api/fx/rates")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return ratesOnce;
}

/** For a test: forget the page's cached rates. */
export function forgetDisplayRates(): void {
  ratesOnce = null;
}

export function useDisplayRates(): DisplayRates | null {
  const [rates, setRates] = useState<DisplayRates | null>(null);
  useEffect(() => {
    let alive = true;
    loadDisplayRates().then((r) => {
      if (alive) setRates(r);
    });
    return () => {
      alive = false;
    };
  }, []);
  return rates;
}

/** The village's own currency (Admin, Make This Yours), or "" while it has named none. */
function villageCurrency(): string {
  return String(configNow()?.project?.fiatCurrency ?? "").trim().toUpperCase();
}

/**
 * The currency a value is shown beside: the viewer's own choice when it differs
 * from the value's, and otherwise the village's own currency for a value held in
 * another one. Never a currency nobody here chose: a village that named none
 * shows the value as it is (readiness R154; it used to be US dollars).
 * Null when there is nothing worth converting to.
 */
export function conversionTarget(
  valueCurrency: string,
  chosen: string = chosenDisplayCurrency(),
  home: string = villageCurrency(),
): string | null {
  const from = valueCurrency.toUpperCase();
  if (chosen && chosen !== from) return chosen;
  const village = String(home ?? "").trim().toUpperCase();
  if (!chosen && village && from !== village) return village;
  return null;
}

/** "₡25,000" and, where a rate exists, "about $48". Never a converted figure without a rate. */
export function valueWords(
  value: WorkValue,
  rates: DisplayRates | null,
  chosen: string = chosenDisplayCurrency(),
  home: string = villageCurrency(),
): { own: string; converted: string | null } {
  const own = formatMoney(value.minor, value.currency);
  const target = conversionTarget(value.currency, chosen, home);
  if (!target || !rates?.rates) return { own, converted: null };
  const rate = crossRate(rates.rates, value.currency, target);
  if (rate === null) return { own, converted: null };
  const converted = formatMoney(value.minor, value.currency, { currency: target, rate });
  // A conversion that rounds to the same text says nothing new.
  return { own, converted: converted === own ? null : `about ${converted}` };
}

/** A token amount as a member reads it: whole numbers plain, fractions to the token's own places. */
function amountWords(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return Number.isInteger(rounded) ? rounded.toLocaleString("en") : rounded.toLocaleString("en", { maximumFractionDigits: 2 });
}

/** "40 Village Credits". */
export function lineWords(line: PayLine): string {
  return `${amountWords(line.amount)} ${line.name}`;
}

/** "40 Village Credits, 5 Village Voice". */
export function linesWords(lines: readonly PayLine[]): string {
  return lines.map(lineWords).join(", ");
}

/** "₡20,000 a month", or "₡10,000 to ₡20,000 a moon". Null when the terms state no figure. */
export function cashWords(cash: StatedCash | null | undefined): string | null {
  if (!cash || !cash.currency) return null;
  const per = cash.per ? ` a ${cash.per}` : "";
  if (cash.kind === "range" && cash.minMinor !== null && cash.maxMinor !== null) {
    return `${formatMoney(cash.minMinor, cash.currency)} to ${formatMoney(cash.maxMinor, cash.currency)}${per}`;
  }
  if (cash.minor !== null) return `${formatMoney(cash.minor, cash.currency)}${per}`;
  return null;
}

/**
 * The cash the work itself pays (0285), in the village's currency and, beside
 * it, the viewer's: "₡20,000 cash". Null when it pays none.
 */
export function cashPayWords(pay: WorkPay, rates: DisplayRates | null): { own: string; converted: string | null } | null {
  if (!pay.cashPay || pay.cashPay.minor <= 0) return null;
  const words = valueWords(pay.cashPay, rates);
  return { own: `${words.own} cash`, converted: words.converted };
}

/**
 * The terms' cash, shown only where the work states no cash of its own: a role
 * whose agreement and whose own figure both appeared would read as two sums.
 */
export function agreementCashWords(pay: WorkPay): string | null {
  return pay.cashPay ? null : cashWords(pay.cash);
}

/** "×2", "×1.5": a badge multiplier as a member reads it. */
export function factorWords(factor: number): string {
  return `×${Math.round(factor * 100) / 100}`;
}

/**
 * "×2 Village Voice with the Builder badge" (0278). The multiplier is paid at
 * consent or settlement to whoever holds the badge, so the card names it
 * beside the base figures and never folds it into them.
 */
export function badgeWords(b: PayBadge): string {
  return `${factorWords(b.factor)} ${b.name} with the ${b.badge} badge`;
}

/** The lines that pay Voice, by live name, for the sentence saying what Voice is. */
export function voiceNames(pay: WorkPay): string[] {
  return pay.lines.filter((l) => l.voice).map((l) => l.name);
}

/**
 * What the card leads with. `inquire` when nothing at all is known about the
 * pay, which is the one case the card says to ask.
 */
export function payHeadline(pay: WorkPay): "valued" | "paid-unvalued" | "inquire" {
  if (pay.value) return "valued";
  if (pay.lines.length > 0 || pay.cashPay || cashWords(pay.cash)) return "paid-unvalued";
  return "inquire";
}

/** The minor-unit exponent of a currency, for an editor turning typed money into minor units. */
export function currencyExponent(currency: string): number {
  return exponentOf(currency);
}

/**
 * What a set of quests or roles pays, in one sentence's worth of facts: how many
 * carry a value, the lowest and highest of those values in their most common
 * currency, and every token any of them pays, by live name. For a page that
 * talks about earning in general, so it reads what the work is actually set to
 * and stays true as values change (the Co-Creators Guide used to type its own).
 */
export interface PaySummary {
  count: number;
  valued: number;
  currency: string | null;
  lowMinor: number | null;
  highMinor: number | null;
  tokens: string[];
}

export function paySummary(pays: ReadonlyArray<WorkPay | null | undefined>): PaySummary {
  const present = pays.filter((p): p is WorkPay => !!p);
  const valued = present.filter((p) => p.value);
  const byCurrency = new Map<string, number[]>();
  for (const p of valued) {
    const list = byCurrency.get(p.value!.currency) ?? [];
    list.push(p.value!.minor);
    byCurrency.set(p.value!.currency, list);
  }
  let currency: string | null = null;
  let values: number[] = [];
  for (const [code, list] of Array.from(byCurrency.entries())) {
    if (list.length > values.length) {
      currency = code;
      values = list;
    }
  }
  const tokens: string[] = [];
  for (const p of present) for (const l of p.lines) if (!tokens.includes(l.name)) tokens.push(l.name);
  return {
    count: present.length,
    valued: valued.length,
    currency,
    lowMinor: values.length ? Math.min(...values) : null,
    highMinor: values.length ? Math.max(...values) : null,
    tokens,
  };
}

/** "worth ₡5,000 to ₡25,000, paid as Village Credits and Village Voice", or null when nothing is valued or paid. */
export function summaryWords(s: PaySummary): string | null {
  const worth =
    s.currency && s.lowMinor !== null && s.highMinor !== null
      ? s.lowMinor === s.highMinor
        ? `worth ${formatMoney(s.lowMinor, s.currency)}`
        : `worth ${formatMoney(s.lowMinor, s.currency)} to ${formatMoney(s.highMinor, s.currency)}`
      : null;
  const names = s.tokens.length > 1 ? `${s.tokens.slice(0, -1).join(", ")} and ${s.tokens[s.tokens.length - 1]}` : s.tokens[0];
  const paid = names ? `paid as ${names}` : null;
  if (!worth && !paid) return null;
  return [worth, paid].filter(Boolean).join(", ");
}
