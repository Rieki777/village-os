/**
 * THE BACK OF A SEAT CARD: what the seat has written down, and what it has not.
 *
 * The seven commitments in their fixed order, each with exactly one look
 * (written down, the village's way or set at seating, still to be written
 * down), the tally, ONE sentence naming what is still missing and who writes
 * it, then the sections that exist and the facts. A section with nothing in it
 * draws no heading: a heading over blank space reads as a broken card, and
 * the box above has already said, once, what is not written yet.
 *
 * Narrow, this is the face the card turns to, so it carries its own head (the
 * name, the badge and the way back) and its own footer (the badge again and a
 * shortcut to the front's action). Opened flat at 680px it is the right-hand
 * column, and those two drop away because the front column is beside it.
 */
import type { ReactNode, Ref } from "react";
import { Hand, Mail, PenLine, Undo2 } from "lucide-react";
import { COMMITMENT_LABELS, SHEET_WORDS, type SeatSheetView } from "@shared/roleSheet";
import LadderChip from "@/components/sheet/LadderChip";
import { Eyebrow, SeatFigures, StateBadge } from "./SeatCardFront";
import { SHEET_HEADING } from "./SeatRoster";

const BODY = "text-[13.5px] leading-relaxed text-foreground";

function Section({ heading, className = "", children }: { heading: string; className?: string; children: ReactNode }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <h4 className={SHEET_HEADING}>
        {heading}
      </h4>
      {children}
    </div>
  );
}

export default function SeatCharter({
  view,
  ids,
  embedded,
  stacked,
  shortcut,
  onBack,
  onShortcut,
  backRef,
}: {
  view: SeatSheetView;
  ids: { commitments: string };
  embedded: boolean;
  stacked: boolean;
  /** The back footer's shortcut to the front's action, when the host offers one. */
  shortcut: "raise" | "signIn" | "contact" | null;
  onBack: () => void;
  onShortcut: () => void;
  backRef: Ref<HTMLButtonElement>;
}) {
  const seats = view.figures.find((f) => f.key === "places")?.value ?? 0;
  const badge = !embedded && view.badge ? <StateBadge badge={view.badge} seats={seats} /> : null;
  const { sections } = view;
  const facts = [view.facts.term, view.facts.nextHolder, view.facts.wayOfDeciding].filter(
    (f): f is NonNullable<typeof f> => f !== null,
  );
  const ShortcutIcon = shortcut === "contact" ? Mail : Hand;

  return (
    <>
      {!stacked && (
        <div className="flex items-start justify-between gap-2.5 border-b border-border/50 pb-2.5 @min-[680px]:hidden">
          <div className="flex min-w-0 flex-col gap-1">
            {!embedded && view.eyebrow && <Eyebrow text={view.eyebrow} colour={view.circleColour} />}
            <p className="break-words font-display text-[23px] leading-tight text-foreground">{view.name}</p>
            {badge && <div className="mt-0.5">{badge}</div>}
          </div>
          <button
            ref={backRef}
            type="button"
            onClick={onBack}
            aria-label={SHEET_WORDS.backButton}
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-border focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Undo2 className="size-[18px] text-notice" aria-hidden="true" />
          </button>
        </div>
      )}

      <SeatFigures view={view} wide />

      {view.commitments.length > 0 && (
        <section aria-labelledby={ids.commitments}>
          <div className="flex items-baseline justify-between gap-2">
            <h4 id={ids.commitments} className={SHEET_HEADING}>
              {SHEET_WORDS.commitmentsHeading}
            </h4>
            <p className="whitespace-nowrap text-xs text-muted-foreground">
              <span className="font-body text-base font-semibold text-notice">{view.tally.written}</span> of {view.tally.of} written down
            </p>
          </div>
          <ol className="mt-2 flex flex-wrap gap-1.5">
            {view.commitments.map((c) => (
              <li key={c.key}>
                <LadderChip look={c.look} label={c.label} suffix={c.suffix} srWords={c.srWords} />
              </li>
            ))}
          </ol>
        </section>
      )}

      {view.stillToWrite && (
        <div className="flex gap-2 rounded-xl border border-dashed border-border bg-background/40 px-3 py-2.5 text-[13px] leading-snug text-foreground">
          <PenLine className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p>{view.stillToWrite}</p>
        </div>
      )}
      {view.unreadLine && <p className="text-xs text-muted-foreground">{view.unreadLine}</p>}

      {/* The front already says the aim; this copy is for the narrow back
          face only, and a stacked proposal shows both columns at once. */}
      {!stacked && sections.aim && (
        <Section heading={COMMITMENT_LABELS.aim} className="@min-[680px]:hidden">
          <p className={BODY}>{sections.aim}</p>
        </Section>
      )}
      {sections.domain && (
        <Section heading={COMMITMENT_LABELS.domain}>
          <p className={BODY}>{sections.domain}</p>
        </Section>
      )}
      {sections.accountabilities.length > 0 && (
        <Section heading={COMMITMENT_LABELS.accountabilities}>
          <ol className="grid gap-2 @min-[760px]:grid-cols-2">
            {sections.accountabilities.map((a, i) => (
              <li
                key={`${i}-${a}`}
                className="flex items-start gap-2.5 rounded-xl border border-border bg-muted px-3 py-2.5 text-[13px] leading-snug text-foreground"
              >
                <span
                  aria-hidden="true"
                  className="grid size-[22px] shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums text-notice ring-1 ring-inset ring-notice/60"
                >
                  {i + 1}
                </span>
                <span className="min-w-0">{a}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}
      {sections.why && (
        <Section heading={COMMITMENT_LABELS.why}>
          <blockquote className="border-l-2 border-notice pl-3 font-display text-[16.5px] leading-snug text-foreground">
            {sections.why}
          </blockquote>
        </Section>
      )}

      {facts.length > 0 && (
        <dl className="grid gap-3.5 @min-[680px]:grid-cols-2">
          {facts.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{f.label}</dt>
              <dd
                className={
                  f.isDate
                    ? "mt-1 font-body text-base font-semibold text-foreground"
                    : "mt-1 break-words font-display text-[19px] leading-snug text-foreground"
                }
              >
                {f.value}
              </dd>
              {f.sub && <dd className="mt-0.5 text-[12.5px] text-muted-foreground">{f.sub}</dd>}
            </div>
          ))}
        </dl>
      )}

      {!stacked && (badge || (shortcut && view.action.label)) && (
        <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-3 @min-[680px]:hidden">
          {badge ?? <span />}
          {shortcut && view.action.label && (
            <button
              type="button"
              onClick={onShortcut}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-[13px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              <ShortcutIcon className="size-4 shrink-0 text-notice" aria-hidden="true" />
              {view.action.label}
            </button>
          )}
        </div>
      )}
    </>
  );
}
