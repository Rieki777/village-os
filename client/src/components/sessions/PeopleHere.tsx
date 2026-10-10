/**
 * Who is here: everyone who joined the room, the people here now first, with
 * the facilitator and the note taker named. Somebody whose page has not said
 * it is here within the presence window reads as away, quietly.
 */
import { ROOM_COPY, type SessionView } from "@shared/sessions";
import { HINT } from "./roomUi";

export default function PeopleHere({ view, compact = false }: { view: SessionView; compact?: boolean }) {
  const people = [...view.people].sort((a, b) => Number(b.present) - Number(a.present) || a.name.localeCompare(b.name));
  if (!people.length) return <p className={HINT}>{ROOM_COPY.nobodyHere}</p>;
  return (
    <ul className={`flex flex-wrap ${compact ? "gap-1.5" : "gap-2"}`} aria-label={ROOM_COPY.whoIsHere}>
      {people.map((p) => {
        const role =
          p.userId === view.facilitatorUserId ? ROOM_COPY.facilitating : p.userId === view.secretaryUserId ? ROOM_COPY.takingNotes : null;
        return (
          <li
            key={p.userId}
            className={`inline-flex items-center gap-2 rounded-full border px-3 ${compact ? "py-1 text-xs" : "py-1.5 text-sm"} ${
              p.present ? "border-border bg-card text-foreground" : "border-dashed border-border bg-transparent text-muted-foreground"
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${p.present ? "bg-open" : "bg-muted-foreground/40"}`}
            />
            <span className="font-medium">{p.name}</span>
            {role && <span className="text-muted-foreground">· {role}</span>}
            {!p.present && <span className="sr-only">{ROOM_COPY.away}</span>}
          </li>
        );
      })}
    </ul>
  );
}
