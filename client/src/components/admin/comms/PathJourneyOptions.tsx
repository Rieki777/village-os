/**
 * A PATH JOURNEY'S OWN PANEL on the Journeys screen (the comms build spec
 * 5.11): why it is held, if it is; how many walk the path and how many of
 * them were already on it when email arrived; and the two choices only a path
 * journey has, both off until somebody turns them on:
 *
 *   - include people already on this path (the backfill): they are walked
 *     through the journey from now;
 *   - rung emails: a move up the path's ladder sends one short email with
 *     the next step.
 *
 * The routes are server/routes/commsPaths.ts. Draws nothing for a journey
 * that is not a path's.
 *
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
import { useCallback, useEffect, useState } from "react";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";

interface PathView {
  key: string;
  pathId: string;
  includeExisting: boolean;
  rungEmails: boolean;
  rungsAvailable: boolean;
  held: string | null;
  people: { active: number; backfilled: number };
  started?: number;
}

export default function PathJourneyOptions({ password, journeyKey, onChanged }: { password: string; journeyKey: string; onChanged?: () => void }) {
  const isPath = journeyKey.startsWith("path.");
  const [view, setView] = useState<PathView | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isPath) return;
    const res = await fetch(`${API_BASE}/admin/comms/paths/${encodeURIComponent(journeyKey)}`, { headers: authHeaders(password) });
    const body = await res.json().catch(() => null);
    if (!res.ok) return setError(refusal(body, `This path could not be read (${res.status}).`));
    setError("");
    setView(body as PathView);
  }, [password, journeyKey, isPath]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isPath) return null;
  if (error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!view) return null;

  const change = async (patch: Partial<Pick<PathView, "includeExisting" | "rungEmails">>, done: string) => {
    setBusy(true);
    setNote("");
    const res = await fetch(`${API_BASE}/admin/comms/paths/${encodeURIComponent(journeyKey)}`, {
      method: "PUT",
      headers: authHeaders(password, { "Content-Type": "application/json" }),
      body: JSON.stringify(patch),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) return setNote(refusal(body, `That did not save (${res.status}).`));
    setView(body as PathView);
    const started = Number(body?.started ?? 0);
    setNote(started > 0 ? `${done} ${started} ${started === 1 ? "person starts" : "people start"} the journey now.` : done);
    onChanged?.();
  };

  const box = "rounded-lg border border-gray-200 bg-white p-3";
  return (
    <section aria-label="This path" className="space-y-3">
      <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">This path</h4>
      {view.held && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{view.held}</p>}
      <p className="text-sm text-gray-600">
        {view.people.active} on this path now. {view.people.backfilled} of them were on it before email arrived.
      </p>
      <div className={box}>
        <label className="flex items-start gap-3 text-sm text-gray-900">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={view.includeExisting}
            disabled={busy}
            onChange={(e) => change({ includeExisting: e.target.checked }, e.target.checked ? "Included." : "Saved.")}
          />
          <span>
            Include people already on this path
            <span className="block text-xs text-gray-500">
              Off: only people who join from now get these emails. On: the {view.people.backfilled} already on it start from the welcome. Turning it
              off later stops nobody who has started.
            </span>
          </span>
        </label>
      </div>
      {view.rungsAvailable && (
        <div className={box}>
          <label className="flex items-start gap-3 text-sm text-gray-900">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={view.rungEmails}
              disabled={busy}
              onChange={(e) => change({ rungEmails: e.target.checked }, "Saved.")}
            />
            <span>
              Rung emails
              <span className="block text-xs text-gray-500">
                When a member moves up this path's ladder, one short email names the step they reached and the next one. Checked hourly, sent in daytime
                where they are.
              </span>
            </span>
          </label>
        </div>
      )}
      {note && <p className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700">{note}</p>}
    </section>
  );
}
