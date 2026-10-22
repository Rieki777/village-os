/**
 * THE CURRENCY THIS VILLAGE'S PRICES ARE IN, PICKED BY ITS NAME.
 *
 * Rye, 2026-10-22: "I can't set Colones". The save route took CRC all along
 * (shared/money.ts `projectCurrencyToStore`); the screen never said which code
 * colones are. The box offered bare codes as browser suggestions, a browser
 * narrows that list to whatever is already in the box, so a box holding USD
 * suggested USD and nothing else, and a name typed into it was cut to three
 * letters: "Colones" became "COL", which is another code.
 *
 * So every currency is listed by its name with its code beside it: the daily
 * rate source's own list (`FX_BASE` and `FX_QUOTES`, 166 codes), named by the
 * browser's own currency names, sorted by name. "Another code" stays for a
 * currency that list does not carry, which keeps the field open. Openness was
 * the reason this used to be free text: the list then was the ECB's fourteen,
 * and CRC was not one of them.
 *
 * Its own file because client/src/pages/Admin.tsx is on a line ratchet that
 * only turns down. Light-only, like the rest of this folder.
 */
import { useEffect, useMemo, useState } from "react";
import CurrencyAnswerNote from "@/components/admin/CurrencyAnswerNote";
import { API_BASE } from "@/components/admin/adminApi";
import { FX_BASE, FX_QUOTES, displayCurrencyProblem } from "@shared/money";

const ANOTHER = "__another";

/** The browser's English name for a currency code, or null when it has none. */
export function currencyName(code: string): string | null {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "currency" }).of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

/**
 * Every currency the picker offers, by name. A code the village already stored
 * is always among them, even one the list does not carry, so opening this
 * screen can never quietly show a different answer from the one saved.
 */
export function currencyChoices(stored: string): { code: string; label: string }[] {
  const codes = new Set<string>([FX_BASE, ...FX_QUOTES]);
  if (/^[A-Z]{3}$/.test(stored)) codes.add(stored);
  return Array.from(codes)
    .map((code) => {
      const name = currencyName(code);
      return { code, label: name ? `${name} (${code})` : code };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export default function VillageCurrencyField({
  value,
  platformDefault,
  onChange,
}: {
  /** The stored overlay value, as typed or chosen. Blank means inherit. */
  value: string;
  platformDefault: string;
  onChange: (code: string) => void;
}) {
  const code = value.trim().toUpperCase();
  const choices = useMemo(() => currencyChoices(code), [code]);
  const listed = code === "" || choices.some((c) => c.code === code);
  // Open while somebody types a code of their own, and for a stored value the
  // list cannot show (a malformed one), so it is visible and can be fixed.
  const [typing, setTyping] = useState(false);
  const another = typing || !listed;

  /*
   * Which codes the daily rate table carries, read live from the route the
   * member-facing picker reads, so the note below never drifts from what the
   * village can really convert. Empty is a fine answer: the note only speaks
   * when it knows something.
   */
  const [fxCovered, setFxCovered] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/fx/rates`)
      .then((r) => (r.ok ? r.json() : null))
      .then((t) => {
        // ONLY when rates actually arrived. Seeding from `t.base` alone would
        // say there is no rate for USD on a village whose daily job had not run.
        const rates = Object.keys(t?.rates ?? {});
        if (alive && rates.length) setFxCovered([t.base, ...rates].filter(Boolean));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const problem = another ? displayCurrencyProblem(code) : null;
  const covered = fxCovered.includes(code);

  return (
    <div className="md:col-span-2">
      <label className="text-xs font-medium text-gray-500 block mb-1" htmlFor="project-fiat-currency">
        Currency your prices are in
      </label>
      <select
        id="project-fiat-currency"
        aria-describedby="project-fiat-currency-note"
        value={another ? ANOTHER : code}
        onChange={(e) => {
          const picked = e.target.value;
          setTyping(picked === ANOTHER);
          onChange(picked === ANOTHER ? "" : picked);
        }}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
      >
        <option value="">{platformDefault ? `Not chosen yet (platform default ${platformDefault})` : "Not chosen yet"}</option>
        {choices.map((c) => (
          <option key={c.code} value={c.code}>
            {c.label}
          </option>
        ))}
        <option value={ANOTHER}>Another code</option>
      </select>
      {another && (
        <input
          id="project-fiat-currency-other"
          type="text"
          aria-label="Currency code, three letters"
          aria-describedby="project-fiat-currency-note"
          // A bare role="alert" is announced once and is then unreachable;
          // aria-invalid exposes a state the red text cannot.
          aria-invalid={problem ? true : undefined}
          maxLength={3}
          value={code}
          // Uppercased on the way in, so "chf" and "CHF" cannot become two
          // different villages' worth of stored value.
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          placeholder="Three letters"
          className="w-full mt-2 px-3 py-2 text-sm border border-gray-200 rounded-lg uppercase"
        />
      )}
      {problem ? (
        <p id="project-fiat-currency-note" role="alert" className="text-[11px] text-red-600 mt-0.5">{problem}</p>
      ) : code && fxCovered.length > 0 && !covered ? (
        <p id="project-fiat-currency-note" className="text-[11px] text-amber-700 mt-0.5">
          There is no daily rate for {code}, so anyone viewing in another currency sees your
          amounts unconverted until an admin records a rate by hand. Prices themselves are unaffected.
        </p>
      ) : (
        <p id="project-fiat-currency-note" className="text-[11px] text-gray-400 mt-0.5">
          {platformDefault ? `Platform default: ${platformDefault}. ` : ""}This sets what every price on the
          site is quoted in, and what a member sees before choosing their own display currency.
        </p>
      )}
      <CurrencyAnswerNote answered={!!code} />
    </div>
  );
}
