/**
 * Before a steward erases a member: export their tasks (the village's own
 * copy, a file for the steward, nothing sent anywhere) and, separately, remove
 * their tasks in Sera. The Sera step is a dry run first that shows a count;
 * only a second, explicit press asks Sera to archive them. Run both BEFORE the
 * erasure itself, which forgets the member's link to Sera.
 */
import { useState } from "react";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import { BTN_PRIMARY, BTN_SECONDARY, HINT, LABEL_CAPS } from "@/components/sessions/roomUi";
import type { PanelPerson } from "./PersonalListsPanel";

const FIELD = "mt-1 block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-foreground";

export default function ErasePrepPanel({ password, players, initialUserId = "", onContinue, onCancel }: {
  password: string;
  players: PanelPerson[];
  initialUserId?: string;
  /** Players tab: the steward has done the steps and goes on to delete the account. */
  onContinue?: () => void;
  onCancel?: () => void;
}) {
  const [userId, setUserId] = useState(initialUserId);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [dry, setDry] = useState<{ userId: string; count: number; code: string } | null>(null);

  const exportTasks = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/admin/member-tasks/${encodeURIComponent(userId)}/export`, { headers: authHeaders(password) });
      if (!res.ok) setMsg(refusal(await res.json().catch(() => ({})), "The export did not run."));
      else {
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = `member-tasks-${userId}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setMsg("Downloaded. Private detail stays out of a steward's file.");
      }
    } catch {
      setMsg("Could not reach the village.");
    }
    setBusy(false);
  };

  const hardDelete = async (confirm: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/admin/member-tasks/${encodeURIComponent(userId)}/sera-hard-delete`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify(confirm && dry ? { confirm: true, code: dry.code } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(refusal(data, "Sera did not answer."));
      else if (data.dryRun) setDry({ userId, count: Number(data.count ?? 0), code: String(data.code ?? "") });
      else {
        setDry(null);
        setMsg(`Sera archived ${Number(data.count ?? 0)} task(s).`);
      }
    } catch {
      setMsg("Could not reach the village.");
    }
    setBusy(false);
  };

  return (
    <div className="mt-5 border-t border-border pt-4">
      <h4 className="font-semibold text-foreground">Before you erase a member</h4>
      <p className={`${HINT} mt-1`}>Do these first: erasing a member forgets their link to Sera.</p>
      <label className="mt-2 block">
        <span className={LABEL_CAPS}>Member</span>
        <select className={FIELD} value={userId} onChange={(e) => { setUserId(e.target.value); setDry(null); setMsg(null); }}>
          <option value="">Choose a member</option>
          {players.map((p) => <option key={p.id} value={p.id}>{p.name || p.email || p.id}</option>)}
        </select>
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={BTN_SECONDARY} disabled={busy || !userId} onClick={exportTasks}>Export their tasks</button>
        <button type="button" className={BTN_SECONDARY} disabled={busy || !userId} onClick={() => hardDelete(false)}>Also remove their tasks in Sera (dry run)</button>
      </div>
      {dry && dry.userId === userId && (
        <div className="mt-2 text-sm text-foreground" role="status">
          <p>Sera holds {dry.count} task(s) for this member. Nothing has changed yet.</p>
          <button type="button" className={`${BTN_PRIMARY} mt-1`} disabled={busy || dry.count === 0} onClick={() => hardDelete(true)}>
            Yes, archive these {dry.count} in Sera
          </button>
        </div>
      )}
      {msg && <p role="alert" className="mt-2 text-sm text-foreground">{msg}</p>}
      {(onContinue || onCancel) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {onContinue && <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={onContinue}>Go on to delete the account</button>}
          {onCancel && <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={onCancel}>Not now</button>}
        </div>
      )}
    </div>
  );
}
