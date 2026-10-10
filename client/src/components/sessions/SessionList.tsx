/**
 * The two lists on /sessions: the rooms open right now, and the closed records
 * this member can read. One row per session, read straight off the list door
 * (`SessionListRow`, shared/sessions.ts).
 *
 * Every row's title opens its room at /sessions/:id. An open room a member
 * has not joined also offers "Join the room", which the page answers: it asks
 * the server first and only moves into the room once the join has landed.
 *
 * Words come from shared/sessions.ts (SESSION_COPY and SESSION_LIST_COPY), so
 * the voice gate reads them in one place. Colours are the semantic tokens, so
 * a village's own palette reaches every row.
 */
import { Link } from "wouter";
import { SESSION_COPY, SESSION_LIST_COPY, type SessionListRow } from "@shared/sessions";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2";

/** The page's shared class strings, so the form and the rows are one size and one shape. */
export const LIST_UI = {
  card: "rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm",
  heading: "font-display text-xl font-semibold text-foreground",
  label: "block text-sm font-semibold text-foreground",
  hint: "text-sm text-muted-foreground",
  input:
    "mt-1 w-full min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring",
  primary: `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-teal-deep px-5 py-2.5 font-semibold text-white hover:bg-teal-deep-dark disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`,
  secondary: `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-teal-deep bg-card px-4 py-2 font-semibold text-teal-deep hover:bg-teal-deep/5 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`,
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

/** The quiet line under a title: when, which circle, who holds the room, how many came. */
function metaLine(row: SessionListRow): string {
  const when = row.status === "closed" ? dayLabel(row.closedAt ?? row.createdAt) : timeLabel(row.createdAt);
  const parts = [
    when ? (row.status === "closed" ? SESSION_LIST_COPY.closedOn(when) : SESSION_LIST_COPY.openedAt(when)) : null,
    row.circleName ? SESSION_LIST_COPY.circle(row.circleName) : null,
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
}: {
  row: SessionListRow;
  join: JoinState;
  onJoin: (id: number) => void;
}) {
  const busy = join.joiningId === row.id;
  const refused = join.error && join.error.id === row.id ? join.error.text : null;
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/sessions/${row.id}`}
            className={`text-base font-semibold text-foreground underline-offset-2 hover:underline ${FOCUS}`}
          >
            {row.title}
          </Link>
          <p className="mt-1 text-sm text-muted-foreground">{metaLine(row)}</p>
        </div>
        {row.status === "open" &&
          (row.joined ? (
            <span className="inline-flex min-h-8 items-center rounded-full bg-teal-deep/10 px-3 text-sm font-semibold text-teal-deep">
              {SESSION_COPY.joinedLabel}
            </span>
          ) : (
            <button
              type="button"
              className={LIST_UI.secondary}
              onClick={() => onJoin(row.id)}
              disabled={join.joiningId != null}
            >
              {busy ? SESSION_LIST_COPY.joining : SESSION_COPY.joinButton}
            </button>
          ))}
      </div>
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
  return (
    <section aria-labelledby="sessions-open-heading" className={LIST_UI.card}>
      <h2 id="sessions-open-heading" className={LIST_UI.heading}>
        {SESSION_COPY.openNow}
      </h2>
      {rows.length === 0 ? (
        <p className={`mt-3 ${LIST_UI.hint}`}>{SESSION_COPY.nothingOpen}</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {rows.map((row) => (
            <SessionRow key={row.id} row={row} join={join} onJoin={onJoin} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Closed sessions this member can read: the ones they were in, or every one for an admin. */
export function RecentSessions({ rows }: { rows: SessionListRow[] }) {
  return (
    <section aria-labelledby="sessions-recent-heading" className={LIST_UI.card}>
      <h2 id="sessions-recent-heading" className={LIST_UI.heading}>
        {SESSION_COPY.recent}
      </h2>
      {rows.length === 0 ? (
        <p className={`mt-3 ${LIST_UI.hint}`}>{SESSION_LIST_COPY.recentEmpty}</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {rows.map((row) => (
            <SessionRow key={row.id} row={row} join={{ joiningId: null, error: null }} onJoin={() => undefined} />
          ))}
        </ul>
      )}
    </section>
  );
}
