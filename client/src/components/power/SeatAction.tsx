/**
 * THE ONE DOOR A SEAT CARD OPENS: raise a hand, sign in to raise one, or reach
 * the holder through the relay.
 *
 * Which door, and whether there is one at all, is the view model's decision
 * (`actionFor` in shared/roleSheet.ts), read here through the card's slot
 * (`seatCardSlot.ts`), so the rule lives in one tested place. This part only
 * posts, and it is the only part of the card that imports `@/lib/gameApi`,
 * which is why the host passes it in as a slot rather than the card owning it.
 *
 * Moved out of the map's old seat card with its words and its two requests
 * unchanged: a raised hand posts `{ note, termEndsOn? }` to
 * `/api/map/roles/:id/raise-hand` (every seat has a term since 0199, so the
 * hand carries the end date asked for, and the sentence says when the seat
 * would end before the hand goes up), and a message posts to
 * `/api/map/contact`. A refusal shows in the server's own words.
 *
 * A DIFFERENT SEAT CLEARS THE COMPOSER, so a half-written note to one person
 * never lands under another name.
 *
 * NIGHT_TERM_LOOK is the map's term-field look on the night card: the same
 * classes except the caution and the refusal. The map's amber and red measure
 * about 1.5 to 3.1 on the night panel; the sheet's own gold and warm red are
 * the inks that palette was measured for.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Hand, Mail } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { SHEET_WORDS } from "@shared/roleSheet";
import SeatTermField, { MAP_TERM_LOOK, type SeatTermLook } from "./SeatTermField";
import { useSeatCardSlot } from "./seatCardSlot";

export const NIGHT_TERM_LOOK: SeatTermLook = {
  ...MAP_TERM_LOOK,
  caution: "text-xs text-notice",
  refusal: "text-xs text-destructive",
};

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

/** Internal paths only, the rule `PeopleLock` applies to its own next. */
function safeNext(path: string): string {
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : "/";
}

const GOLD =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-(--sheet-earned-lit) to-notice px-4 text-[14px] font-semibold text-background shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_25%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40";
const LINE =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border px-4 text-[14px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring";
const QUIET =
  "min-h-11 rounded-xl px-3 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";
const FIELD = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";

export default function SeatAction({ circleId = null }: { circleId?: string | null }) {
  const slot = useSeatCardSlot();
  const [location] = useLocation();
  const [composing, setComposing] = useState(false);
  const [raising, setRaising] = useState(false);
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  /** The end date the hand asks for; empty means "with the season" (0199). */
  const [termEndsOn, setTermEndsOn] = useState("");
  const [status, setStatus] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const doorRef = useRef<HTMLElement | null>(null);
  const opened = useRef(false);
  const seenSignal = useRef(slot?.openSignal ?? 0);

  const seatId = slot?.seatId ?? "";
  const view = slot?.action ?? null;
  const announce = slot?.announce;

  // Selection changed: clear in-flight composer state so a half-written note
  // to one person never lands under another name.
  useEffect(() => {
    setComposing(false);
    setRaising(false);
    setMessage("");
    setNote("");
    setTermEndsOn("");
    setStatus("");
    opened.current = false;
  }, [seatId]);

  // The back face's shortcut turned the card over: open this door here.
  const signal = slot?.openSignal ?? 0;
  const kind = view?.kind ?? "none";
  useEffect(() => {
    if (signal === seenSignal.current) return;
    seenSignal.current = signal;
    if (kind === "raise") setRaising(true);
    else if (kind === "contact") setComposing(true);
    else if (kind === "signIn") doorRef.current?.focus();
  }, [signal, kind]);

  // An opened form takes focus, and a closed one hands it back to its door,
  // so a keyboard reader is never dropped onto the page body.
  const open = raising || composing;
  useEffect(() => {
    if (open) {
      opened.current = true;
      (raising ? noteRef : messageRef).current?.focus();
    } else if (opened.current) {
      opened.current = false;
      doorRef.current?.focus();
    }
  }, [open, raising]);

  useEffect(() => {
    if (status && announce) announce(status);
  }, [status, announce]);

  if (!view || view.kind === "none" || view.kind === "unreachable") return null;

  const raiseHand = () => {
    setStatus("");
    fetch(`/api/map/roles/${encodeURIComponent(seatId)}/raise-hand`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ note, ...(termEndsOn ? { termEndsOn } : {}) }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.message ?? d.error ?? "Could not raise your hand");
        setStatus(SHEET_WORDS.raised);
        setRaising(false);
        setNote("");
        setTermEndsOn("");
      })
      .catch((e) => setStatus(e.message));
  };

  const contact = (toUserId: string) => {
    setStatus("");
    fetch("/api/map/contact", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ toUserId, roleId: seatId, circleId: circleId ?? undefined, message }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.message ?? d.error ?? "Could not send");
        setStatus("Sent. They'll get an email they can reply to directly.");
        setComposing(false);
        setMessage("");
      })
      .catch((e) => setStatus(e.message));
  };

  const statusLine = status ? <p className="mt-2 text-xs text-foreground">{status}</p> : null;

  if (view.kind === "signIn") {
    const here =
      typeof window === "undefined" ? location : `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return (
      <Link
        ref={(el: HTMLAnchorElement | null) => {
          doorRef.current = el;
        }}
        href={`/login?next=${encodeURIComponent(safeNext(here))}`}
        className={`${GOLD} w-full`}
      >
        <Hand className="size-[17px] shrink-0" aria-hidden="true" />
        {view.label}
      </Link>
    );
  }

  if (view.kind === "raise") {
    return (
      <div>
        {raising ? (
          <div className="space-y-2">
            <textarea
              ref={noteRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              aria-label={SHEET_WORDS.raisePlaceholder}
              placeholder={SHEET_WORDS.raisePlaceholder}
              className={FIELD}
            />
            <SeatTermField value={termEndsOn} onChange={setTermEndsOn} label={SHEET_WORDS.raiseTermLabel} look={NIGHT_TERM_LOOK} />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={raiseHand} className={GOLD}>
                {SHEET_WORDS.raiseSubmit}
              </button>
              <button type="button" onClick={() => setRaising(false)} className={QUIET}>
                {SHEET_WORDS.cancel}
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              ref={(el) => {
                doorRef.current = el;
              }}
              type="button"
              onClick={() => setRaising(true)}
              aria-label={view.ariaLabel ?? undefined}
              className={`${GOLD} w-full`}
            >
              <Hand className="size-[17px] shrink-0" aria-hidden="true" />
              {view.label}
            </button>
            {view.consequence && <p className="mt-1.5 px-1 text-xs text-muted-foreground">{view.consequence}</p>}
          </>
        )}
        {statusLine}
      </div>
    );
  }

  // contact
  const name = view.contactName ?? "";
  const toUserId = view.contactUserId ?? null;
  return (
    <div>
      {composing ? (
        <div className="space-y-2">
          <textarea
            ref={messageRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            aria-label={`A few words for ${name}`}
            placeholder={`A few words for ${name}…`}
            className={FIELD}
          />
          <p className="text-[11px] text-muted-foreground">
            They'll receive this by email, with YOUR email address as the reply-to, so replying reaches you directly.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => toUserId && contact(toUserId)}
              disabled={!message.trim()}
              className={GOLD}
            >
              Send
            </button>
            <button type="button" onClick={() => setComposing(false)} className={QUIET}>
              {SHEET_WORDS.cancel}
            </button>
          </div>
        </div>
      ) : (
        <button
          ref={(el) => {
            doorRef.current = el;
          }}
          type="button"
          onClick={() => setComposing(true)}
          className={LINE}
        >
          <Mail className="size-[17px] shrink-0" aria-hidden="true" />
          {view.label}
        </button>
      )}
      {statusLine}
    </div>
  );
}
