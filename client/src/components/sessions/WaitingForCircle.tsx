/**
 * WAITING FOR A CIRCLE, on /sessions: what members brought for a circle's next
 * session (the agenda library, shared/sessionLibrary.ts). It sits between the
 * rooms open now and the records, in the page's main column, so on a phone it
 * is read before thirty records and not after them.
 *
 * ONE LIST PER CIRCLE, never a board of columns by status: the member's own
 * circles first, then the others, then "No circle in particular", each oldest
 * first (`groupByCircle`). Every card says where it stands in one line: still
 * waiting (and back after a session, when it came back), or on the agenda of a
 * room open now, with a link into it. What sessions took up lately folds
 * under one closed disclosure.
 *
 * BRINGING AN ITEM is one button that opens the form in place, the way the
 * room's tension catcher opens: Bring an item, type, Add it. Once the server
 * says yes, the page thanks them and says which circle it waits for.
 *
 * A CARD'S CONTROLS are the ones the server's own rights allow, read off the
 * card (`canEdit`, `canMoveCircle`, `canWithdraw`, `canBringAgain`): whoever
 * brought it and admins change it, withdraw it and bring it again; the
 * facilitator or secretary of the circle's open session rewords it. Withdraw
 * asks once, inline. Every write reads `res.ok` before it says anything, and
 * then the page reads the list again, so the screen shows what the server holds.
 *
 * A NOTICE LANDS ON ITS CARD. Every notice about an item links to
 * `/sessions#brought-<id>`; once the list arrives the card with that id is
 * scrolled into view and outlined for a moment.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { AIM_DEFS } from "@shared/sessions";
import {
  LIBRARY_API,
  LIBRARY_COPY,
  LIBRARY_STATUS_LINE,
  broughtAnchor,
  broughtIdFromHash,
  groupByCircle,
  libraryAgainUrl,
  libraryItemUrl,
  type LibraryCard,
  type LibraryPayload,
} from "@shared/sessionLibrary";
import { gameFetch } from "@/lib/gameApi";
import BroughtForm, { type BroughtValues } from "./BroughtForm";
import { BTN_DANGER, BTN_QUIET, BTN_SECONDARY, CHIP, HINT, LABEL_CAPS, PANEL } from "./roomUi";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** "14 October", in the reader's own locale. */
function shortDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

/** The server's own sentence when it sent one, or the fallback. */
async function refusal(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    const text = typeof body?.error === "string" ? body.error.trim() : "";
    return /\s/.test(text) ? text : LIBRARY_COPY.failed;
  } catch {
    return LIBRARY_COPY.failed;
  }
}

/** One write; null on the server's yes, or the sentence to show. */
async function send(path: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const res = await gameFetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return res.ok ? null : await refusal(res);
  } catch {
    return LIBRARY_COPY.failed;
  }
}

function StatusLine({ card }: { card: LibraryCard }) {
  const date = card.status === "taken_up" ? shortDay(card.settledAt) : card.status === "waiting" ? shortDay(card.backAt) : null;
  const line = LIBRARY_STATUS_LINE[card.status]({ title: card.session?.title ?? null, date: date || null });
  if (!line) return null;
  return (
    <p className="mt-1 text-sm text-muted-foreground">
      {card.session ? (
        <Link href={`/sessions/${card.session.id}`} className={`text-foreground underline decoration-notice/60 underline-offset-4 ${FOCUS}`}>
          {line}
        </Link>
      ) : (
        line
      )}
    </p>
  );
}

function Note({ text }: { text: string }) {
  const [whole, setWhole] = useState(false);
  return (
    <div className="mt-2">
      <p className={`whitespace-pre-line break-words text-foreground ${whole ? "" : "line-clamp-3"}`}>{text}</p>
      {text.length > 160 && (
        <button type="button" className={BTN_QUIET} aria-expanded={whole} onClick={() => setWhole((w) => !w)}>
          {whole ? LIBRARY_COPY.showLess : LIBRARY_COPY.showAll}
        </button>
      )}
    </div>
  );
}

function BroughtCard({
  card,
  circles,
  myCircleIds,
  lit,
  onChanged,
}: {
  card: LibraryCard;
  circles: { id: string; name: string }[];
  myCircleIds: readonly string[];
  lit: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [mode, setMode] = useState<"read" | "edit" | "withdraw">("read");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const when = shortDay(card.broughtAt);

  const run = async (write: () => Promise<string | null>, after: "read" | "keep" = "read") => {
    setBusy(true);
    setError(null);
    const said = await write();
    setBusy(false);
    if (said) {
      setError(said);
      return;
    }
    if (after === "read") setMode("read");
    await onChanged();
  };

  const save = (v: BroughtValues) => {
    // Only what changed travels, so a change somebody else made meanwhile survives unless both touched it.
    const patch: Record<string, unknown> = {};
    if (v.title !== card.title) patch.title = v.title;
    if (v.aim !== card.aim) patch.aim = v.aim;
    if ((v.note ?? null) !== (card.note ?? null)) patch.note = v.note ?? "";
    if (card.canMoveCircle && v.circleId !== card.circleId) patch.circleId = v.circleId;
    void run(() => send(libraryItemUrl(card.id), "PATCH", patch));
  };

  return (
    <li
      id={broughtAnchor(card.id)}
      className={`scroll-mt-24 rounded-xl border bg-card px-4 py-3 ${lit ? "border-notice ring-2 ring-notice/60" : "border-border"}`}
    >
      {mode === "edit" ? (
        <BroughtForm
          idBase={`brought-edit-${card.id}`}
          circles={circles}
          myCircleIds={myCircleIds}
          initial={{ title: card.title, aim: card.aim, note: card.note, circleId: card.circleId }}
          circleLocked={!card.canMoveCircle}
          busy={busy}
          error={error}
          onSubmit={save}
          onCancel={() => {
            setMode("read");
            setError(null);
          }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground">{card.title}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {card.aim && <span className={CHIP}>{AIM_DEFS[card.aim].label}</span>}
                <span>{card.mine ? LIBRARY_COPY.broughtByYou(when) : LIBRARY_COPY.broughtBy(card.broughtBy, when)}</span>
              </p>
              <StatusLine card={card} />
              {card.changedBy && <p className="mt-1 text-xs text-muted-foreground">{LIBRARY_COPY.changedBy(card.changedBy)}</p>}
            </div>
          </div>
          {card.note && <Note text={card.note} />}
          {mode === "withdraw" ? (
            <div role="group" aria-label={LIBRARY_COPY.withdraw} className="mt-3 rounded-xl border border-border bg-muted px-3 py-3">
              <p className="text-sm text-foreground">{card.status === "on_agenda" ? LIBRARY_COPY.withdrawOnAgenda : LIBRARY_COPY.withdrawConfirm}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={BTN_DANGER} disabled={busy} onClick={() => void run(() => send(libraryItemUrl(card.id), "DELETE"), "keep")}>
                  {busy ? LIBRARY_COPY.withdrawing : LIBRARY_COPY.withdrawYes}
                </button>
                <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => setMode("read")}>
                  {LIBRARY_COPY.keep}
                </button>
              </div>
            </div>
          ) : (
            (card.canEdit || card.canWithdraw || card.canBringAgain) && (
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {card.canEdit && (
                  <button type="button" className={BTN_QUIET} onClick={() => setMode("edit")}>
                    {LIBRARY_COPY.edit}
                  </button>
                )}
                {card.canBringAgain && (
                  <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void run(() => send(libraryAgainUrl(card.id), "POST", {}))}>
                    {LIBRARY_COPY.bringAgain}
                  </button>
                )}
                {card.canWithdraw && (
                  <button type="button" className={BTN_QUIET} onClick={() => setMode("withdraw")}>
                    {LIBRARY_COPY.withdraw}
                  </button>
                )}
              </div>
            )
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

export default function WaitingForCircle({
  library,
  circles,
  onChanged,
}: {
  library: LibraryPayload;
  circles: { id: string; name: string }[];
  onChanged: () => Promise<void> | void;
}) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [lit, setLit] = useState<number | null>(null);
  const landed = useRef<string | null>(null);

  // A notice's link lands on its card once the list holds it, once per hash.
  useEffect(() => {
    const hash = typeof window === "undefined" ? "" : window.location.hash;
    const id = broughtIdFromHash(hash);
    if (id == null || landed.current === hash || !library.items.some((c) => c.id === id)) return;
    landed.current = hash;
    const el = document.getElementById(broughtAnchor(id));
    el?.scrollIntoView?.({ block: "center" });
    setLit(id);
    const timer = window.setTimeout(() => setLit(null), 4000);
    return () => window.clearTimeout(timer);
  }, [library.items]);

  const circleName = (id: string | null) => (id ? (circles.find((c) => c.id === id)?.name ?? null) : null);
  const live = library.items.filter((c) => c.status !== "taken_up");
  const takenUp = library.items.filter((c) => c.status === "taken_up");
  const groups = groupByCircle(live, library.myCircleIds);

  const add = async (v: BroughtValues) => {
    setBusy(true);
    setError(null);
    const said = await send(LIBRARY_API, "POST", { title: v.title, aim: v.aim, note: v.note, circleId: v.circleId });
    setBusy(false);
    if (said) {
      setError(said);
      return;
    }
    setAdding(false);
    setSaved(LIBRARY_COPY.saved(circleName(v.circleId)));
    await onChanged();
  };

  return (
    <section aria-labelledby="sessions-waiting-heading">
      <h2 id="sessions-waiting-heading" className="font-display text-2xl text-foreground">
        {LIBRARY_COPY.sectionTitle}
      </h2>
      <p className={`${HINT} mt-1 max-w-2xl`}>{LIBRARY_COPY.sectionLede}</p>

      <div className={`mt-4 ${PANEL}`}>
        {adding ? (
          <>
            <h3 className={`${LABEL_CAPS} mb-3`}>{LIBRARY_COPY.formTitle}</h3>
            <BroughtForm
              idBase="brought-new"
              circles={circles}
              myCircleIds={library.myCircleIds}
              busy={busy}
              error={error}
              onSubmit={(v) => void add(v)}
              onCancel={() => {
                setAdding(false);
                setError(null);
              }}
            />
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={BTN_SECONDARY}
              onClick={() => {
                setAdding(true);
                setSaved(null);
              }}
            >
              {LIBRARY_COPY.bringButton}
            </button>
            {saved && (
              <p role="status" className="text-sm text-open">
                {saved}
              </p>
            )}
          </div>
        )}

        {groups.length === 0 ? (
          <p className={`mt-4 ${HINT}`}>{LIBRARY_COPY.empty}</p>
        ) : (
          <div className="mt-5 space-y-5">
            {groups.map((g) => (
              <section key={g.circleId ?? ""} aria-labelledby={`waiting-${g.circleId ?? "none"}`} data-circle-group={g.circleId ?? ""}>
                <h3 id={`waiting-${g.circleId ?? "none"}`} className={LABEL_CAPS}>
                  {g.heading}
                </h3>
                <ul className="mt-2 space-y-2">
                  {g.items.map((c) => (
                    <BroughtCard key={c.id} card={c} circles={circles} myCircleIds={library.myCircleIds} lit={lit === c.id} onChanged={onChanged} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {takenUp.length > 0 && (
          <details className="mt-5 border-t border-border pt-4" open={takenUp.some((c) => c.id === lit) || undefined}>
            <summary className={`flex min-h-11 cursor-pointer items-center font-semibold text-foreground ${FOCUS}`}>
              {LIBRARY_COPY.takenUpLately}
            </summary>
            <ul className="mt-2 space-y-2">
              {takenUp.map((c) => (
                <BroughtCard key={c.id} card={c} circles={circles} myCircleIds={library.myCircleIds} lit={lit === c.id} onChanged={onChanged} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
