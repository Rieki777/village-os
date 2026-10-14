/**
 * THE ALIGNED STAMP AND THE PARTY CHIPS (seat settings PR5, spec section 4.1).
 *
 * Once a text is in force, an "Aligned" seal sits beside one chip per party:
 * "Rye, aligned", "The village, aligned". While it is pending the chips fill
 * as the parties align. Drawn in the drawer's tray and on the profile, in the
 * night look's semantic colours only.
 *
 * Fetches nothing and imports nothing from `@/lib/gameApi`, like the drawer it
 * sits in: the drawer's tests mock that module down.
 */
import { BadgeCheck, Circle, CircleCheck, Hourglass } from "lucide-react";
import { ALIGN_WORDS, STATE_WORDS, type AlignmentState } from "@shared/alignments";

export interface ChipParty {
  partyKey: string;
  label: string;
  aligned: boolean;
}

export function AlignedStamp({ sealed }: { sealed: boolean }) {
  return (
    <span
      data-aligned-stamp=""
      className="inline-flex -rotate-3 items-center gap-1.5 rounded-md border-2 border-notice px-2.5 py-1 text-xs font-bold uppercase tracking-[0.2em] text-notice"
    >
      <BadgeCheck className="size-4" aria-hidden="true" />
      {ALIGN_WORDS.aligned}
      {!sealed && <span className="ml-1 text-[10px] font-semibold normal-case tracking-normal text-muted-foreground">{ALIGN_WORDS.unsealed}</span>}
    </span>
  );
}

export function PartyChips({ parties }: { parties: readonly ChipParty[] }) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Parties">
      {parties.map((p) => (
        <li
          key={p.partyKey}
          data-party-chip={p.aligned ? "aligned" : "waiting"}
          className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium ${
            p.aligned ? "border-notice/60 text-foreground" : "border-border text-muted-foreground"
          }`}
        >
          {p.aligned ? <CircleCheck className="size-3.5 text-notice" aria-hidden="true" /> : <Circle className="size-3.5" aria-hidden="true" />}
          {p.aligned ? ALIGN_WORDS.partyAligned(p.label) : ALIGN_WORDS.partyWaiting(p.label)}
        </li>
      ))}
    </ul>
  );
}

/** A small word for where a text stands. */
export function StateTag({ state }: { state: AlignmentState }) {
  return (
    <span
      data-state={state}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
        state === "in-force" ? "border-notice/60 text-notice" : "border-border text-muted-foreground"
      }`}
    >
      {STATE_WORDS[state]}
    </span>
  );
}

/**
 * How the terms are ending or ended (PR8), in the one line the server wrote:
 * "Notice given, ends 9 Nov 2026", "Ended by agreement on 2 Dec 2026",
 * "Superseded by version 2". Nothing when nothing is ending them.
 */
export function EndingLine({ line }: { line: string | null | undefined }) {
  if (!line) return null;
  return (
    <p data-ending-line="" className="flex items-start gap-1.5 text-sm font-medium text-foreground">
      <Hourglass className="mt-0.5 size-4 shrink-0 text-notice" aria-hidden="true" />
      <span>{line}</span>
    </p>
  );
}

/** The tray's alignment block: the stamp once in force, the chips, and how the terms are ending. */
export default function AlignmentMarks({
  state,
  sealed,
  parties,
  endingLine = null,
}: {
  state: AlignmentState;
  sealed: boolean;
  parties: readonly ChipParty[];
  endingLine?: string | null;
}) {
  return (
    <div data-alignment-marks="" className="flex flex-wrap items-center gap-3 border-t border-border/50 pt-2">
      {state === "in-force" && <AlignedStamp sealed={sealed} />}
      <PartyChips parties={parties} />
      {endingLine && (
        <div className="basis-full">
          <EndingLine line={endingLine} />
        </div>
      )}
    </div>
  );
}
