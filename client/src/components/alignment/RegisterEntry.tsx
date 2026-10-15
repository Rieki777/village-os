/**
 * ONE ROW OF THE ALIGNED REGISTER (seat settings PR6).
 *
 * The kind and version, the title, where it stands, the day it came fully
 * aligned in the village's zone, each party by name and capacity, and how the
 * village aligned: the vote that adopted it, or the holder who aligned for it.
 * The words open on a tap. No hash is drawn here, even for a party: the
 * fingerprint lives in the receipt (spec 4.4).
 *
 * Fetches nothing, so the page's tests serve it rows and nothing else.
 */
import { useId } from "react";
import { Link } from "wouter";
import { CircleCheck, Circle } from "lucide-react";
import { ALIGNED_WORDS, type RegisterRow } from "@shared/alignedRegister";
import { civilDayWords } from "@shared/seasonPlans";
import { AlignedStamp, EndingLine, StateTag } from "./AlignmentMarks";

const linkClass =
  "inline-flex min-h-11 items-center px-1 text-sm font-medium text-notice underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring";

export default function RegisterEntry({ row, headingLevel = 3 }: { row: RegisterRow; headingLevel?: 3 | 4 }) {
  const id = useId();
  const H = headingLevel === 3 ? "h3" : "h4";
  const day = row.alignedOn ? ALIGNED_WORDS.alignedOn(civilDayWords(row.alignedOn)) : row.writtenOn ? ALIGNED_WORDS.writtenOn(civilDayWords(row.writtenOn)) : null;
  return (
    <article aria-labelledby={`${id}-t`} data-register-row={row.textId} className="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {row.kindLabel} <span aria-hidden="true">·</span> {ALIGNED_WORDS.version(row.version)}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <H id={`${id}-t`} className="min-w-0 basis-full font-display text-lg font-bold text-foreground sm:basis-auto sm:flex-1">
          {row.title}
        </H>
        <StateTag state={row.state} />
        {row.state === "in-force" && <AlignedStamp sealed={row.sealed} />}
      </div>
      {/* An ending says itself in its own line (PR8); any other reason keeps the quiet one. */}
      {row.why && row.state !== "in-force" && row.why !== row.endingLine && <p className="mt-1 text-sm text-muted-foreground">{row.why}</p>}
      {row.endingLine && (
        <div className="mt-2">
          <EndingLine line={row.endingLine} />
        </div>
      )}
      {day && <p className="mt-2 text-sm font-medium text-foreground">{day}</p>}

      <ul className="mt-3 space-y-1.5" aria-label={ALIGNED_WORDS.parties}>
        {row.parties.map((p) => (
          <li key={p.partyKey} className="flex items-start gap-2 text-sm text-foreground">
            {p.aligned ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-notice" aria-hidden="true" />
            ) : (
              <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span>
              <span className="font-semibold">{p.label}</span>, {p.capacity}:{" "}
              {p.aligned
                ? p.alignedOn
                  ? `${ALIGNED_WORDS.aligned} ${civilDayWords(p.alignedOn)}`
                  : ALIGNED_WORDS.aligned
                : p.required
                  ? ALIGNED_WORDS.waiting
                  : ALIGNED_WORDS.wrote}
            </span>
          </li>
        ))}
      </ul>

      {row.village?.by === "ballot" && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 text-sm text-foreground">
          {ALIGNED_WORDS.byBallot}.
          <Link href={row.village.href} className={linkClass}>
            {ALIGNED_WORDS.readVote}
          </Link>
        </p>
      )}
      {row.village?.by === "holder" && <p className="mt-3 text-sm text-foreground">{ALIGNED_WORDS.byHolder(row.village.name)}.</p>}
      {row.money && <p className="mt-2 text-sm text-muted-foreground">{ALIGNED_WORDS.money}</p>}

      <details className="mt-3 group">
        <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-lg px-1 text-sm font-semibold text-foreground underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring">
          {ALIGNED_WORDS.readWords}
        </summary>
        <pre
          data-alignment-words=""
          className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border/60 bg-background p-4 font-sans text-sm leading-relaxed text-foreground"
        >
          {row.body}
        </pre>
      </details>
      {row.href && (
        <Link href={row.href} className={linkClass}>
          {ALIGNED_WORDS.readApplication}
        </Link>
      )}
    </article>
  );
}
