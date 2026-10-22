/**
 * COMING UP, on /sessions: each circle's next meeting, from its rhythm
 * (shared/sessionRhythm.ts). The member's own circles come first, then the
 * rest by when they meet.
 *
 * Each row says when in the village's own words ("Tomorrow at 18:00"), how the
 * circle meets ("Every Thursday at 18:00"), and how many agenda items wait for
 * it. While the circle's room is open the row offers the room; otherwise
 * "Get the room ready" fills the start card for that meeting (its title, its
 * circle, its length, and the circle's waiting items ticked), and a person
 * opens it. Nothing opens a room by itself.
 *
 * The circle's members and admins set, change, skip or stop its rhythm, from
 * the row (`canKeep`) or from "Set a meeting rhythm". Every write reads
 * `res.ok` before it says anything, and then the page reads the list again.
 *
 * A notice about a meeting links to `/sessions#coming-<circle>`, and the row
 * with that anchor is scrolled to once the list holds it.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { SESSION_LIST_COPY } from "@shared/sessions";
import { circleWords } from "@shared/sessionTasks";
import {
  RHYTHM_COPY,
  comingAnchor,
  rhythmSkipUrl,
  rhythmUrl,
  type ComingUpPayload,
  type ComingUpRow,
  type RhythmInput,
} from "@shared/sessionRhythm";
import { gameFetch } from "@/lib/gameApi";
import RhythmForm from "./RhythmForm";
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, EYEBROW, HINT, LABEL_CAPS, PANEL } from "./roomUi";

/** One write; null on the server's yes, or the sentence to show. */
async function send(path: string, method: string, body: unknown): Promise<string | null> {
  try {
    const res = await gameFetch(path, { method, body: JSON.stringify(body) });
    if (res.ok) return null;
    const out = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const text = typeof out?.error === "string" ? out.error.trim() : "";
    return /\s/.test(text) ? text : RHYTHM_COPY.failed;
  } catch {
    return RHYTHM_COPY.failed;
  }
}

function Row({
  row,
  zone,
  defaultMinutes,
  onGetReady,
  onChanged,
}: {
  row: ComingUpRow;
  zone: string;
  defaultMinutes: number | null;
  onGetReady: (row: ComingUpRow) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const write = async (path: string, body: unknown) => {
    setBusy(true);
    setError(null);
    const said = await send(path, path.endsWith("/skip") ? "POST" : "PUT", body);
    if (said) {
      setBusy(false);
      setError(said);
      return;
    }
    await onChanged();
    setBusy(false);
    setEditing(false);
  };

  return (
    <li id={comingAnchor(row.circleId)} tabIndex={-1} className="scroll-mt-24 rounded-xl border border-border bg-card px-4 py-3 outline-none">
      {editing ? (
        <RhythmForm
          idBase={`rhythm-${row.circleId}`}
          circles={[{ id: row.circleId, name: row.circleName }]}
          fixedCircleId={row.circleId}
          initial={row.rhythm}
          defaultMinutes={defaultMinutes}
          zone={zone}
          busy={busy}
          error={error}
          onSubmit={(circleId, input) => void write(rhythmUrl(circleId), input)}
          onCancel={() => {
            setEditing(false);
            setError(null);
          }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className={EYEBROW}>{circleWords(row.circleName)}</p>
              <p className="mt-1 font-display text-xl leading-tight text-foreground">{row.words}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {row.rhythmWords} · {RHYTHM_COPY.waiting(row.waiting)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {row.openRoom ? (
                <Link href={`/sessions/${row.openRoom.id}`} className={`${BTN_PRIMARY} no-underline`}>
                  {RHYTHM_COPY.openNow}: {SESSION_LIST_COPY.enterRoom}
                </Link>
              ) : (
                <button type="button" className={BTN_SECONDARY} onClick={() => onGetReady(row)}>
                  {RHYTHM_COPY.getReady}
                </button>
              )}
            </div>
          </div>
          {row.canKeep && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => setEditing(true)}>
                {RHYTHM_COPY.change}
              </button>
              <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => void write(rhythmSkipUrl(row.circleId), { key: row.next.key })}>
                {RHYTHM_COPY.skip}
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-2 text-sm font-medium text-destructive">
              {error}
            </p>
          )}
        </>
      )}
    </li>
  );
}

export default function ComingUp({
  comingUp,
  circles,
  defaultMinutes,
  onGetReady,
  onChanged,
}: {
  comingUp: ComingUpPayload;
  circles: { id: string; name: string }[];
  defaultMinutes: number | null;
  onGetReady: (row: ComingUpRow) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [setting, setSetting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const landed = useRef<string | null>(null);

  // A notice's link lands on its row once the list holds it.
  useEffect(() => {
    const hash = typeof window === "undefined" ? "" : window.location.hash;
    const m = /^#coming-(.+)$/.exec(hash);
    if (!m || landed.current === hash || !comingUp.rows.some((r) => r.circleId === decodeURIComponent(m[1]))) return;
    landed.current = hash;
    const el = document.getElementById(comingAnchor(decodeURIComponent(m[1])));
    el?.scrollIntoView?.({ block: "center" });
    el?.focus({ preventScroll: true });
  }, [comingUp.rows]);

  const keepable = circles.filter((c) => comingUp.keepCircleIds.includes(c.id));
  if (!comingUp.rows.length && !keepable.length) return null;

  const add = async (circleId: string, input: RhythmInput) => {
    setBusy(true);
    setError(null);
    const said = await send(rhythmUrl(circleId), "PUT", input);
    if (said) {
      setBusy(false);
      setError(said);
      return;
    }
    await onChanged();
    setBusy(false);
    setSetting(false);
  };

  return (
    <section aria-labelledby="sessions-coming-heading">
      <h2 id="sessions-coming-heading" className="font-display text-2xl text-foreground">
        {RHYTHM_COPY.sectionTitle}
      </h2>
      {comingUp.rows.length === 0 ? (
        <p className={`mt-3 ${PANEL} ${HINT}`}>{RHYTHM_COPY.empty}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {comingUp.rows.map((row) => (
            <Row key={row.circleId} row={row} zone={comingUp.zone} defaultMinutes={defaultMinutes} onGetReady={onGetReady} onChanged={onChanged} />
          ))}
        </ul>
      )}
      {keepable.length > 0 && (
        <div className={`mt-3 ${PANEL}`}>
          {setting ? (
            <>
              <h3 className={`${LABEL_CAPS} mb-3`}>{RHYTHM_COPY.formTitle}</h3>
              <RhythmForm
                idBase="rhythm-new"
                circles={keepable}
                defaultMinutes={defaultMinutes}
                zone={comingUp.zone}
                busy={busy}
                error={error}
                onSubmit={(circleId, input) => void add(circleId, input)}
                onCancel={() => {
                  setSetting(false);
                  setError(null);
                }}
              />
            </>
          ) : (
            <button type="button" className={BTN_SECONDARY} onClick={() => setSetting(true)}>
              {RHYTHM_COPY.setRhythm}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
