/**
 * STEWARD: bring one member's tasks in from the knowledge library
 * ("Your list", PR 3).
 *
 * Paste what the library's list_voice_tasks answered for that person, pick the
 * member, and press Dry run. Nothing is written until the dry run has been read
 * and "Import for real" is pressed with the same inputs. A rerun never
 * overwrites the member's edits, and never brings back a task they removed or
 * finished. Every real run has a batch id, and "Undo this import" removes the
 * whole batch (restorable for 30 days).
 */
import { useState } from "react";
import { DEFAULT_IMPORT_PHRASE } from "@shared/memberTaskFeedback";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, HINT, LABEL_CAPS } from "@/components/sessions/roomUi";
import type { PanelPerson } from "./PersonalListsPanel";

interface Summary {
  dryRun: boolean;
  counts: Record<string, number>;
  firstTitles: string[];
  flagged: { externalId: string; title: string }[];
  needsOwner: { externalId: string; title: string }[];
  batch?: string;
  created?: number;
  updated?: number;
  queued?: number;
  listOn?: boolean;
}

const FIELD = "mt-1 block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-foreground";

export default function LibraryImportPanel({ password, players }: { password: string; players: PanelPerson[] }) {
  const [userId, setUserId] = useState("");
  const [owner, setOwner] = useState("");
  const [pasted, setPasted] = useState("");
  const [phrase, setPhrase] = useState(DEFAULT_IMPORT_PHRASE);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dry, setDry] = useState<{ key: string; summary: Summary } | null>(null);
  const [done, setDone] = useState<Summary | null>(null);
  const [undone, setUndone] = useState<number | null>(null);

  const key = `${userId}|${owner}|${pasted}|${phrase}`;

  const send = async (dryRun: boolean) => {
    setProblem(null);
    // Nothing pasted: read straight from the library, filtered by the evidence phrase.
    const pull = !pasted.trim();
    let answer: unknown = null;
    if (!pull) {
      try {
        answer = JSON.parse(pasted);
      } catch {
        setProblem("That is not JSON. Paste the library's answer as it came, or leave it empty to read from the library.");
        return;
      }
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/admin/member-tasks/import`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify(pull ? { userId, seraOwnerId: owner.trim(), pull: true, evidenceContains: phrase.trim(), dryRun } : { userId, seraOwnerId: owner.trim(), answer, dryRun }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setProblem(refusal(data, "That did not run."));
      else if (dryRun) setDry({ key, summary: data as Summary });
      else {
        setDone(data as Summary);
        setDry(null);
      }
    } catch {
      setProblem("Could not reach the village.");
    }
    setBusy(false);
  };

  const undoBatch = async (batch: string) => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/admin/member-tasks/import/${encodeURIComponent(batch)}/remove`, { method: "POST", headers: authHeaders(password) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setProblem(refusal(data, "That did not undo."));
      else setUndone(Number(data.removed ?? 0));
    } catch {
      setProblem("Could not reach the village.");
    }
    setBusy(false);
  };

  const s = dry?.summary;
  const fresh = dry && dry.key === key;

  return (
    <div className="mt-5 border-t border-border pt-4">
      <h4 className="font-semibold text-foreground">Bring in tasks from the knowledge library</h4>
      <p className={`${HINT} mt-1`}>A dry run first. Nothing is written until you read it and press Import for real.</p>
      <label className="mt-3 block">
        <span className={LABEL_CAPS}>Member</span>
        <select className={FIELD} value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Choose a member</option>
          {players.map((p) => <option key={p.id} value={p.id}>{p.name || p.email || p.id}</option>)}
        </select>
      </label>
      <label className="mt-3 block">
        <span className={LABEL_CAPS}>Their owner id in the library</span>
        <input className={FIELD} value={owner} onChange={(e) => setOwner(e.target.value)} />
      </label>
      <label className="mt-3 block">
        <span className={LABEL_CAPS}>Only tasks whose evidence contains</span>
        <input className={FIELD} value={phrase} onChange={(e) => setPhrase(e.target.value)} />
      </label>
      <label className="mt-3 block">
        <span className={LABEL_CAPS}>The library's answer (JSON, optional: leave empty to read from the library)</span>
        <textarea className={`${FIELD} min-h-32 py-2 font-mono text-xs`} value={pasted} onChange={(e) => setPasted(e.target.value)} />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={BTN_SECONDARY} disabled={busy || !userId || !owner.trim() || (!pasted.trim() && !phrase.trim())} onClick={() => send(true)}>Dry run</button>
        {fresh && (
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => send(false)}>Import for real</button>
        )}
      </div>
      {problem && <p role="alert" className="mt-2 text-sm text-foreground">{problem}</p>}
      {s && (
        <div className="mt-3 text-sm text-foreground" role="status">
          <p>
            Dry run: {s.counts.create} new, {s.counts.update} refreshed, {s.counts.keptEdits} kept as the member edited them,{" "}
            {s.counts.tombstoned} already removed or done, {s.counts.skipped} skipped, {s.counts.needsOwner} need an owner,{" "}
            {s.counts.flagged} with an unknown priority.
          </p>
          {s.firstTitles.length > 0 && (
            <ol className="mt-1 list-decimal pl-5">{s.firstTitles.map((t, i) => <li key={i}>{t}</li>)}</ol>
          )}
          {s.flagged.length > 0 && <p className={`${HINT} mt-1`}>Unknown priority, set to Priority: {s.flagged.map((f) => f.title).join("; ")}</p>}
          {s.needsOwner.length > 0 && <p className={`${HINT} mt-1`}>Waiting for an owner: {s.needsOwner.map((f) => f.title).join("; ")}</p>}
        </div>
      )}
      {done?.batch && (
        <div className="mt-3 text-sm text-foreground" role="status">
          <p>
            Imported: {done.created} new, {done.updated} refreshed, {done.queued} queued for an owner. Batch {done.batch}.
            {done.listOn === false ? " Their list is still off; turn it on above." : ""}
          </p>
          {undone === null ? (
            <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => undoBatch(done.batch!)}>Undo this import</button>
          ) : (
            <p className={HINT}>Removed {undone} from their list. They can be brought back for 30 days.</p>
          )}
        </div>
      )}
    </div>
  );
}
