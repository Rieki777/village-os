/**
 * The host's side of a gathering once it has begun: who came, the recap, and
 * the answers that come back (the comms build spec 5.9 and 5.14).
 *
 * Shown on the gathering's card and opened straight from the host nudge
 * (`/events?recap=<id>`, `recapComposerPath`). It asks
 * `/api/events/:id/recap`, which answers `{ manage: false }` to anybody
 * without `event.manage`; then this renders nothing at all.
 *
 * "Draft it for me" fills the box from what we know and never sends. Send
 * says how many people it reaches before it goes, and a sent recap stays
 * shown as sent.
 *
 * Member page: semantic theme tokens, never numbered grays.
 */
import { useCallback, useEffect, useState } from "react";
import { RECAP_EMPTY, type RecapAnswerRow, type RecapView } from "@shared/comms/recap";
import { authToken } from "@/lib/gameApi";
import AttendanceList from "./AttendanceList";

// The Authorization header is attached HERE, in this declaration, so the auth
// guard (scripts/check-auth-fetch.mjs) reads it one helper deep.
const headers = (): Record<string, string> => {
  const t = authToken();
  return { ...(t ? { Authorization: `Bearer ${t}` } : {}), "Content-Type": "application/json" };
};

const quiet =
  "px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-background text-foreground hover:bg-muted disabled:opacity-40";
const primary =
  "px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-deep text-white border border-teal-deep hover:bg-teal-deep-dark disabled:opacity-40";
const box = "mt-1 block w-full rounded-lg border border-border bg-background p-2 text-sm text-foreground";

/** Whether a gathering card offers the host's tools: a gathering that has begun, in the last month. */
export function hostToolsFor(g: { kind: string; startsAt: string; daysUntil: number }, now = Date.now()): boolean {
  return (g.kind === "gathering" || g.kind === "festival") && Date.parse(g.startsAt) <= now && g.daysUntil >= -31;
}

/** The evening a `/events?recap=<id>&occ=<date>` link names (`recapComposerPath`), or null. */
export function recapLinkIn(search: string): { eventId: string; occurrenceKey: string } | null {
  const p = new URLSearchParams(search);
  const eventId = (p.get("recap") ?? "").trim();
  const occ = (p.get("occ") ?? "").trim();
  if (!eventId || eventId.length > 64) return null;
  return { eventId, occurrenceKey: /^\d{4}-\d{2}-\d{2}$/.test(occ) ? occ : "" };
}

const nameOf = (a: Pick<RecapAnswerRow, "name" | "guest">) => `${a.name ?? (a.guest ? "A guest" : "A member who has since left")}${a.guest ? " (guest)" : ""}`;

export default function HostRecapPanel({
  eventId,
  occurrenceKey,
  startOpen = false,
  withTitle = false,
}: {
  eventId: string;
  occurrenceKey: string;
  startOpen?: boolean;
  /** Name the gathering in the heading, where the panel stands apart from its card. */
  withTitle?: boolean;
}) {
  const [view, setView] = useState<RecapView | null>(null);
  const [open, setOpen] = useState(startOpen);
  const [body, setBody] = useState("");
  const [missed, setMissed] = useState("");
  const [recording, setRecording] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const url = `/api/events/${encodeURIComponent(eventId)}/recap`;

  const take = (v: RecapView, fill: boolean) => {
    setView(v);
    if (fill && v.recap) {
      setBody(v.recap.bodyMd);
      setMissed(v.recap.missedNoteMd);
      setRecording(v.recap.recordingUrl);
    }
  };

  const load = useCallback(
    (fill: boolean) => {
      fetch(`${url}?occurrence=${encodeURIComponent(occurrenceKey)}`, { headers: headers() })
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((a: RecapView | { manage: false }) => {
          if (a.manage) take(a, fill);
        })
        .catch(() => setView(null));
    },
    [url, occurrenceKey],
  );

  useEffect(() => load(true), [load]);

  if (!view) return null;

  const call = async (what: string, path: string, payload: Record<string, unknown>) => {
    setBusy(what);
    setNote(null);
    try {
      const res = await fetch(path, { method: "POST", headers: headers(), body: JSON.stringify({ occurrenceKey, ...payload }) });
      const out = await res.json().catch(() => ({}));
      setBusy(null);
      if (!res.ok) {
        setNote(String(out?.error ?? "That didn't go through. Try again."));
        return null;
      }
      return out;
    } catch {
      setBusy(null);
      setNote("That didn't go through. Try again.");
      return null;
    }
  };

  const draft = async () => {
    const out = await call("draft", `${url}/draft`, { notes: body });
    if (out?.bodyMd) {
      setBody(String(out.bodyMd));
      setNote(out.polished ? "Drafted, with your notes polished. Read it over, then save or send." : "Drafted. Read it over, then save or send.");
    }
  };

  const saveDraft = async () => {
    const out = await call("save", url, { bodyMd: body, missedNoteMd: missed, recordingUrl: recording });
    if (out?.manage) {
      take(out as RecapView, false);
      setNote("Draft saved.");
    }
    return Boolean(out);
  };

  const send = async () => {
    if (!(await saveDraft())) return;
    const out = await call("send", `${url}/send`, {});
    if (out?.ok) {
      setNote(`Sent to ${Number(out.came) + Number(out.missed)} people.`);
      load(false);
    }
  };

  const sent = view.recap?.state === "sent";
  // An empty stored draft is no block: Send saves the box first.
  const blocked = !view.sendable.ok && view.sendable.reason !== RECAP_EMPTY;
  const reach = view.audience.came + view.audience.missed;
  const q1 = view.answers.filter((a) => a.questionKey === "q1");
  const q2 = view.answers.filter((a) => a.questionKey === "q2");

  return (
    <section aria-label="After the gathering" className="mt-3 rounded-xl border border-border bg-background p-3">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-sm font-medium text-foreground">
        {withTitle ? `${view.title}: ` : ""}
        {sent ? "Recap sent" : "Write the recap"}
        <span className="ml-2 text-xs text-muted-foreground">{open ? "Hide" : "Open"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-4">
          <AttendanceList eventId={eventId} occurrenceKey={occurrenceKey} onSaved={() => load(false)} />

          {sent ? (
            <p className="text-sm text-foreground">
              Sent
              {view.recap?.sentAt ? ` ${new Date(view.recap.sentAt * 1000).toLocaleDateString()}` : ""}.
            </p>
          ) : (
            <div className="space-y-2">
              <label className="block text-xs text-muted-foreground">
                What happened
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} maxLength={20000} className={box} />
              </label>
              <label className="block text-xs text-muted-foreground">
                A note for people who missed it (optional)
                <textarea value={missed} onChange={(e) => setMissed(e.target.value)} rows={2} maxLength={5000} className={box} />
              </label>
              <label className="block text-xs text-muted-foreground">
                Recording link (optional)
                <input value={recording} onChange={(e) => setRecording(e.target.value)} inputMode="url" maxLength={500} className={box} />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={quiet} disabled={busy !== null} onClick={draft}>
                  Draft it for me
                </button>
                <button type="button" className={quiet} disabled={busy !== null} onClick={() => void saveDraft()}>
                  Save draft
                </button>
                <button type="button" className={primary} disabled={busy !== null || !body.trim() || blocked} onClick={send}>
                  {reach === 1 ? "Send to 1 person" : `Send to ${reach} people`}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {view.audience.missed > 0
                  ? `${view.audience.came} get the recap, ${view.audience.missed} get it with your note for people who missed it.`
                  : "Everyone who said yes gets the recap."}
                {view.next ? ` It offers the next gathering: ${view.next.title}, ${view.next.when}.` : ""}
              </p>
              {blocked && (
                <p className="text-xs text-muted-foreground">{view.sendable.reason}</p>
              )}
            </div>
          )}
          {note && (
            <p role="status" className="text-xs text-muted-foreground">
              {note}
            </p>
          )}

          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-foreground">Answers</h4>
            {view.answers.length === 0 && <p className="text-xs text-muted-foreground">No answers yet.</p>}
            {q1.length > 0 && (
              <p className="text-sm text-foreground">
                {view.questions[0]} Yes: {q1.filter((a) => a.answer === "yes").length}, No: {q1.filter((a) => a.answer === "no").length}
                <span className="block text-xs text-muted-foreground">{q1.map((a) => `${nameOf(a)}: ${a.answer === "yes" ? "Yes" : "No"}`).join(", ")}</span>
              </p>
            )}
            {q2.length > 0 && (
              <div className="text-sm text-foreground">
                <p>{view.questions[1]}</p>
                <ul className="mt-1 space-y-1">
                  {q2.map((a) => (
                    <li key={a.personKey} className="text-sm">
                      <span className="text-muted-foreground">{nameOf(a)}:</span> {a.answer}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
