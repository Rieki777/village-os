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
import { authToken } from "@/lib/gameApi";
import { removeStored, storedText, writeStored } from "@/lib/safeStorage";
import { defaultDisplayCurrency } from "@shared/money";

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
  const [projectCurrency, setProjectCurrency] = useState<string>("CHF");
  const [choice, setChoice] = useState<string>(() => storedDisplayCurrency());

  useEffect(() => {
    fetch("/api/fx/rates")
      .then((r) => (r.ok ? r.json() : null))
      .then(setTable)
      .catch(() => {});
    fetch("/api/game/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cfg?.project) setProjectCurrency(defaultDisplayCurrency(cfg.project));
      })
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
    onChange?.(resolved, table);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, table]);

  const options = Array.from(
    new Set([projectCurrency, "CHF", "EUR", ...Object.keys(table?.rates ?? {})]),
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
          <option value="">{projectCurrency} (this village's)</option>
          {options
            .filter((c) => c !== projectCurrency)
            .map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
        </select>
      </label>
      {!covered(resolved) && (
        <p className="text-[10px] text-muted-foreground mt-1">
          No daily rate for {resolved} yet, so amounts in other currencies show unconverted.
        </p>
      )}
    </div>
  );
}
