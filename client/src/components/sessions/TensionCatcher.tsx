/**
 * NAME A TENSION, open on every stage. Something sensed that wants its own
 * time goes straight to the backlog, so it is held without taking over the
 * item the room is on.
 *
 * The box is the room's growing box with the voice button beside it, so a
 * tension can be said aloud as easily as typed. Enter sends it; Shift and
 * Enter starts a new line; Escape puts the box away.
 *
 * WHAT IS IN THE BACKLOG SO FAR. Under the catcher, every tension this
 * session has named so far, each an EntryCard: whoever named it, the hosts
 * and an admin in the room can fix its words or take it out before the
 * session closes and the backlog goes to next time. The panel is drawn only
 * once there is something in it.
 *
 * EVERY TENSION CAN BECOME AN AGENDA ITEM. Whoever named it, the hosts and an
 * admin send it on to a circle's agenda items (SendTension.tsx); once sent,
 * the card says where it went.
 */
import { useState } from "react";
import { ROOM_COPY, SESSION_COPY, SESSION_LIMITS, cleanText } from "@shared/sessions";
import EntryCard from "./EntryCard";
import SendTension from "./SendTension";
import { TENSION_SEND_COPY } from "@shared/sessionLibrary";
import GrowingText from "./GrowingText";
import { BTN_PRIMARY, BTN_QUIET, ENTRY_GLYPH, LABEL_CAPS, PANEL, UNDER_BOX, type StageProps } from "./roomUi";

const Feather = ENTRY_GLYPH.tension;

export default function TensionCatcher({ view, actions }: Omit<StageProps, "now">) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  if (!view.me.joined || view.status !== "open") return null;
  const tensions = view.entries.filter((e) => e.kind === "tension");

  const send = async () => {
    const clean = cleanText(text, SESSION_LIMITS.text);
    if (!clean || busy) return;
    setBusy(true);
    try {
      const r = await actions.addEntry({ kind: "tension", text: clean, itemId: null });
      if (r.ok) {
        setText("");
        setOpen(false);
        setSaved(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const backlog =
    tensions.length > 0 ? (
      <section className={PANEL} aria-labelledby="tension-backlog">
        <h3 id="tension-backlog" className={`${LABEL_CAPS} mb-3`}>
          {ROOM_COPY.backlogSoFar}
        </h3>
        <ul className="space-y-2">
          {tensions.map((e) => {
            const sent = view.sentTensions[String(e.id)];
            const maySend = view.me.admin || view.me.facilitates || view.me.secretary || e.authorUserId === view.me.userId;
            return (
              <li key={e.id}>
                <EntryCard
                  view={view}
                  actions={actions}
                  entry={e}
                  extra={
                    sent ? (
                      <p className="mt-1 text-sm text-open">{TENSION_SEND_COPY.sent(sent.circleName)}</p>
                    ) : maySend ? (
                      <div className="mt-1">
                        <SendTension view={view} actions={actions} entry={e} sessionId={view.id} />
                      </div>
                    ) : null
                  }
                />
              </li>
            );
          })}
        </ul>
      </section>
    ) : null;

  return (
    <div className="space-y-4">
      {open ? (
        <form
          className="space-y-2 rounded-xl border border-border bg-card p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="sr-only" htmlFor="tension-text">
            {SESSION_COPY.addTension}
          </label>
          <GrowingText
            id="tension-text"
            value={text}
            onValue={setText}
            onSubmit={() => void send()}
            onCancel={() => setOpen(false)}
            label={ROOM_COPY.tensionPlaceholder}
            max={SESSION_LIMITS.text}
            minRows={3}
            mic
            autoFocus
          />
          <div className={UNDER_BOX}>
            <button type="submit" className={BTN_PRIMARY} disabled={busy || !text.trim()}>
              {ROOM_COPY.send}
            </button>
            <button type="button" className={BTN_QUIET} onClick={() => setOpen(false)}>
              {ROOM_COPY.cancel}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={BTN_QUIET}
            onClick={() => {
              setOpen(true);
              setSaved(false);
            }}
          >
            <Feather className="h-4 w-4" aria-hidden="true" />
            {SESSION_COPY.addTension}
          </button>
          {saved && (
            <p role="status" className="text-sm text-open">
              {ROOM_COPY.tensionSaved}
            </p>
          )}
        </div>
      )}
      {backlog}
    </div>
  );
}
