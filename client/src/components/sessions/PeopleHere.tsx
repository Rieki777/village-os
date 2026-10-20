/**
 * Who is here: everyone who joined the room, the people here now first, with
 * the facilitator and the note taker named. Somebody whose page has not said
 * it is here within the presence window reads as away, quietly.
 *
 * Two readings of the same list.
 *
 *   compact  the header's strip: an overlapping row of faces (PersonDisc)
 *            under a gold "Holding" eyebrow, and the count beside it as a
 *            figure. The header names the facilitator in words just above,
 *            so the strip marks them with the star and says it once. A face
 *            shows its name on hover through `title`, and the list carries
 *            every name, here or away and any role, for a screen reader, so
 *            nothing is said by the faces alone.
 *   full     Drop in's own list: each face with its name, its role in words,
 *            and "away" for somebody who has stepped out. The role is said
 *            by the disc's mark to a screen reader, so the visible word is
 *            not read twice.
 */
import { ROOM_COPY, type SessionPerson, type SessionView } from "@shared/sessions";
import Figure from "@/components/sheet/Figure";
import PersonDisc, { type PersonDiscMark } from "./PersonDisc";
import { EYEBROW, HINT } from "./roomUi";

function markOf(view: SessionView, p: SessionPerson): PersonDiscMark {
  if (p.userId === view.facilitatorUserId) return "facilitator";
  if (p.userId === view.secretaryUserId) return "notes";
  return null;
}

function roleOf(view: SessionView, p: SessionPerson): string | null {
  if (p.userId === view.facilitatorUserId) return ROOM_COPY.facilitating;
  if (p.userId === view.secretaryUserId) return ROOM_COPY.takingNotes;
  return null;
}

export default function PeopleHere({ view, compact = false }: { view: SessionView; compact?: boolean }) {
  const people = [...view.people].sort((a, b) => Number(b.present) - Number(a.present) || a.name.localeCompare(b.name));
  if (!people.length) return <p className={HINT}>{ROOM_COPY.nobodyHere}</p>;
  const here = people.filter((p) => p.present).length;

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <p className={EYEBROW}>{ROOM_COPY.holding}</p>
        <ul className="flex -space-x-2" aria-label={ROOM_COPY.whoIsHere}>
          {people.map((p) => (
            <li key={p.userId} title={p.name} className={`relative rounded-full ring-2 ring-background ${markOf(view, p) ? "z-[1]" : ""}`}>
              <span className="sr-only">{p.name}</span>
              <PersonDisc person={p} mark={markOf(view, p)} />
              {!p.present && <span className="sr-only">{ROOM_COPY.away}</span>}
            </li>
          ))}
        </ul>
        <dl className="flex">
          <Figure layout="seat" face="body" tone={here > 0 ? "gold" : null} value={String(here)} label={ROOM_COPY.here} />
        </dl>
      </div>
    );
  }

  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-3" aria-label={ROOM_COPY.whoIsHere}>
      {people.map((p) => {
        const role = roleOf(view, p);
        return (
          <li key={p.userId} className={`inline-flex items-center gap-2.5 ${p.present ? "text-foreground" : "text-muted-foreground"}`}>
            <PersonDisc person={p} mark={markOf(view, p)} />
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-medium">{p.name}</span>
              {role && (
                <span aria-hidden="true" className="text-xs text-muted-foreground">
                  {role}
                </span>
              )}
              {!p.present && <span className="text-xs text-muted-foreground">{ROOM_COPY.away}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
