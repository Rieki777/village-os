/**
 * FOLLOW THE CALENDAR, under "Coming up" on /sessions: a member picks which
 * circles' meetings they want on their own calendar (or every circle, the new
 * ones too), and makes a private address for Google Calendar, Apple or
 * Outlook. The calendar app reads the address every few hours and gets the
 * meetings of the circles followed at that moment, so nothing needs making
 * again when a circle changes its rhythm, skips a meeting, or begins.
 *
 * The circles are the live ones, read from the village when the panel opens.
 * The address is shown once, the moment it is made, and the server keeps only
 * its hash; later the panel says when it was made and last read, and offers a
 * new one or none. Every write reads `res.ok` before it says anything, and
 * what landed is read out in one polite line. The contract and every word are
 * shared/sessionCalendar.ts.
 */
import { useEffect, useRef, useState } from "react";
import {
  CALENDAR_COPY,
  FOLLOW_API,
  FOLLOW_KEY_API,
  googleAddUrl,
  webcalUrl,
  type FollowPayload,
} from "@shared/sessionCalendar";
import { gameFetch } from "@/lib/gameApi";
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, HINT, INPUT, LABEL, LABEL_CAPS, PANEL, UNDER_BOX } from "./roomUi";

type Sent<T> = { ok: true; body: T } | { ok: false; error: string };

async function call<T>(path: string, method: string, body?: unknown): Promise<Sent<T>> {
  try {
    const res = await gameFetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const out = (await res.json().catch(() => null)) as (T & { error?: unknown }) | null;
    if (res.ok && out) return { ok: true, body: out };
    const text = typeof out?.error === "string" ? out.error.trim() : "";
    return { ok: false, error: /\s/.test(text) ? text : CALENDAR_COPY.failed };
  } catch {
    return { ok: false, error: CALENDAR_COPY.failed };
  }
}

/** "14 October", in the reader's own locale. */
function shortDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

export default function FollowCalendar() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<FollowPayload | null>(null);
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [address, setAddress] = useState<string | null>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const backToButton = useRef(false);
  const addressBox = useRef<HTMLInputElement>(null);

  const take = (p: FollowPayload) => {
    setData(p);
    setAll(p.all);
    setPicked(new Set(p.circles.filter((c) => c.followed && !p.all).map((c) => c.id)));
  };

  // The circles are read fresh each time the panel opens: they change.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void call<FollowPayload>(FOLLOW_API, "GET").then((out) => {
      if (!live) return;
      if (out.ok) take(out.body);
      else setError(out.error);
    });
    return () => {
      live = false;
    };
  }, [open]);

  // Back from the panel, the focus returns to the button that opened it.
  useEffect(() => {
    if (!open && backToButton.current) {
      backToButton.current = false;
      openButton.current?.focus();
    }
  }, [open]);

  const close = () => {
    backToButton.current = true;
    setOpen(false);
    setAddress(null);
    setError(null);
  };

  const run = async <T,>(write: () => Promise<Sent<T>>, after: (body: T) => void) => {
    setBusy(true);
    setError(null);
    const out = await write();
    setBusy(false);
    if (!out.ok) {
      setError(out.error);
      return;
    }
    after(out.body);
  };

  const save = () =>
    void run(
      () => call<FollowPayload>(FOLLOW_API, "PUT", { all, circleIds: all ? [] : Array.from(picked) }),
      (p) => {
        take(p);
        setSaid(CALENDAR_COPY.saved(p.circles.filter((c) => c.followed).length, p.all));
      },
    );

  const makeAddress = () =>
    void run(
      () => call<{ url: string }>(FOLLOW_KEY_API, "POST"),
      (b) => {
        setAddress(b.url);
        setData((d) => (d ? { ...d, address: { madeAt: new Date().toISOString(), lastReadAt: null } } : d));
      },
    );

  const stopAddress = () =>
    void run(
      () => call<{ ok: true }>(FOLLOW_KEY_API, "DELETE"),
      () => {
        setAddress(null);
        setData((d) => (d ? { ...d, address: null } : d));
        setSaid(CALENDAR_COPY.stopped);
      },
    );

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setSaid(CALENDAR_COPY.copied);
    } catch {
      addressBox.current?.select();
    }
  };

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="mt-3">
      {!open ? (
        <button
          ref={openButton}
          type="button"
          className={BTN_SECONDARY}
          onClick={() => {
            setOpen(true);
            setSaid("");
          }}
        >
          {CALENDAR_COPY.follow}
        </button>
      ) : (
        <section className={PANEL} aria-labelledby="follow-calendar-heading">
          <h3 id="follow-calendar-heading" className={LABEL_CAPS}>
            {CALENDAR_COPY.title}
          </h3>
          <p className={`${HINT} mt-2 max-w-2xl`}>{CALENDAR_COPY.lede}</p>
          {data && (
            <fieldset className="mt-4 space-y-1" disabled={busy}>
              <legend className="sr-only">{CALENDAR_COPY.title}</legend>
              <label className="flex min-h-11 items-center gap-3 font-semibold text-foreground">
                <input type="checkbox" className="size-5 accent-current" checked={all} onChange={(e) => setAll(e.target.checked)} />
                {CALENDAR_COPY.everyCircle}
              </label>
              {data.circles.map((c) => (
                <label key={c.id} className="flex min-h-11 items-center gap-3 text-foreground">
                  <input type="checkbox" className="size-5 accent-current" checked={all || picked.has(c.id)} disabled={all} onChange={() => toggle(c.id)} />
                  <span className="min-w-0">
                    {c.name}
                    <span className="block text-sm text-muted-foreground">{c.rhythm ?? CALENDAR_COPY.noRhythm}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <div className={`mt-3 ${UNDER_BOX}`}>
            <button type="button" className={BTN_PRIMARY} disabled={busy || !data} onClick={save}>
              {busy ? CALENDAR_COPY.saving : CALENDAR_COPY.save}
            </button>
          </div>

          <h4 className={`${LABEL_CAPS} mt-6`}>{CALENDAR_COPY.addressTitle}</h4>
          <p className={`${HINT} mt-2 max-w-2xl`}>{CALENDAR_COPY.addressPrivate}</p>
          {address ? (
            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor="follow-calendar-address" className={LABEL}>
                  {CALENDAR_COPY.addressLabel}
                </label>
                <input id="follow-calendar-address" ref={addressBox} readOnly value={address} className={`mt-1 ${INPUT} font-mono text-sm`} onFocus={(e) => e.target.select()} />
                <p className={`${HINT} mt-1`}>{CALENDAR_COPY.shownOnce}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={googleAddUrl(address)} target="_blank" rel="noopener noreferrer" className={`${BTN_SECONDARY} no-underline`}>
                  {CALENDAR_COPY.addGoogle}
                </a>
                <a href={webcalUrl(address)} className={`${BTN_SECONDARY} no-underline`}>
                  {CALENDAR_COPY.addApple}
                </a>
                <button type="button" className={BTN_QUIET} onClick={() => void copy()}>
                  {CALENDAR_COPY.copy}
                </button>
              </div>
            </div>
          ) : data?.address ? (
            <div className="mt-3">
              <p className="text-sm text-foreground">
                {CALENDAR_COPY.madeOn(shortDay(data.address.madeAt))}{" "}
                {data.address.lastReadAt ? CALENDAR_COPY.readOn(shortDay(data.address.lastReadAt)) : CALENDAR_COPY.notReadYet}
              </p>
              <div className={`mt-2 ${UNDER_BOX}`}>
                <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={makeAddress}>
                  {CALENDAR_COPY.newAddress}
                </button>
                <button type="button" className={BTN_QUIET} disabled={busy} onClick={stopAddress}>
                  {CALENDAR_COPY.stopAddress}
                </button>
              </div>
              <p className={`${HINT} mt-1`}>{CALENDAR_COPY.newAddressHint}</p>
            </div>
          ) : (
            <div className={`mt-3 ${UNDER_BOX}`}>
              <button type="button" className={BTN_SECONDARY} disabled={busy || !data} onClick={makeAddress}>
                {CALENDAR_COPY.makeAddress}
              </button>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-3 text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <div className={`mt-4 ${UNDER_BOX}`}>
            <button type="button" className={BTN_QUIET} onClick={close}>
              {CALENDAR_COPY.close}
            </button>
          </div>
        </section>
      )}
      {/* Mounted from the start, so what landed is read out when its words arrive. */}
      <p aria-live="polite" className={`text-sm text-open ${said ? "mt-2" : "sr-only"}`}>
        {said}
      </p>
    </div>
  );
}
