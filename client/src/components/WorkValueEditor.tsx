/**
 * WHAT A STEWARD TYPES ABOUT A QUEST'S OR A ROLE'S PAY (0265, Rye 2026-10-21).
 *
 * The value in the village's own currency, and the token amounts beside it.
 * Every quest carries a value from the moment it is created. The tokens offered
 * are the ones this village has an enabled rule for, read from
 * `GET /api/quests/pay-options`, and each is paid in full: no ceiling binds
 * work (Rye, 2026-10-22: "we definitely can't have caps on what things pay").
 * Gratitude is never one of them, because it pays no work. A new
 * quest opens on the village's standard amounts, so what the steward sees is
 * what the quest will pay.
 *
 * The server checks everything again before it stores anything. This screen
 * only says early what the server would say late.
 *
 * ONE CURRENCY ON THE SCREEN: the village's, today. The server stamps that
 * currency on every value it saves, so a box labelled in a record's OLD
 * currency would store the same figure in the new one: 50 USD saved as 50
 * CRC the day a village moves to colones (Rye, 2026-10-22). A record valued
 * in another currency opens with the value box empty and its old value said
 * beside it; left empty, the save leaves that value exactly as it was.
 */
import { useEffect, useState } from "react";
import { currencyExponent } from "@/lib/workPay";
import type { TokenAmount } from "@shared/workValue";

/** One token the village lets work pay, as the options read sends it. */
export interface PayOption {
  token: string;
  name: string;
  /** The rule's fixed amount, which work with no list of its own is paid. */
  standard: number | null;
  decimals: number;
}

export interface PayOptions {
  currency: string;
  quest: PayOption[];
  role: PayOption[];
}

/** What is in the boxes: text as typed, so a half-typed number is not lost. */
export interface WorkValueDraft {
  value: string;
  tokens: Record<string, string>;
  /** A stored value in a currency that is no longer the village's, kept unless retyped. */
  held?: { minor: number; currency: string };
}

let optionsOnce: Promise<PayOptions | null> | null = null;

export function loadPayOptions(): Promise<PayOptions | null> {
  if (!optionsOnce) {
    optionsOnce = fetch("/api/quests/pay-options")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return optionsOnce;
}

/** For a test, and after a rule changes: read the options again next time. */
export function forgetPayOptions(): void {
  optionsOnce = null;
}

export function usePayOptions(): PayOptions | null {
  const [options, setOptions] = useState<PayOptions | null>(null);
  useEffect(() => {
    let alive = true;
    loadPayOptions().then((o) => {
      if (alive) setOptions(o);
    });
    return () => {
      alive = false;
    };
  }, []);
  return options;
}

const plain = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10000) / 10000));

/**
 * The boxes for a record that may already carry a value and a list. A record
 * with no list of its own opens on the standard amounts, which is what it is
 * paid today.
 */
export function draftFrom(
  record: { valueMinor?: number | null; valueCurrency?: string | null; valueTokens?: TokenAmount[] | null } | null | undefined,
  offered: readonly PayOption[],
  currency: string,
): WorkValueDraft {
  const minor = record?.valueMinor;
  const stored = record?.valueCurrency || currency;
  const held = minor !== null && minor !== undefined && !!currency && stored !== currency ? { minor, currency: stored } : undefined;
  const value = minor === null || minor === undefined || held ? "" : plain(minor / 10 ** currencyExponent(currency));
  const tokens: Record<string, string> = {};
  for (const o of offered) {
    const own = record?.valueTokens?.find((t) => t.token === o.token);
    if (record?.valueTokens) tokens[o.token] = own ? plain(own.amount) : "0";
    else tokens[o.token] = o.standard !== null && o.standard > 0 ? plain(o.standard) : "0";
  }
  return held ? { value, tokens, held } : { value, tokens };
}

/** A held value as a person reads it: "50 USD". */
export function heldWords(held: { minor: number; currency: string }): string {
  return `${plain(held.minor / 10 ** currencyExponent(held.currency))} ${held.currency}`;
}

/**
 * The boxes as the save route reads them, or the first thing wrong with them.
 * `required` refuses an empty value, which every new quest must carry.
 */
export function draftToBody(
  draft: WorkValueDraft,
  offered: readonly PayOption[],
  currency: string,
  opts: { required: boolean },
): { ok: true; valueMinor: number | null | undefined; valueTokens: TokenAmount[] } | { ok: false; error: string } {
  const raw = draft.value.replace(/,/g, "").trim();
  // undefined leaves the stored value alone: an empty box over a held value.
  let valueMinor: number | null | undefined = null;
  if (raw === "" && draft.held) {
    valueMinor = undefined;
  } else if (raw === "") {
    if (opts.required) return { ok: false, error: "Say what this is worth before it goes on the board." };
  } else {
    const major = Number(raw);
    if (!Number.isFinite(major) || major < 0) return { ok: false, error: "A value is a number, zero or more." };
    valueMinor = Math.round(major * 10 ** currencyExponent(currency));
  }
  const valueTokens: TokenAmount[] = [];
  for (const o of offered) {
    const text = String(draft.tokens[o.token] ?? "").replace(/,/g, "").trim();
    if (text === "") continue;
    const amount = Number(text);
    if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: `The amount of ${o.name} is a number, zero or more.` };
    if (amount > 0) valueTokens.push({ token: o.token, amount });
  }
  return { ok: true, valueMinor, valueTokens };
}

export default function WorkValueEditor({
  draft,
  onChange,
  offered,
  currency,
  cadence,
  inputClassName,
}: {
  draft: WorkValueDraft;
  onChange: (next: WorkValueDraft) => void;
  offered: readonly PayOption[] | null;
  currency: string | null;
  /** A quest pays once, at consent; a role pays each seat every cycle. */
  cadence: "once" | "cycle";
  /** The host's own input style, so the editor sits in Admin and on /review alike. */
  inputClassName: string;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium">
        What it is worth{currency ? `, in ${currency}` : ""}
        <input
          inputMode="decimal"
          value={draft.value}
          onChange={(e) => onChange({ ...draft, value: e.target.value })}
          placeholder="25000"
          className={`w-full mt-1 ${inputClassName}`}
        />
      </label>
      {draft.held && (
        <p className="text-xs opacity-70">
          Valued at {heldWords(draft.held)} before this village changed its currency. Left empty, that value stays as it is.
          {currency ? ` Type a figure to value it in ${currency} instead.` : ""}
        </p>
      )}
      {offered === null ? (
        <p className="text-xs opacity-70">Reading which tokens this village pays for work.</p>
      ) : offered.length === 0 ? (
        <p className="text-xs opacity-70">
          This village has no rule paying any token for this kind of work yet, so it pays in no tokens. A rule is added on the Mint panel.
        </p>
      ) : (
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium">
            {cadence === "cycle" ? "What it pays each holder, every cycle" : "What it pays when the work is confirmed"}
          </legend>
          {offered.map((o) => (
            <label key={o.token} className="flex items-center gap-2 text-xs">
              <input
                inputMode="decimal"
                value={draft.tokens[o.token] ?? ""}
                onChange={(e) => onChange({ ...draft, tokens: { ...draft.tokens, [o.token]: e.target.value } })}
                className={`w-28 ${inputClassName}`}
                aria-label={o.name}
              />
              <span>
                {o.name}
              </span>
            </label>
          ))}
          <p className="text-xs opacity-70">A token left at 0 is not paid.</p>
        </fieldset>
      )}
    </div>
  );
}
