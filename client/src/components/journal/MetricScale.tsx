/**
 * One pulse number as a row of large tiles, with the words for each end.
 *
 * Native radio inputs underneath, so the arrow keys move along the scale and
 * a screen reader announces "3 of 5" without any of it being rebuilt here.
 * The energy scale runs -2 to +2 and is shown with its signs, because its
 * middle is the balanced answer and both ends are signals.
 */
import { signed } from "./ui";

export default function MetricScale({
  name,
  prompt,
  min,
  max,
  ends,
  value,
  onValue,
  headingId,
}: {
  name: string;
  prompt: string;
  min: number;
  max: number;
  ends: [string, string];
  value: number | undefined;
  onValue: (v: number) => void;
  headingId?: string;
}) {
  const centred = min < 0;
  const options: number[] = [];
  for (let v = min; v <= max; v++) options.push(v);

  return (
    <fieldset>
      <legend id={headingId} className="font-display text-2xl font-bold leading-snug text-foreground md:text-3xl">
        {prompt}
      </legend>
      <div className="mt-6 grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((v, i) => {
          const end = i === 0 ? ends[0] : i === options.length - 1 ? ends[1] : "";
          return (
            <label
              key={v}
              className={`flex min-h-14 cursor-pointer items-center justify-center rounded-xl border text-lg font-bold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-deep has-[:focus-visible]:ring-offset-2 ${
                value === v
                  ? "border-teal-deep bg-teal-deep text-white"
                  : "border-border bg-card text-foreground hover:border-teal-deep"
              }`}
            >
              <input
                type="radio"
                name={`pulse-${name}`}
                value={v}
                checked={value === v}
                onChange={() => onValue(v)}
                className="sr-only"
                aria-label={end ? `${signed(v, centred)}, ${end}` : signed(v, centred)}
              />
              <span aria-hidden="true">{signed(v, centred)}</span>
            </label>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between gap-4 text-sm text-muted-foreground" aria-hidden="true">
        <span>{ends[0]}</span>
        <span className="text-right">{ends[1]}</span>
      </div>
    </fieldset>
  );
}
