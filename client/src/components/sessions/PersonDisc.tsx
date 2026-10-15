/**
 * ONE PERSON IN THE ROOM, as a disc or as a small portrait.
 *
 * The face is the member's fronted character, the stock art the village's
 * character sheet already shows (`SessionPerson.avatar`, which the server
 * fills from the character catalogue and never from an uploaded portrait).
 * Somebody without one gets their initials, read off the name the room already
 * prints, so the disc never shows more of a person than the page does.
 *
 *   size="disc"      38px round, for the people strip and the gratitude rows.
 *   size="portrait"  a 3:4 tile, the party rail on the arrival grid.
 *
 * HERE OR AWAY. Here wears a thin gold ring; away wears a dashed edge and
 * fades. The fade is never the only signal: the people strip says "away" in
 * words for a screen reader, and the face itself is decoration, so the image
 * carries an empty alt and the name is said wherever the disc is used.
 *
 * THE MARK. The facilitator wears a star and the note taker a pen, as a small
 * gold badge on the edge of the disc, each with its word for a screen reader.
 */
import { PenLine, Star } from "lucide-react";
import { ROOM_COPY, type SessionPerson } from "@shared/sessions";
import { initialsFrom } from "@/components/power/holderFace";

export type PersonDiscMark = "facilitator" | "notes" | null;

export default function PersonDisc({
  person,
  size = "disc",
  mark = null,
}: {
  person: Pick<SessionPerson, "name" | "present"> & { avatar?: string | null };
  size?: "disc" | "portrait";
  mark?: PersonDiscMark;
}) {
  const shape =
    size === "portrait"
      ? "w-20 aspect-[3/4] rounded-xl border border-border bg-card text-base"
      : "size-[38px] rounded-full bg-muted text-xs";
  // Here or away: a gold ring for here, a dashed edge and a fade for away.
  const presence = person.present ? "ring-[1.5px] ring-inset ring-notice" : "border border-dashed border-border opacity-60";
  const Mark = mark === "facilitator" ? Star : mark === "notes" ? PenLine : null;
  const markWord = mark === "facilitator" ? ROOM_COPY.facilitating : mark === "notes" ? ROOM_COPY.noteTaking : "";

  return (
    <span className="relative inline-block shrink-0" data-person-disc={size} data-present={person.present ? "true" : "false"}>
      <span className={`grid place-items-center overflow-hidden font-semibold text-foreground ${shape} ${presence}`}>
        {person.avatar ? (
          <img src={person.avatar} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
        ) : (
          <span aria-hidden="true">{initialsFrom(person.name)}</span>
        )}
      </span>
      {Mark && (
        <span className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-notice text-background ring-2 ring-background">
          <Mark className="size-2.5" strokeWidth={2} aria-hidden="true" />
          <span className="sr-only">{markWord}</span>
        </span>
      )}
    </span>
  );
}
