/**
 * THE START CARD'S CHECKLIST: what members brought that this session can take
 * up. The circle chosen above it decides what is offered (`offeredFor`): that
 * circle's waiting items, then the ones for no circle in particular, each
 * oldest first. A session for no circle is offered only those for no circle.
 *
 * The page keeps the ticks (`picked`) and drops any that no longer fit, when
 * the circle changes and whenever the list is read again, so a tick is never
 * kept out of sight. The agenda takes the ticked items in the order shown here,
 * and the room reorders them as it likes. Under the list, the minutes they
 * would plan against the session's length, the line the agenda stage shows.
 *
 * Each row is one label, at least 44px tall, so the whole row is the tap
 * target. The list scrolls inside a capped box, so a long one never pushes
 * "Open the room" off the screen of a sticky card.
 *
 * Nothing is offered: the checklist draws nothing.
 */
import { AIM_DEFS, ROOM_COPY } from "@shared/sessions";
import { LIBRARY_COPY, LIBRARY_MINUTES, agendaAimFor, broughtFor, offeredFor, type LibraryCard } from "@shared/sessionLibrary";
import { CHIP, HINT, LABEL } from "./roomUi";

/** "14 October", in the reader's own locale. */
function shortDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

/** The minutes the ticked items would plan, by their aims. */
export function plannedMinutes(items: readonly LibraryCard[], picked: readonly number[]): number {
  return items.filter((i) => picked.includes(i.id)).reduce((sum, i) => sum + LIBRARY_MINUTES[agendaAimFor(i.aim)], 0);
}

export default function StartChecklist({
  items,
  circleId,
  circleName,
  picked,
  onPicked,
  durationMin,
}: {
  items: readonly LibraryCard[];
  circleId: string | null;
  circleName: string | null;
  picked: readonly number[];
  onPicked(next: number[]): void;
  durationMin: number | null;
}) {
  const offered = offeredFor(items, circleId);
  if (!offered.length) return null;
  const planned = plannedMinutes(offered, picked);
  const toggle = (id: number) => {
    // The order shown is the agenda's order, whatever order the ticks came in.
    const next = picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id];
    onPicked(offered.map((o) => o.id).filter((o) => next.includes(o)));
  };
  return (
    <fieldset className="space-y-2">
      <legend className={LABEL}>{broughtFor(circleName)}</legend>
      <p className={HINT}>{LIBRARY_COPY.startHint}</p>
      <ul className="max-h-[min(16rem,30vh)] space-y-1.5 overflow-y-auto pr-1">
        {offered.map((c) => {
          const aim = agendaAimFor(c.aim);
          return (
            <li key={c.id}>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border bg-muted px-3 py-2.5 text-sm has-[:checked]:border-notice">
                <input
                  type="checkbox"
                  className="mt-0.5 size-5 shrink-0 accent-notice"
                  checked={picked.includes(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-foreground">{c.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span className={CHIP}>
                      {c.aim ? AIM_DEFS[aim].label : LIBRARY_COPY.aimNotSure} · {LIBRARY_MINUTES[aim]} {ROOM_COPY.minutesShort}
                    </span>
                    {circleId != null && c.circleId == null && <span className={CHIP}>{LIBRARY_COPY.roomNoCircle}</span>}
                    <span>{c.mine ? LIBRARY_COPY.broughtByYou(shortDay(c.broughtAt)) : LIBRARY_COPY.broughtBy(c.broughtBy, shortDay(c.broughtAt))}</span>
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {picked.length > 0 && durationMin != null && (
        <p className={`text-sm tabular-nums ${planned > durationMin ? "font-semibold text-notice" : "text-muted-foreground"}`}>
          {ROOM_COPY.agendaFitLine(planned, Math.max(0, durationMin - planned))}
        </p>
      )}
    </fieldset>
  );
}
