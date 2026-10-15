/**
 * GRATITUDE AT THE CLOSE: a thank-you to each person in the room, through the
 * village's own gratitude door (POST /api/game/gratitude/send, the one the
 * wall and the profile use), so it lands in the gratitude log and the moon's
 * cycle like any other. Hidden when the gratitude module is off.
 *
 * That door finds a person by handle. A room that sends a person's handle
 * offers the form; one that does not points at the wall for that person.
 * The server's own sentence is shown when it refuses: the allowance is spent,
 * a message is required, and so on.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Heart } from "lucide-react";
import { ROOM_COPY, ROOM_GRATITUDE_AMOUNT, SESSION_COPY, SESSION_LIMITS, cleanText, type SessionPerson } from "@shared/sessions";
import { gameFetch } from "@/lib/gameApi";
import { useModuleOn } from "@/modules/ModuleProvider";
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, CARD, H3, HINT, INPUT, LABEL, firstName, type StageProps } from "./roomUi";
import { refusalSentence } from "./useSessionRoom";

function ThankRow({ person }: { person: SessionPerson }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState(ROOM_GRATITUDE_AMOUNT);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const name = firstName(person.name);
  const handle = person.handle?.replace(/^@+/, "").trim() || null;
  const base = `thank-${person.userId}`;

  const send = async () => {
    if (!handle || busy) return;
    setBusy(true);
    setSaid(null);
    try {
      const res = await gameFetch("/api/game/gratitude/send", {
        method: "POST",
        body: JSON.stringify({ to: `@${handle}`, amount: Math.max(1, Math.floor(amount) || 1), message: cleanText(message, SESSION_LIMITS.text) ?? "" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaid({ ok: false, text: refusalSentence(body, res.status) });
        return;
      }
      setSaid({ ok: true, text: ROOM_COPY.thankSent(name) });
      setMessage("");
      setOpen(false);
    } catch {
      setSaid({ ok: false, text: ROOM_COPY.offline });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-foreground">{person.name}</span>
        {handle ? (
          !open && (
            <button type="button" className={BTN_SECONDARY} onClick={() => setOpen(true)}>
              <Heart className="h-4 w-4" aria-hidden="true" />
              {ROOM_COPY.thank(name)}
            </button>
          )
        ) : (
          <Link href="/gratitude" className={BTN_QUIET}>
            {ROOM_COPY.thankOnWall}
          </Link>
        )}
      </div>
      {open && handle && (
        <form
          className="mt-3 grid gap-2 sm:grid-cols-[1fr_6rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label htmlFor={`${base}-msg`} className="block">
            <span className="sr-only">{ROOM_COPY.thankPlaceholder}</span>
            <input
              id={`${base}-msg`}
              className={INPUT}
              value={message}
              maxLength={SESSION_LIMITS.text}
              placeholder={ROOM_COPY.thankPlaceholder}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <label htmlFor={`${base}-amt`} className="block">
            <span className={`${LABEL} text-xs`}>{ROOM_COPY.amountLabel}</span>
            <input
              id={`${base}-amt`}
              type="number"
              inputMode="numeric"
              min={1}
              className={`${INPUT} mt-1`}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className={BTN_PRIMARY} disabled={busy}>
              {ROOM_COPY.send}
            </button>
            <button type="button" className={BTN_QUIET} onClick={() => setOpen(false)}>
              {ROOM_COPY.cancel}
            </button>
          </div>
        </form>
      )}
      {said && (
        <p role={said.ok ? "status" : "alert"} className={`mt-2 text-sm ${said.ok ? "text-open" : "font-medium text-destructive"}`}>
          {said.text}
        </p>
      )}
    </li>
  );
}

export default function GratitudeRound({ view }: Pick<StageProps, "view">) {
  const on = useModuleOn("gratitude");
  if (!on) return null;
  const others = view.people.filter((p) => p.userId !== view.me.userId);
  return (
    <section className={CARD} aria-labelledby="close-gratitude">
      <h3 id="close-gratitude" className={H3}>
        {SESSION_COPY.gratitudeTitle}
      </h3>
      <p className={`${HINT} mb-3`}>{SESSION_COPY.gratitudeLede}</p>
      {others.length > 0 && view.me.joined ? (
        <ul className="space-y-2">
          {others.map((p) => (
            <ThankRow key={p.userId} person={p} />
          ))}
        </ul>
      ) : (
        <p className={HINT}>{view.me.joined ? ROOM_COPY.noOneToThank : ROOM_COPY.joinFirst}</p>
      )}
    </section>
  );
}
