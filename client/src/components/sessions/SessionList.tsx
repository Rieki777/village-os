/**
 * The two lists on /sessions: the rooms open right now, and the closed records
 * this member can read. One row per session, read straight off the list door
 * (`SessionListRow`, shared/sessions.ts).
 *
 * Every row's title opens its room at /sessions/:id. An open room a member
 * has already joined offers "Enter the room", a real button that goes straight
 * in. One they have not joined offers "Join the room", which the page answers:
 * it asks the server first and only moves into the room once the join has
 * landed.
 *
 * EACH ROW IS A SEAT-CARD ROW. The page stays on the light linen, and each
 * session is its own panel: the circle as a small gold eyebrow, the title in
 * the display face, and a quiet line under it. An open room wears a living
 * green chip, "Happening now", which explains itself on a tap as well as on
 * hover (GlossChip): it opens one plain line saying when the room opened. The
 * list door carries a count of people and no names or faces, so the row says
 * the count in words and draws no faces it does not have.
 *
 * Words come from shared/sessions.ts (SESSION_COPY and SESSION_LIST_COPY), so
 * the voice gate reads them in one place. Colours are the semantic tokens, so
 * a village's own palette reaches every row.
 */
import { Link } from "wouter";
import { Users } from "lucide-react";
import { SESSION_COPY, SESSION_LIST_COPY, type SessionListRow } from "@shared/sessions";
import { Gloss, GlossChip, useGlossGroup } from "@/components/sheet/GlossChip";
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, GLYPH, GLYPH_ICON, GLYPH_STROKE, INPUT, LABEL, PANEL } from "./roomUi";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** The page's shared class strings, so the form and the rows are one size and one shape. */
export const LIST_UI = {
  card: PANEL,
  heading: "font-display text-2xl text-foreground",
  label: LABEL,
  hint: "text-sm text-muted-foreground",
  input: `mt-1 ${INPUT}`,
  primary: BTN_PRIMARY,
  secondary: BTN_SECONDARY,
} as const;

/** "9 October", in the reader's own locale and zone. */
function dayLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

/** "14:05", in the reader's own locale and zone. */
function timeLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** When the row opened or closed, in words. */
function whenLine(row: SessionListRow): string {
  const when = row.status === "closed" ? dayLabel(row.closedAt ?? row.createdAt) : timeLabel(row.createdAt);
  if (!when) return "";
  return row.status === "closed" ? SESSION_LIST_COPY.closedOn(when) : SESSION_LIST_COPY.openedAt(when);
}

/** The quiet line under a title: when (for a closed record), who holds the room, how many came. */
function metaLine(row: SessionListRow): string {
  const parts = [
    row.status === "closed" ? whenLine(row) : null,
    row.facilitatorName ? SESSION_LIST_COPY.facilitatedBy(row.facilitatorName) : null,
    SESSION_LIST_COPY.people(row.peopleCount),
  ];
  return parts.filter(Boolean).join(" · ");
}

export interface JoinState {
  /** The session a join is on its way for, if any. */
  joiningId: number | null;
  /** The last refused join and what the server said about it. */
  error: { id: number; text: string } | null;
}

function SessionRow({
  row,
  join,
  onJoin,
  gloss,
}: {
  row: SessionListRow;
  join: JoinState;
  onJoin: (id: number) => void;
  gloss: ReturnType<typeof useGlossGroup>;
}) {
  const busy = join.joiningId === row.id;
  const refused = join.error && join.error.id === row.id ? join.error.text : null;
  const glossKey = `open-${row.id}`;
  const glossId = `session-row-gloss-${row.id}`;
  const opened = row.status === "open" ? whenLine(row) : "";
  return (
    <li className={PANEL}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {row.circleName && <p className={EYEBROW}>{SESSION_LIST_COPY.circle(row.circleName)}</p>}
          <Link
            href={`/sessions/${row.id}`}
            className={`mt-1 inline-block font-display text-2xl leading-tight text-foreground underline-offset-4 hover:underline ${FOCUS}`}
          >
            {row.title}
          </Link>
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            <span aria-hidden="true" className={GLYPH}>
              <Users className={GLYPH_ICON} strokeWidth={GLYPH_STROKE} />
            </span>
            <span>{metaLine(row)}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {row.status === "open" && opened && (
            <GlossChip tone="open" open={gloss.isOpen(glossKey)} glossId={glossId} onToggle={() => gloss.toggle(glossKey)} onClose={gloss.close}>
              {SESSION_COPY.openNow}
            </GlossChip>
          )}
          {row.status === "open" &&
            (row.joined ? (
              <Link href={`/sessions/${row.id}`} className={`${LIST_UI.primary} no-underline`}>
                {SESSION_LIST_COPY.enterRoom}
              </Link>
            ) : (
              <button type="button" className={LIST_UI.secondary} onClick={() => onJoin(row.id)} disabled={join.joiningId != null}>
                {busy ? SESSION_LIST_COPY.joining : SESSION_COPY.joinButton}
              </button>
            ))}
        </div>
      </div>
      {row.status === "open" && opened && (
        <div className="mt-2">
          <Gloss id={glossId} open={gloss.isOpen(glossKey)}>
            {opened}
          </Gloss>
        </div>
      )}
      {refused && (
        <p role="alert" className="mt-2 text-sm font-medium text-destructive">
          {refused}
        </p>
      )}
    </li>
  );
}

/** The rooms open now. Empty is a sentence, never a blank box. */
export function OpenSessions({ rows, join, onJoin }: { rows: SessionListRow[]; join: JoinState; onJoin: (id: number) => void }) {
  const gloss = useGlossGroup();
  return (
    <section aria-labelledby="sessions-open-heading">
      <h2 id="sessions-open-heading" className={LIST_UI.heading}>
        {SESSION_COPY.openNow}
      </h2>
      {rows.length === 0 ? (
        <p className={`mt-3 ${LIST_UI.card} ${LIST_UI.hint}`}>{SESSION_COPY.nothingOpen}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => (
            <SessionRow key={row.id} row={row} join={join} onJoin={onJoin} gloss={gloss} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Closed sessions this member can read: the ones they were in, or every one for an admin. */
export function RecentSessions({ rows }: { rows: SessionListRow[] }) {
  const gloss = useGlossGroup();
  return (
    <section aria-labelledby="sessions-recent-heading">
      <h2 id="sessions-recent-heading" className={LIST_UI.heading}>
        {SESSION_COPY.recent}
      </h2>
      {rows.length === 0 ? (
        <p className={`mt-3 ${LIST_UI.card} ${LIST_UI.hint}`}>{SESSION_LIST_COPY.recentEmpty}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => (
            <SessionRow key={row.id} row={row} join={{ joiningId: null, error: null }} onJoin={() => undefined} gloss={gloss} />
          ))}
        </ul>
      )}
    </section>
  );
}
