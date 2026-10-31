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
 * under one disclosure.
 *
 * BRINGING AN ITEM is one button that opens the form in place, the way the
 * room's tension catcher opens: Bring an item, type, Add it. Once the server
 * says yes, the page thanks them and says which circle it waits for, and the
 * focus goes back to the button.
 *
 * A CARD'S CONTROLS are the ones the server's own rights allow, read off the
 * card (`canEdit`, `canMoveCircle`, `canWithdraw`, `canBringAgain`): whoever
 * brought it and admins change it, withdraw it and bring it again; the
 * facilitator or secretary of the circle's open session rewords it. Withdraw
 * asks once, inline. Every write reads `res.ok` before it says anything, stays
 * busy until the page has read the list again, and only then lets go, so a
 * second tap never lands on a card that already moved.
 *
 * AN EDIT SENDS WHAT THIS PERSON CHANGED. The form opens on the card as it was
 * at that moment, and saving compares against that moment, never against the
 * card a later poll brought, so somebody else's change made meanwhile survives
 * unless both touched the same field.
 *
 * A NOTICE LANDS ON ITS CARD. Every notice about an item links to
 * `/sessions#brought-<id>`. Whenever the hash names a card the list holds (on
 * arrival, or a notice tapped while already here), the card's disclosure opens
 * if it is folded, then the card is scrolled to, outlined for a moment and
 * given the focus.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ChevronDown } from "lucide-react";
import { AIM_DEFS } from "@shared/sessions";
import {
  LIBRARY_API,
  LIBRARY_COPY,
  LIBRARY_SOURCE_LINE,
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
import ClampedNote from "./ClampedNote";
import { useHash } from "./useHash";
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

function BroughtCard({
  card,
  circles,
  myCircleIds,
  lit,
  onChanged,
  onGone,
}: {
  card: LibraryCard;
  circles: { id: string; name: string }[];
  myCircleIds: readonly string[];
  lit: boolean;
  onChanged: () => Promise<void> | void;
  onGone: () => void;
}) {
  const [mode, setMode] = useState<"read" | "edit" | "withdraw">("read");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  // The card as it was when the form opened: what this person's change is measured against.
  const opened = useRef<BroughtValues | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const when = shortDay(card.broughtAt);

  // Back from the form or the confirm, the focus returns to the control that opened it.
  useEffect(() => {
    if (mode === "read" && refocus.current) {
      refocus.current = false;
      editButton.current?.focus();
    }
  }, [mode]);

  if (gone) return null;

  const backToRead = () => {
    refocus.current = true;
    setMode("read");
    setError(null);
  };

  const run = async (write: () => Promise<string | null>, after: "read" | "gone") => {
    setBusy(true);
    setError(null);
    const said = await write();
    if (said) {
      setBusy(false);
      setError(said);
      return;
    }
    if (after === "gone") {
      setGone(true);
      onGone();
    }
    // Busy until the list holds what the server now holds, so a second tap never lands on a card that moved.
    await onChanged();
    setBusy(false);
    if (after === "read") backToRead();
  };

  const startEdit = () => {
    opened.current = { title: card.title, aim: card.aim, note: card.note, circleId: card.circleId };
    setMode("edit");
  };

  const save = (v: BroughtValues) => {
    const was = opened.current ?? { title: card.title, aim: card.aim, note: card.note, circleId: card.circleId };
    const patch: Record<string, unknown> = {};
    if (v.title !== was.title) patch.title = v.title;
    if (v.aim !== was.aim) patch.aim = v.aim;
    if ((v.note ?? null) !== (was.note ?? null)) patch.note = v.note ?? "";
    if (card.canMoveCircle && v.circleId !== was.circleId) patch.circleId = v.circleId;
    if (!Object.keys(patch).length) {
      backToRead();
      return;
    }
    void run(() => send(libraryItemUrl(card.id), "PATCH", patch), "read");
  };

  return (
    <li
      id={broughtAnchor(card.id)}
      tabIndex={-1}
      className={`scroll-mt-24 rounded-xl border bg-card px-4 py-3 outline-none ${lit ? "border-notice ring-2 ring-notice/60" : "border-border"}`}
    >
      {mode === "edit" ? (
        <BroughtForm
          idBase={`brought-edit-${card.id}`}
          circles={circles}
          myCircleIds={myCircleIds}
          initial={opened.current ?? { title: card.title, aim: card.aim, note: card.note, circleId: card.circleId }}
          initialCircleName={card.circleName}
          circleLocked={!card.canMoveCircle}
          busy={busy}
          error={error}
          onSubmit={save}
          onCancel={backToRead}
        />
      ) : (
        <>
          <p className="font-semibold text-foreground">{card.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {card.aim && <span className={CHIP}>{AIM_DEFS[card.aim].label}</span>}
            <span>{card.mine ? LIBRARY_COPY.broughtByYou(when) : LIBRARY_COPY.broughtBy(card.broughtBy, when)}</span>
          </p>
          {card.source && <p className="mt-1 text-sm text-muted-foreground">{LIBRARY_SOURCE_LINE[card.source.kind](card.source.label)}</p>}
          <StatusLine card={card} />
          {card.changedBy && <p className="mt-1 text-xs text-muted-foreground">{LIBRARY_COPY.changedBy(card.changedBy)}</p>}
          {card.note && <ClampedNote text={card.note} />}
          {mode === "withdraw" ? (
            <div role="group" aria-label={LIBRARY_COPY.withdraw} className="mt-3 rounded-xl border border-border bg-muted px-3 py-3">
              <p className="text-sm text-foreground">{card.status === "on_agenda" ? LIBRARY_COPY.withdrawOnAgenda : LIBRARY_COPY.withdrawConfirm}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={BTN_DANGER} disabled={busy} onClick={() => void run(() => send(libraryItemUrl(card.id), "DELETE"), "gone")}>
                  {busy ? LIBRARY_COPY.withdrawing : LIBRARY_COPY.withdrawYes}
                </button>
                <button type="button" className={BTN_QUIET} disabled={busy} onClick={backToRead}>
                  {LIBRARY_COPY.keep}
                </button>
              </div>
            </div>
          ) : (
            (card.canEdit || card.canWithdraw || card.canBringAgain) && (
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {card.canEdit && (
                  <button ref={editButton} type="button" className={BTN_QUIET} disabled={busy} onClick={startEdit}>
                    {LIBRARY_COPY.edit}
                  </button>
                )}
                {card.canBringAgain && (
                  <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void run(() => send(libraryAgainUrl(card.id), "POST", {}), "read")}>
                    {LIBRARY_COPY.bringAgain}
                  </button>
                )}
                {card.canWithdraw && (
                  <button
                    ref={card.canEdit ? undefined : editButton}
                    type="button"
                    className={BTN_QUIET}
                    disabled={busy}
                    onClick={() => setMode("withdraw")}
                  >
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
  const [saved, setSaved] = useState("");
  const [lit, setLit] = useState<number | null>(null);
  const [takenOpen, setTakenOpen] = useState(false);
  const landed = useRef<string | null>(null);
  const bringButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const backToButton = useRef(false);
  const hash = useHash();

  const live = library.items.filter((c) => c.status !== "taken_up");
  const takenUp = library.items.filter((c) => c.status === "taken_up");
  const groups = groupByCircle(live, library.myCircleIds);

  // A notice's link lands on its card once the list holds it, once per hash:
  // the disclosure opens first, then the card is scrolled to and focused.
  useEffect(() => {
    const id = broughtIdFromHash(hash);
    const target = id == null ? undefined : library.items.find((c) => c.id === id);
    if (!target || landed.current === hash) return;
    landed.current = hash;
    if (target.status === "taken_up") setTakenOpen(true);
    setLit(target.id);
    const frame = window.requestAnimationFrame(() => {
      const el = document.getElementById(broughtAnchor(target.id));
      el?.scrollIntoView?.({ block: "center" });
      el?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hash, library.items]);

  // The outline fades on its own clock, whatever the list does meanwhile.
  useEffect(() => {
    if (lit == null) return;
    const timer = window.setTimeout(() => setLit(null), 4000);
    return () => window.clearTimeout(timer);
  }, [lit]);

  // Back from the form, the focus returns to the button that opened it.
  useEffect(() => {
    if (!adding && backToButton.current) {
      backToButton.current = false;
      bringButton.current?.focus();
    }
  }, [adding]);

  const circleName = (id: string | null) => (id ? (circles.find((c) => c.id === id)?.name ?? null) : null);

  const closeForm = () => {
    backToButton.current = true;
    setAdding(false);
    setError(null);
  };

  const add = async (v: BroughtValues) => {
    setBusy(true);
    setError(null);
    const said = await send(LIBRARY_API, "POST", { title: v.title, aim: v.aim, note: v.note, circleId: v.circleId });
    if (said) {
      setBusy(false);
      setError(said);
      return;
    }
    await onChanged();
    setBusy(false);
    closeForm();
    setSaved(LIBRARY_COPY.saved(circleName(v.circleId)));
  };

  const cardProps = (c: LibraryCard) => ({
    card: c,
    circles,
    myCircleIds: library.myCircleIds,
    lit: lit === c.id,
    onChanged,
    // A withdrawn card leaves; the focus goes to the section's heading.
    onGone: () => heading.current?.focus(),
  });

  return (
    <section aria-labelledby="sessions-waiting-heading">
      <h2 ref={heading} tabIndex={-1} id="sessions-waiting-heading" className="font-display text-2xl text-foreground outline-none">
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
              onCancel={closeForm}
            />
          </>
        ) : (
          <button
            ref={bringButton}
            type="button"
            className={BTN_SECONDARY}
            onClick={() => {
              setAdding(true);
              setSaved("");
            }}
          >
            {LIBRARY_COPY.bringButton}
          </button>
        )}
        {/* Mounted from the start, so the thanks is read out when its words arrive. */}
        <p aria-live="polite" className={`text-sm text-open ${saved ? "mt-2" : "sr-only"}`}>
          {saved}
        </p>

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
                    <BroughtCard key={c.id} {...cardProps(c)} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {takenUp.length > 0 && (
          <details className="group mt-5 border-t border-border pt-4" open={takenOpen} onToggle={(e) => setTakenOpen(e.currentTarget.open)}>
            <summary
              className={`flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold text-foreground underline decoration-notice/60 underline-offset-4 hover:decoration-notice [&::-webkit-details-marker]:hidden ${FOCUS}`}
            >
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
              {LIBRARY_COPY.takenUpLately}
            </summary>
            <ul className="mt-2 space-y-2">
              {takenUp.map((c) => (
                <BroughtCard key={c.id} {...cardProps(c)} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
