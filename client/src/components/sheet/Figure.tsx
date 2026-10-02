/**
 * ONE FIGURE: a number and the words for what it counts.
 *
 * Extracted from the profile's StandingRow so the role card draws its figures
 * with the same part. The defaults ARE today's profile markup, class for class,
 * so StandingRow renders exactly what it rendered before the extraction;
 * `Figure.test.tsx` pins that markup.
 *
 *   layout="standing"  the profile's row: a block of two spans.
 *   layout="seat"      a `div > dt + dd` for a `<dl>`, the label first in
 *                      reading order and drawn under the number by
 *                      `flex-col-reverse`, so a screen reader hears what is
 *                      counted before the count.
 *
 *   face="display"     the profile's serif, the default.
 *   face="body"        the body face. The display serif draws 1 as I and 0 as
 *                      O, and most seats hold 0 or 1, so the role card's
 *                      commonest figure would read as a letter in it.
 *
 * Gold and living green mean "above zero". The caller decides the tone, and
 * a read 0 is plain.
 */
export type FigureTone = "gold" | "living" | null | undefined;

const ink = (tone: FigureTone): string =>
  tone === "gold" ? "text-notice" : tone === "living" ? "text-open" : "text-card-foreground";

export default function Figure({
  value,
  label,
  tone,
  face = "display",
  layout = "standing",
  title,
}: {
  value: string;
  label: string;
  tone?: FigureTone;
  face?: "display" | "body";
  layout?: "standing" | "seat";
  /** layout="seat" only: a hover line, as in the season clock's end date. */
  title?: string;
}) {
  const typeface = face === "display" ? "font-display" : "font-body";
  if (layout === "seat") {
    return (
      <div title={title} className="flex min-w-0 flex-col-reverse justify-end border-l border-border/45 px-2 first:border-l-0 first:pl-1">
        <dt className="mt-1.5 text-[11px] font-semibold uppercase leading-tight tracking-[0.1em] text-balance text-muted-foreground">
          {label}
        </dt>
        <dd className={`${typeface} text-[30px] font-semibold leading-none tabular-nums ${ink(tone)}`}>{value}</dd>
      </div>
    );
  }
  return (
    <div className="border-border pr-6 last:border-0 last:pr-0 sm:border-r sm:pr-8">
      <span className={`block ${typeface} text-3xl font-bold tabular-nums sm:text-4xl ${ink(tone)}`}>{value}</span>
      <span className="mt-1 block text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
