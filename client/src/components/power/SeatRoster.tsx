/**
 * WHO HOLDS IT NOW: one spot per place.
 *
 * The view model (`rosterFor` in shared/roleSheet.ts) has already decided
 * every spot: the holders as served, a nameless "Seated" for each seating
 * this tier counts and does not name, the open places (three at most), and
 * the places still forming. This draws them and decides nothing, so the seat
 * card and the permission card show one roster the same way.
 *
 * THE DISC SAYS WHAT KIND OF SPOT IT IS, and the words beside it say it too:
 *
 *   a person         initials (or the face the payload sent) in a gold ring
 *   ready again      the same disc on a dashed gold edge, "ready to be re-chosen"
 *   an agent         a robot mark, NEVER a face (holderFace checks agents first)
 *   seated, no name  a plain figure; the tier counts the seating and withholds it
 *   open             a dashed living-green plus
 *   forming          a dotted hourglass, quiet: a forming place is not an open call
 *
 * A row is a button only where the host can act on it (the map's person
 * filter) and only for a named person, and only a button carries a chevron.
 * A static row looks static, so nothing promises a tap it does not answer.
 */
import { useId, type ReactNode } from "react";
import { Bot, ChevronRight, Hourglass, Plus, UserRound } from "lucide-react";
import { SHEET_WORDS, type Spot } from "@shared/roleSheet";
import { initialsFrom } from "./holderFace";

/**
 * A small section heading on a night card. The `!` is load-bearing: the
 * unlayered `.sheet-night :is(h1..h6)` rule in index.css sets weight 400 and
 * tracking .01em on every heading, and an unlayered rule beats a utility.
 */
export const SHEET_HEADING =
  "font-body text-[11px] !font-semibold uppercase !tracking-[0.2em] text-muted-foreground";

const DISC = "grid size-[38px] shrink-0 place-items-center rounded-full";
const READY_EDGE = "border-[1.5px] border-dashed border-notice";

function Disc({ spot }: { spot: Spot }) {
  switch (spot.kind) {
    case "person": {
      const edge = spot.ready ? READY_EDGE : "ring-[1.5px] ring-inset ring-notice";
      return (
        <span aria-hidden="true" className={`${DISC} bg-muted font-display text-[17px] text-foreground ${edge}`}>
          {spot.avatar ? (
            <img src={spot.avatar} alt="" className="size-full rounded-full object-cover object-top" />
          ) : (
            initialsFrom(spot.title)
          )}
        </span>
      );
    }
    case "agent":
    case "nameless": {
      const Icon = spot.kind === "agent" ? Bot : UserRound;
      const edge = spot.ready ? READY_EDGE : "ring-[1.5px] ring-inset ring-border";
      return (
        <span aria-hidden="true" className={`${DISC} bg-muted ${edge}`}>
          <Icon className="size-[18px] text-muted-foreground" />
        </span>
      );
    }
    case "open":
      return (
        <span aria-hidden="true" className={`${DISC} border-[1.5px] border-dashed border-open text-open`}>
          <Plus className="size-[18px]" />
        </span>
      );
    case "forming":
      return (
        <span aria-hidden="true" className={`${DISC} border-[1.5px] border-dotted border-border text-muted-foreground`}>
          <Hourglass className="size-4" />
        </span>
      );
  }
}

const ROW = "flex min-h-11 w-full items-center gap-2.5 rounded-xl py-0.5 pl-0.5 pr-1.5 text-left";

function SpotRow({
  spot,
  onPickPerson,
}: {
  spot: Spot;
  onPickPerson?: (holderKey: string, name: string | null) => void;
}) {
  const subId = useId();
  const sub = spot.sub ? (
    <span
      id={subId}
      className={`text-xs ${spot.ready ? "text-notice" : "text-muted-foreground"}${spot.subIsDate ? " whitespace-nowrap" : ""}`}
    >
      {spot.sub}
    </span>
  ) : null;
  const body = (
    <>
      <Disc spot={spot} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="break-words text-[13.5px] font-semibold text-foreground">{spot.title}</span>
        {sub}
      </span>
    </>
  );
  if (onPickPerson && spot.kind === "person" && spot.pickKey) {
    const key = spot.pickKey;
    return (
      <button
        type="button"
        onClick={() => onPickPerson(key, spot.title)}
        aria-label={`Show every role ${spot.title} holds`}
        aria-describedby={sub ? subId : undefined}
        className={`${ROW} hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring`}
      >
        {body}
        <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    );
  }
  return <div className={ROW}>{body}</div>;
}

export default function SeatRoster({
  spots,
  moreOpenLine,
  rosterNote,
  headerAside,
  belowHeader,
  onPickPerson,
}: {
  spots: Spot[];
  moreOpenLine: string | null;
  rosterNote: string | null;
  /** Beside the heading, as in the Recruiting chip. */
  headerAside?: ReactNode;
  /** Under the heading row, as in that chip's gloss. */
  belowHeader?: ReactNode;
  onPickPerson?: (holderKey: string, name: string | null) => void;
}) {
  const headingId = useId();
  if (!spots.length && !rosterNote) return null;
  return (
    <section aria-labelledby={headingId} className="px-1">
      <div className="flex items-center justify-between gap-2">
        <h4 id={headingId} className={SHEET_HEADING}>
          {SHEET_WORDS.rosterHeading}
        </h4>
        {headerAside}
      </div>
      {belowHeader}
      {spots.length > 0 && (
        <ul className="mt-2 grid gap-1">
          {spots.map((spot) => (
            <li key={spot.key}>
              <SpotRow spot={spot} onPickPerson={onPickPerson} />
            </li>
          ))}
        </ul>
      )}
      {moreOpenLine && <p className="px-1 text-xs text-muted-foreground">{moreOpenLine}</p>}
      {rosterNote && <p className="mt-1 px-1 text-xs text-muted-foreground">{rosterNote}</p>}
    </section>
  );
}
