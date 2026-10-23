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
 * The circle's members and admins change, skip or stop its rhythm from the
 * row (`canKeep`), and set one for a circle that has none from "Set a meeting
 * rhythm". Every write reads `res.ok` before it says anything, and then the
 * page reads the list again, a refusal included, so a row that moved is never
 * tried twice. What landed is read out in one polite line. The focus returns
 * to the control that opened a form, and to the section's heading when a row
 * leaves. Each control is described by its row's circle and meeting, so a list
 * of buttons tells one row from the next.
 *
 * A notice about a meeting links to `/sessions#coming-<circle>`. The row with
 * that anchor is lit, scrolled to and focused once the list holds it, on the
 * first visit and when the link is followed from the page itself.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { SESSION_LIST_COPY } from "@shared/sessions";
import { circleWords } from "@shared/sessionTasks";
import {
  RHYTHM_COPY,
  comingAnchor,
  phraseOf,
  rhythmSkipUrl,
  rhythmUrl,
  type ComingUpPayload,
  type ComingUpRow,
  type RhythmInput,
} from "@shared/sessionRhythm";
import { gameFetch } from "@/lib/gameApi";
import RhythmForm from "./RhythmForm";
import { useHash } from "./useHash";
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, EYEBROW, HINT, LABEL_CAPS, PANEL } from "./roomUi";

type Sent = { ok: true; row: ComingUpRow | null } | { ok: false; error: string };

/** One write: the row the server now holds, or the sentence to show. */
async function send(path: string, method: string, body: unknown): Promise<Sent> {
  try {
    const res = await gameFetch(path, { method, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => null)) as { error?: unknown; row?: ComingUpRow | null } | null;
    if (res.ok) return { ok: true, row: out?.row ?? null };
    const text = typeof out?.error === "string" ? out.error.trim() : "";
    return { ok: false, error: /\s/.test(text) ? text : RHYTHM_COPY.failed };
  } catch {
    return { ok: false, error: RHYTHM_COPY.failed };
  }
}

/** Is the person typing somewhere? A landing never takes the focus from a field. */
const typing = () => {
  const el = typeof document === "undefined" ? null : document.activeElement;
  return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
};

function Row({
  row,
  zone,
  defaultMinutes,
  lit,
  onGetReady,
  onChanged,
  onSaid,
  onGone,
}: {
  row: ComingUpRow;
  zone: string;
  defaultMinutes: number | null;
  lit: boolean;
  onGetReady: (row: ComingUpRow) => void;
  onChanged: () => Promise<void> | void;
  onSaid: (text: string) => void;
  onGone: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const skipButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef<"change" | "skip" | null>(null);
  const anchor = comingAnchor(row.circleId);
  const describedBy = `${anchor}-circle ${anchor}-when`;

  // Back from the form or a skip, the focus returns to the control that was used.
  useEffect(() => {
    if (editing || busy || !refocus.current) return;
    (refocus.current === "skip" ? skipButton : changeButton).current?.focus();
    refocus.current = null;
  }, [editing, busy]);

  const write = async (path: string, method: string, body: unknown, after: (row: ComingUpRow | null) => string) => {
    setBusy(true);
    setError(null);
    const out = await send(path, method, body);
    if (!out.ok) setError(out.error);
    // The list is read again either way: a refusal often means the row moved.
    await onChanged();
    setBusy(false);
    if (!out.ok) return;
    setEditing(false);
    onSaid(after(out.row));
    if (!out.row) onGone();
  };

  const save = (circleId: string, input: RhythmInput) => {
    refocus.current = "change";
    void write(rhythmUrl(circleId), "PUT", input, (next) => (input.kind === "none" || !next ? RHYTHM_COPY.stopped(row.circleName) : RHYTHM_COPY.saved(row.circleName)));
  };

  const skip = () => {
    refocus.current = "skip";
    void write(rhythmSkipUrl(row.circleId), "POST", { key: row.next.key }, (next) =>
      next ? RHYTHM_COPY.skipped(row.circleName, phraseOf(next.words)) : RHYTHM_COPY.skippedLast(row.circleName),
    );
  };

  return (
    <li
      id={anchor}
      tabIndex={-1}
      className={`scroll-mt-24 rounded-xl border bg-card px-4 py-3 outline-none ${lit ? "border-notice ring-2 ring-notice/60" : "border-border"}`}
    >
      <p id={`${anchor}-circle`} className={EYEBROW}>
        {circleWords(row.circleName)}
      </p>
      {editing ? (
        <div className="mt-3">
          <RhythmForm
            idBase={`rhythm-${row.circleId}`}
            circles={[{ id: row.circleId, name: row.circleName }]}
            fixedCircleId={row.circleId}
            initial={row.rhythm}
            labelledBy={`${anchor}-circle`}
            defaultMinutes={defaultMinutes}
            zone={zone}
            busy={busy}
            error={error}
            onSubmit={save}
            onCancel={() => {
              refocus.current = "change";
              setEditing(false);
              setError(null);
            }}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p id={`${anchor}-when`} className="mt-1 font-display text-xl leading-tight text-foreground">
                {row.words}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {row.rhythmWords} · {RHYTHM_COPY.waiting(row.waiting)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {row.openRoom ? (
                <Link href={`/sessions/${row.openRoom.id}`} className={`${BTN_PRIMARY} no-underline`} aria-describedby={describedBy}>
                  {RHYTHM_COPY.openNow}: {SESSION_LIST_COPY.enterRoom}
                </Link>
              ) : (
                <button type="button" className={BTN_SECONDARY} aria-describedby={describedBy} onClick={() => onGetReady(row)}>
                  {RHYTHM_COPY.getReady}
                </button>
              )}
            </div>
          </div>
          {row.canKeep && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <button ref={changeButton} type="button" className={BTN_QUIET} disabled={busy} aria-describedby={describedBy} onClick={() => setEditing(true)}>
                {RHYTHM_COPY.change}
              </button>
              <button ref={skipButton} type="button" className={BTN_QUIET} disabled={busy} aria-describedby={describedBy} onClick={skip}>
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
  const [said, setSaid] = useState("");
  const [lit, setLit] = useState<string | null>(null);
  const landed = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const setButton = useRef<HTMLButtonElement>(null);
  const backToSet = useRef(false);
  const hash = useHash();

  // A notice's link lands on its row once the list holds it, once per hash.
  useEffect(() => {
    const target = comingUp.rows.find((r) => hash === `#${comingAnchor(r.circleId)}`);
    if (!target || landed.current === hash) return;
    landed.current = hash;
    setLit(target.circleId);
    const frame = window.requestAnimationFrame(() => {
      const el = document.getElementById(comingAnchor(target.circleId));
      el?.scrollIntoView?.({ block: "center" });
      if (!typing()) el?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hash, comingUp.rows]);

  // The outline fades on its own clock, whatever the list does meanwhile.
  useEffect(() => {
    if (lit == null) return;
    const timer = window.setTimeout(() => setLit(null), 4000);
    return () => window.clearTimeout(timer);
  }, [lit]);

  // Back from the form, the focus returns to the button that opened it.
  useEffect(() => {
    if (!setting && backToSet.current) {
      backToSet.current = false;
      setButton.current?.focus();
    }
  }, [setting]);

  // A circle that has a rhythm changes it from its own row, so this form only sets new ones.
  const keepable = circles.filter((c) => comingUp.keepCircleIds.includes(c.id) && !comingUp.rows.some((r) => r.circleId === c.id));
  if (!comingUp.rows.length && !keepable.length) return null;

  const closeForm = () => {
    backToSet.current = true;
    setSetting(false);
    setError(null);
  };

  const add = async (circleId: string, input: RhythmInput) => {
    setBusy(true);
    setError(null);
    const out = await send(rhythmUrl(circleId), "PUT", input);
    if (!out.ok) {
      setBusy(false);
      setError(out.error);
      return;
    }
    await onChanged();
    setBusy(false);
    closeForm();
    setSaid(RHYTHM_COPY.saved(circles.find((c) => c.id === circleId)?.name ?? ""));
  };

  return (
    <section aria-labelledby="sessions-coming-heading">
      <h2 ref={heading} tabIndex={-1} id="sessions-coming-heading" className="font-display text-2xl text-foreground outline-none">
        {RHYTHM_COPY.sectionTitle}
      </h2>
      {/* Mounted from the start, so what landed is read out when its words arrive. */}
      <p aria-live="polite" className={`text-sm text-open ${said ? "mt-2" : "sr-only"}`}>
        {said}
      </p>
      {comingUp.rows.length === 0 ? (
        <p className={`mt-3 ${PANEL} ${HINT}`}>{RHYTHM_COPY.empty}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {comingUp.rows.map((row) => (
            <Row
              key={row.circleId}
              row={row}
              zone={comingUp.zone}
              defaultMinutes={defaultMinutes}
              lit={lit === row.circleId}
              onGetReady={onGetReady}
              onChanged={onChanged}
              onSaid={setSaid}
              onGone={() => heading.current?.focus()}
            />
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
                onCancel={closeForm}
              />
            </>
          ) : (
            <button
              ref={setButton}
              type="button"
              className={BTN_SECONDARY}
              onClick={() => {
                setSetting(true);
                setSaid("");
              }}
            >
              {RHYTHM_COPY.setRhythm}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
