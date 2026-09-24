/**
 * The display currency (0083, P8, N4): per viewer, DISPLAY only.
 *
 * Lives on the legend's footer in v1; the site-header mount is a
 * coordinator follow-up. Signed in, the choice lands in
 * `users.prefs.displayCurrency` through the prefs route; signed out it
 * stays in this browser. Either way it changes what numbers LOOK like and
 * nothing about what anything costs: Stripe settlement is untouched.
 *
 * The picker is honest about coverage: a currency with no rate in the daily
 * table (CRC, until an admin records a manual row) is listed and marked
 * "shows unconverted", because pretending to convert would be a made-up
 * number wearing a real currency's clothes.
 */
import { useEffect, useState } from "react";
import { authToken, useGameConfig } from "@/lib/gameApi";
import { removeStored, storedText, writeStored } from "@/lib/safeStorage";

const STORAGE_KEY = "power-display-currency";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export interface FxTable {
  base: string;
  asOf: string | null;
  rates: Record<string, number>;
}

/** The stored choice, or "" meaning "the project's own". Shared so any
 *  money-rendering surface reads the same one. */
export function storedDisplayCurrency(): string {
  return storedText("local", STORAGE_KEY) ?? "";
}

export default function CurrencyPicker({
  onChange,
}: {
  /** Fires with the resolved code and the rate table, for the page to re-render amounts. */
  onChange?: (currency: string, rates: FxTable | null) => void;
}) {
  const [table, setTable] = useState<FxTable | null>(null);
  /*
   * THE VILLAGE'S OWN CURRENCY, ONCE THE VILLAGE HAS SAID IT. This started as
   * "CHF" and held it until /api/game/config answered, and for good when that
   * request failed, so a village that trades in colones was first told its own
   * currency was Swiss francs (measured on the live map, 2026-09-21: the config
   * says CRC). Until the config is known there is no village currency to name,
   * and the picker says "this village's own" instead of guessing one. The
   * config comes through the app's one cached read, not a second request.
   */
  const config = useGameConfig();
  /*
   * AND ONLY WHAT THE VILLAGE ACTUALLY SAID. This read `defaultDisplayCurrency`,
   * which answers CHF for a project that declares nothing, so a village that
   * had simply not filled the field in was told its own currency was Swiss
   * francs. Measured live on 2026-09-24: `/api/game/config` returned
   * `fiatCurrency: ""` and the picker read "CHF (this village's)".
   *
   * A village that has not said and a config that could not answer are the
   * same state from the reader's side, which is that nobody has told us, so
   * both now say "this village's own" and name no code. The fallback in
   * `defaultDisplayCurrency` stays where it belongs, on the server paths that
   * have to convert an amount into something.
   */
  const projectCurrency = String(config?.project?.fiatCurrency ?? "").trim().toUpperCase();
  const [choice, setChoice] = useState<string>(() => storedDisplayCurrency());

  useEffect(() => {
    fetch("/api/fx/rates")
      .then((r) => (r.ok ? r.json() : null))
      .then(setTable)
      .catch(() => {});
    if (authToken()) {
      fetch("/api/profile", { headers: headers() })
        .then((r) => (r.ok ? r.json() : null))
        .then((u) => {
          const pref = u?.prefs?.displayCurrency;
          if (pref) setChoice(String(pref));
        })
        .catch(() => {});
    }
  }, []);

  const resolved = choice || projectCurrency;

  useEffect(() => {
    // Nothing to report until there is a currency to name.
    if (resolved) onChange?.(resolved, table);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, table]);

  const options = Array.from(
    new Set([projectCurrency, "CHF", "EUR", ...Object.keys(table?.rates ?? {})].filter(Boolean)),
  ).sort();

  const covered = (code: string) => code === "EUR" || !!table?.rates?.[code];

  const save = (code: string) => {
    setChoice(code);
    // A blocked store still leaves the in-memory choice working.
    if (code) writeStored("local", STORAGE_KEY, code);
    else removeStored("local", STORAGE_KEY);
    if (authToken()) {
      fetch("/api/profile/prefs", {
        // save-ok: local-first. localStorage above is the source this picker
        // reads back, and the server copy only carries the choice to another
        // device, so a refusal costs nothing the person can see here.
        method: "PUT",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ displayCurrency: code }),
      }).catch(() => {});
    }
  };

  return (
    <div data-power-currency className="text-left">
      <label className="text-[11px] text-muted-foreground flex items-center gap-2">
        <span>Show money in</span>
        <select
          value={choice}
          onChange={(e) => save(e.target.value)}
          className="text-xs border border-border rounded-full px-2 py-1 bg-background max-w-32"
        >
          <option value="">{projectCurrency ? `${projectCurrency} (this village's)` : "This village's own"}</option>
          {options
            .filter((c) => c !== projectCurrency)
            .map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
        </select>
      </label>
      {!!resolved && !covered(resolved) && (
        <p className="text-[10px] text-muted-foreground mt-1">
          No daily rate for {resolved} yet, so amounts in other currencies show unconverted.
        </p>
      )}
    </div>
  );
}
