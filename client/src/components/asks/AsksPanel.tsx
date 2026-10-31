/**
 * ASKS ON THE PROFILE (shared/memberAsks.ts holds the rules, the routes are
 * server/routes/memberAsks.ts).
 *
 *   Asked of you   what other members asked this member, in three bands:
 *                  someone is stuck, due this week, whenever. Each row opens
 *                  the link and carries Done and "Not mine".
 *   Your asks      what this member asked, open first, with Withdraw, and the
 *                  last few closed ones with how they closed.
 *   Ask someone    a person, a link, why, an optional due day, and whether
 *                  you are stuck until it is done.
 *
 * Only the two members on an ask ever see it; the server reads by the
 * reader's own id. A read that is closed to the reader (a guest) draws
 * nothing. A read that FAILED says so with a retry, because an empty list
 * would claim nothing waits.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { gameFetch } from "@/lib/gameApi";
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, HINT, INPUT, LABEL, LABEL_CAPS } from "@/components/sessions/roomUi";
import { announceProfileChange } from "@/lib/profileRefresh";
import {
  ASKS_URL,
  NOTE_MAX,
  TIER_WORDS,
  WHY_MAX,
  statusWords,
  type AskTier,
  type AskView,
  type AsksPayload,
} from "@shared/memberAsks";

const CARD = "rounded-2xl border border-border bg-muted px-4 py-3.5 text-foreground";
const TIERS: AskTier[] = ["blocking", "this-week", "whenever"];
/** Closed to this reader: not a failure, and nothing to draw. */
const CLOSED = new Set([401, 403, 404]);

const refusalOf = (body: unknown, fallback: string): string => {
  const said = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error.trim() : "";
  return said && /\s/.test(said) ? said : fallback;
};

const isOutside = (link: string) => /^https?:\/\//i.test(link);

const dueWords = (dueOn: string | null) => (dueOn ? `Due ${dueOn}` : "");

/** One ask waiting on the reader, with Done and "Not mine" in place. */
function AskedRow({ ask, onClosed }: { ask: AskView; onClosed: (id: string) => void }) {
  const [handing, setHanding] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const noteId = useId();

  const act = async (what: "done" | "not-mine") => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const trimmed = note.trim();
      const res = await gameFetch(`${ASKS_URL}/${encodeURIComponent(ask.id)}/${what}`, {
        method: "POST",
        body: JSON.stringify(what === "not-mine" && trimmed ? { note: trimmed } : {}),
      });
      const reply = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(what === "done" ? `${ask.otherName} will hear it is done.` : `Handed back to ${ask.otherName}.`);
        onClosed(ask.id);
        announceProfileChange();
      } else setError(refusalOf(reply, "That did not save. Try again."));
    } catch {
      setError("That did not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={CARD} data-ask={ask.id}>
      <p className="font-semibold leading-snug">
        {ask.otherName} asks: {ask.why}
      </p>
      <p className={`${HINT} mt-0.5`}>{[`Asked ${ask.askedOn}`, dueWords(ask.dueOn)].filter(Boolean).join(" · ")}</p>
      <a
        href={ask.link}
        {...(isOutside(ask.link) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className="mt-2 inline-block text-sm font-semibold text-foreground underline decoration-notice/60 underline-offset-4"
      >
        Open it
        <ArrowRight className="ml-1.5 inline-block h-4 w-4 align-[-3px]" aria-hidden="true" />
      </a>
      {handing ? (
        <div className="mt-3 space-y-2">
          <label htmlFor={noteId} className={LABEL}>
            Anything {ask.otherName} should know? (optional)
          </label>
          <input id={noteId} className={INPUT} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void act("not-mine")}>
              Hand it back
            </button>
            <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => setHanding(false)}>
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void act("done")}>
            Done
          </button>
          <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => setHanding(true)}>
            Not mine
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-foreground">
          {error}
        </p>
      )}
    </div>
  );
}

/** One of the reader's own asks. */
function YourAskRow({ ask, onClosed }: { ask: AskView; onClosed: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const withdraw = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await gameFetch(`${ASKS_URL}/${encodeURIComponent(ask.id)}/withdraw`, { method: "POST", body: "{}" });
      const reply = await res.json().catch(() => ({}));
      if (res.ok) onClosed(ask.id);
      else setError(refusalOf(reply, "That did not save. Try again."));
    } catch {
      setError("That did not save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={CARD} data-your-ask={ask.id}>
      <p className="font-semibold leading-snug">
        You asked {ask.otherName}: {ask.why}
      </p>
      <p className={`${HINT} mt-0.5`}>
        {[statusWords(ask.status), ask.blocking && ask.status === "open" ? "blocking you" : "", dueWords(ask.dueOn)].filter(Boolean).join(" · ")}
      </p>
      {ask.status === "handed_back" && ask.handBackNote && <p className="mt-1 text-sm text-foreground">{ask.otherName} said: {ask.handBackNote}</p>}
      {ask.status === "open" && (
        <button type="button" className={`${BTN_QUIET} mt-2`} disabled={busy} onClick={() => void withdraw()}>
          Withdraw
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-foreground">
          {error}
        </p>
      )}
    </div>
  );
}

/** The form: who, the link, why, an optional day, and whether you are stuck. */
function AskSomeone({ onSent }: { onSent: () => void }) {
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Array<{ userId: string; name: string; handle: string | null }>>([]);
  const [who, setWho] = useState<{ userId: string; name: string } | null>(null);
  const [link, setLink] = useState("");
  const [why, setWhy] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ids = useId();

  useEffect(() => {
    if (who || query.trim().length < 2) {
      setPeople([]);
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await gameFetch(`${ASKS_URL}/people?q=${encodeURIComponent(query.trim())}`);
        const list = res.ok ? await res.json() : [];
        if (live) setPeople(Array.isArray(list) ? list : []);
      } catch {
        if (live) setPeople([]);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, who]);

  const send = async () => {
    if (busy || !who) return;
    setBusy(true);
    setError("");
    try {
      const res = await gameFetch(ASKS_URL, {
        method: "POST",
        body: JSON.stringify({ askedUserId: who.userId, link: link.trim(), why: why.trim(), dueOn: dueOn || null, blocking }),
      });
      const reply = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(`Asked ${who.name}.`);
        setWho(null);
        setQuery("");
        setLink("");
        setWhy("");
        setDueOn("");
        setBlocking(false);
        onSent();
      } else setError(refusalOf(reply, "That did not send. Try again."));
    } catch {
      setError("That did not send. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      aria-labelledby={`${ids}-h`}
    >
      <h4 id={`${ids}-h`} className={LABEL_CAPS}>
        Ask someone
      </h4>
      <div>
        <label htmlFor={`${ids}-who`} className={LABEL}>
          Who
        </label>
        {who ? (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{who.name}</span>
            <button type="button" className={BTN_QUIET} onClick={() => setWho(null)}>
              Change
            </button>
          </p>
        ) : (
          <>
            <input id={`${ids}-who`} className={INPUT} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a name" autoComplete="off" />
            {people.length > 0 && (
              <ul className="mt-1 space-y-1" aria-label="Members">
                {people.map((p) => (
                  <li key={p.userId}>
                    <button type="button" className={BTN_QUIET} onClick={() => setWho({ userId: p.userId, name: p.name })}>
                      {p.name}
                      {p.handle ? ` @${p.handle}` : ""}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <div>
        <label htmlFor={`${ids}-link`} className={LABEL}>
          Link to what you need
        </label>
        <input id={`${ids}-link`} className={INPUT} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" inputMode="url" />
      </div>
      <div>
        <label htmlFor={`${ids}-why`} className={LABEL}>
          What you need them to do
        </label>
        <input id={`${ids}-why`} className={INPUT} maxLength={WHY_MAX} value={why} onChange={(e) => setWhy(e.target.value)} />
      </div>
      <div>
        <label htmlFor={`${ids}-due`} className={LABEL}>
          Due (optional)
        </label>
        <input id={`${ids}-due`} type="date" className={INPUT} value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} />
        I am stuck until this is done
      </label>
      {error && (
        <p role="alert" className="text-sm text-foreground">
          {error}
        </p>
      )}
      <button type="submit" className={BTN_PRIMARY} disabled={busy || !who || !link.trim() || !why.trim()}>
        Send the ask
      </button>
    </form>
  );
}

export default function AsksPanel() {
  const [data, setData] = useState<AsksPayload | null>(null);
  const [closed, setClosed] = useState(false);
  const [failed, setFailed] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await gameFetch(ASKS_URL, { cache: "no-store" });
      if (!live.current) return;
      if (CLOSED.has(res.status)) return setClosed(true);
      const body = res.ok ? await res.json().catch(() => null) : null;
      if (!live.current) return;
      if (body && Array.isArray(body.waitingOnYou) && Array.isArray(body.yourAsks)) setData(body as AsksPayload);
      else setFailed(true);
    } catch {
      if (live.current) setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (closed) return null;
  if (failed) {
    return (
      <div className="flex flex-wrap items-center gap-3" role="alert" data-asks-failed>
        <p className="text-sm text-foreground">Your asks did not load.</p>
        <button type="button" className={BTN_SECONDARY} onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }
  if (!data) return null;

  const dropWaiting = (id: string) => setData((d) => (d ? { ...d, waitingOnYou: d.waitingOnYou.filter((a) => a.id !== id) } : d));

  return (
    <section aria-labelledby="asks-h" className="space-y-5 rounded-3xl border border-border bg-card p-5 sm:p-6" data-asks>
      <h3 id="asks-h" className="font-display text-xl font-bold text-card-foreground">
        Asked of you
      </h3>
      {data.waitingOnYou.length === 0 ? (
        <p className={HINT}>Nobody is waiting on you for anything.</p>
      ) : (
        TIERS.map((tier) => {
          const rows = data.waitingOnYou.filter((a) => a.tier === tier);
          if (rows.length === 0) return null;
          return (
            <div key={tier} className="space-y-3" data-ask-tier={tier}>
              <h4 className={LABEL_CAPS}>{TIER_WORDS[tier]}</h4>
              <ul className="space-y-3">
                {rows.map((a) => (
                  <li key={a.id}>
                    <AskedRow ask={a} onClosed={dropWaiting} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
      <div id="your-asks" className="scroll-mt-28 space-y-3">
        <h4 className={LABEL_CAPS}>Your asks</h4>
        {data.yourAsks.length === 0 ? (
          <p className={HINT}>You have not asked anyone for anything yet.</p>
        ) : (
          <ul className="space-y-3">
            {data.yourAsks.map((a) => (
              <li key={a.id}>
                <YourAskRow ask={a} onClosed={() => void load()} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <AskSomeone onSent={() => void load()} />
    </section>
  );
}
