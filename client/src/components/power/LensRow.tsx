/**
 * The "How we decide" lens's own row: which domain the colours answer for, and
 * the key that says what each colour means.
 *
 * Moved out of `client/src/pages/VillageMap.tsx` (2026-09-21) because it is
 * now drawn in two places: under the filters on a wide screen, as it always
 * was, and in the phone's tool strip over the map, so a lens turned on there
 * is read there. `touch` gives the domain chips a thumb's height.
 */
import { DecideKey } from "./DecideLens";
import type { PowerData } from "./types";

export default function LensRow({
  data,
  domain,
  onDomain,
  touch = false,
  className = "flex",
}: {
  data: PowerData;
  domain: string | null;
  onDomain: (d: string | null) => void;
  touch?: boolean;
  /** The row's display, so a caller can show it at one width only. */
  className?: string;
}) {
  return (
    <div className={`${className} items-center gap-2 flex-wrap`} data-power-lens-row>
      <div role="group" aria-label="Which domain" className="flex items-center gap-1 flex-wrap">
        {[null, ...data.power.glossary.domains.map((d) => d.id)].map((d) => {
          const def = d ? data.power.glossary.domains.find((x) => x.id === d) : null;
          return (
            <button
              key={d ?? "overall"}
              type="button"
              aria-pressed={domain === d}
              title={def?.gloss}
              onClick={() => onDomain(d)}
              className={`${touch ? "min-h-9 px-3 text-[13px]" : "text-xs px-2 py-1"} rounded-full border ${
                domain === d ? "bg-teal-deep text-white border-teal-deep" : "bg-card text-muted-foreground border-border"
              }`}
            >
              {def?.label ?? "Overall"}
            </button>
          );
        })}
      </div>
      <DecideKey circles={data.circles} power={data.power} domain={domain} />
    </div>
  );
}
