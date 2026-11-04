/**
 * SERA'S ACTIONS, ON THE BRIDGE PANEL (End of Moon addendum v6, B7).
 *
 * Every action Sera's agent took through the connector, newest first, each
 * with an Undo button for a steward. Undo works for 30 days and only while
 * nobody has touched what the action wrote; when it cannot, the server says
 * why and that sentence is shown. Its own lazy chunk.
 */
import { useCallback, useEffect, useState } from "react";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import { BTN_QUIET, HINT } from "@/components/sessions/roomUi";

interface Action { id: string; tool: string; subjectUserId: string | null; state: string; createdAt: string; undoneAt: string | null }

const TOOL_WORDS: Record<string, string> = {
  link_sera_person: "Linked a member to their Sera person",
  suggest_task: "Suggested a task",
  set_board_access: "Switched a task board",
  draft_agenda_item: "Drafted an agenda item",
  suggest_moon_item: "Suggested a moon item",
  undo_sera_action: "Undid an action",
};

export default function SeraActionsPanel({ password }: { password: string }) {
  const [actions, setActions] = useState<Action[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/admin/agent-actions?scope=sera.undoable&limit=50`, { headers: authHeaders(password) });
      if (!r.ok) return setActions(null);
      setActions(((await r.json()) as { actions: Action[] }).actions ?? []);
    } catch {
      setActions(null);
    }
  }, [password]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!actions || actions.length === 0) return null;

  const undo = async (id: string) => {
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/admin/agent-actions/${encodeURIComponent(id)}/undo`, { method: "POST", headers: authHeaders(password, { "Content-Type": "application/json" }), body: "{}" });
      const d = await r.json().catch(() => ({}));
      setNote(r.ok ? "Put back." : refusal(d, "That could not be put back."));
      void load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      <p className="text-sm font-semibold text-foreground">What Sera's agent did ({actions.length})</p>
      {note && <p role="status" className={HINT}>{note}</p>}
      <ul className="mt-1 space-y-1">
        {actions.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm text-foreground">
            <span className="min-w-0 flex-1">
              {TOOL_WORDS[a.tool] ?? a.tool} <span className={HINT}>{a.createdAt.slice(0, 10)}{a.state === "undone" ? ", undone" : a.state === "refused" ? ", refused" : ""}</span>
            </span>
            {a.state === "done" && a.tool !== "undo_sera_action" && (
              <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => void undo(a.id)}>Undo</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
