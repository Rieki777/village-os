/**
 * Who came, for the host (the comms build spec 5.9): tick each person who
 * came, or press "Everyone who said yes came". Marks decide which recap each
 * person gets, so a person left unticked after a save reads as missed.
 *
 * Asks `/api/events/:id/attendance`, which answers `{ manage: false }` to
 * anybody without `event.manage`; then this renders nothing. Names only, and
 * a guest carries "guest" beside theirs.
 *
 * Member page: semantic theme tokens, never numbered grays.
 */
import { useCallback, useEffect, useState } from "react";
import type { AttendanceView } from "@shared/comms/recap";
import { authToken } from "@/lib/gameApi";

// The Authorization header is attached HERE, in this declaration, so the auth
// guard (scripts/check-auth-fetch.mjs) reads it one helper deep.
const headers = (): Record<string, string> => {
  const t = authToken();
  return { ...(t ? { Authorization: `Bearer ${t}` } : {}), "Content-Type": "application/json" };
};

type Answer = AttendanceView | { manage: false };

export default function AttendanceList({
  eventId,
  occurrenceKey,
  onSaved,
}: {
  eventId: string;
  occurrenceKey: string;
  onSaved?: () => void;
}) {
  const [view, setView] = useState<AttendanceView | null>(null);
  const [came, setCame] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const url = `/api/events/${encodeURIComponent(eventId)}/attendance`;

  const take = (v: AttendanceView) => {
    setView(v);
    const ticks: Record<string, boolean> = {};
    for (const p of v.people) ticks[p.personKey] = p.mark === "came";
    setCame(ticks);
  };

  const load = useCallback(() => {
    fetch(`${url}?occurrence=${encodeURIComponent(occurrenceKey)}`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((a: Answer) => {
        if (a.manage) take(a);
      })
      .catch(() => setView(null));
  }, [url, occurrenceKey]);

  useEffect(load, [load]);

  if (!view) return null;

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(url, { method: "POST", headers: headers(), body: JSON.stringify({ occurrenceKey, ...body }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) setNote(String(out?.error ?? "That didn't save. Try again."));
      else {
        take(out as AttendanceView);
        setNote("Saved.");
        onSaved?.();
      }
    } catch {
      setNote("That didn't save. Try again.");
    }
    setBusy(false);
  };

  const people = view.people.filter((p) => p.answer !== "declined");

  return (
    <section aria-label="Who came" className="space-y-2">
      <h4 className="text-sm font-semibold text-foreground">Who came</h4>
      {!view.started && <p className="text-xs text-muted-foreground">Opens once the gathering begins.</p>}
      {people.length === 0 && <p className="text-xs text-muted-foreground">Nobody said yes to this one.</p>}
      {people.length > 0 && (
        <ul className="space-y-1">
          {people.map((p) => (
            <li key={p.personKey}>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={Boolean(came[p.personKey])}
                  disabled={!view.started || busy}
                  onChange={(e) => setCame((c) => ({ ...c, [p.personKey]: e.target.checked }))}
                />
                <span>{p.name ?? (p.guest ? "A guest" : "A member who has since left")}</span>
                {p.guest && <span className="text-xs text-muted-foreground">guest</span>}
                {p.answer === "maybe" && <span className="text-xs text-muted-foreground">said maybe</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      {view.started && people.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              save({ marks: people.map((p) => ({ personKey: p.personKey, status: came[p.personKey] ? "came" : "missed" })) })
            }
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-deep text-white border border-teal-deep hover:bg-teal-deep-dark disabled:opacity-40"
          >
            Save who came
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => save({ everyone: true })}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-background text-foreground hover:bg-muted disabled:opacity-40"
          >
            Everyone who said yes came
          </button>
          {note && (
            <span role="status" className="text-xs text-muted-foreground">
              {note}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
