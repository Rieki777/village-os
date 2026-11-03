/**
 * STEWARD: whose personal task list is on ("Your list", PR 2).
 *
 * Each member's list starts off. A steward turns it on here, one member at a
 * time, and it appears on that member's profile under their task board. The
 * switch waits for the server's answer before it shows the new state.
 *
 * This panel reads ids and names only. A member's tasks, and any journal words
 * a task carries, are never shown here.
 */
import { useCallback, useEffect, useState } from "react";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import LibraryImportPanel from "./LibraryImportPanel";
import { BTN_SECONDARY, HINT, LABEL_CAPS, PANEL } from "@/components/sessions/roomUi";

export interface PanelPerson {
  id: string;
  name?: string | null;
  email?: string | null;
}

export default function PersonalListsPanel({ password, players }: { password: string; players: PanelPerson[] }) {
  const [on, setOn] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/member-tasks/access`, { headers: authHeaders(password) });
      const data = await res.json().catch(() => ({}));
      setOn(res.ok && Array.isArray(data.on) ? data.on.map(String) : []);
      if (!res.ok) setProblem(refusal(data, "Could not read whose lists are on."));
    } catch {
      setOn([]);
      setProblem("Could not reach the village.");
    }
  }, [password]);
  useEffect(() => { void load(); }, [load]);

  const flip = async (id: string, next: boolean) => {
    setBusy(id);
    setProblem(null);
    try {
      const res = await fetch(`${API_BASE}/admin/member-tasks/access/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ on: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setProblem(refusal(data, "That did not save."));
    } catch {
      setProblem("Could not reach the village.");
    }
    setBusy(null);
    await load();
  };

  const q = query.trim().toLowerCase();
  const people = players.filter((p) => !q || `${p.name ?? ""} ${p.email ?? ""}`.toLowerCase().includes(q));
  const onSet = new Set(on ?? []);

  return (
    <section className={`${PANEL} mb-4`} aria-labelledby="personal-lists-h">
      <h3 id="personal-lists-h" className="text-lg font-semibold text-foreground">Personal task lists</h3>
      <p className={`${HINT} mt-1`}>
        Turn on Your list for a member. It shows on their profile under their task board. You never see their tasks here.
      </p>
      <p className={`${HINT} mt-1`}>{on === null ? "Reading..." : `${onSet.size} on`}</p>
      <label className="mt-3 block">
        <span className={LABEL_CAPS}>Find a member</span>
        <input
          className="mt-1 block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-foreground"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name or email"
        />
      </label>
      {problem && <p role="alert" className="mt-2 text-sm text-foreground">{problem}</p>}
      {q && (
        <ul className="mt-3 space-y-2">
          {people.slice(0, 12).map((p) => {
            const isOn = onSet.has(p.id);
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-foreground">
                  {p.name || p.email || p.id}
                  <span className={`${HINT} ml-2`}>{isOn ? "List on" : "List off"}</span>
                </span>
                <button type="button" className={BTN_SECONDARY} disabled={busy === p.id || on === null} onClick={() => flip(p.id, !isOn)}>
                  {isOn ? "Turn off" : "Turn on"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <LibraryImportPanel password={password} players={players} />
    </section>
  );
}
