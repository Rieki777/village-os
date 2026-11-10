/**
 * AGENT ACCOUNTS AND THE PATHS OPEN TO THEM, on the Players tab (End of Moon
 * addendum v6, B6). Its own lazy chunk, so the tab's first page carries none
 * of it.
 *
 * Two things a person does here and an agent never can (the server refuses
 * an agent account both, and the connector never reaches them):
 *   - mark an account as an agent's, or as a person's again
 *   - change which admin paths an agent may call, and who confirms each write
 *
 * Light-only, like the rest of the admin tabs.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { API_BASE, authHeaders, refusal } from "./adminApi";
import type { Player } from "./PlayerCard";
import AiAgentsApprovalPanel from "./AiAgentsApprovalPanel";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
interface PathEntry { method: Method; path: string; confirm: "agent" | "person"; label: string }
interface PathsAnswer { document: { paths: PathEntry[] }; shipped: { paths: PathEntry[] }; edited: boolean; alwaysAPerson: Array<{ key: string; words: string }> }

const METHODS: readonly Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const field = "w-full rounded-md border border-border bg-white px-2 py-1 text-sm text-foreground";
const button = "min-h-9 rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium text-foreground";
const primary = "min-h-9 rounded-md bg-teal-deep px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60";

export default function AgentsPanel({ password, players }: { password: string; players: Player[] }) {
  const [agents, setAgents] = useState<string[] | null>(null);
  const [paths, setPaths] = useState<PathsAnswer | null>(null);
  const [draft, setDraft] = useState<PathEntry[]>([]);
  const [pick, setPick] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, p] = await Promise.all([
        fetch(`${API_BASE}/admin/agent-accounts`, { headers: authHeaders(password) }),
        fetch(`${API_BASE}/admin/agent-admin-paths`, { headers: authHeaders(password) }),
      ]);
      if (!a.ok || !p.ok) return;
      setAgents(((await a.json()) as { agents: string[] }).agents ?? []);
      const answer = (await p.json()) as PathsAnswer;
      setPaths(answer);
      setDraft(answer.document.paths.map((e) => ({ ...e })));
    } catch {
      setAgents(null);
    }
  }, [password]);

  useEffect(() => {
    void load();
  }, [load]);

  if (agents === null || paths === null) return null;

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? id;

  const mark = async (userId: string, isAgent: boolean) => {
    // Either way the account's tokens end, so the person is asked first.
    const ask = isAgent
      ? `Mark ${nameOf(userId)} as an agent account? Its tokens end, and it can hold no role from now on.`
      : `Mark ${nameOf(userId)} as a person's account again? Its agent tokens end, and it can hold roles again.`;
    if (!window.confirm(ask)) return;
    const r = await fetch(`${API_BASE}/admin/players/${encodeURIComponent(userId)}/agent`, {
      method: "PUT",
      headers: authHeaders(password, { "Content-Type": "application/json" }),
      body: JSON.stringify({ isAgent }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return toast.error(refusal(d, "That did not save."));
    toast.success(isAgent ? `${nameOf(userId)} is now an agent account.` : `${nameOf(userId)} is a person's account again.`);
    setPick("");
    void load();
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/admin/agent-admin-paths`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ document: { paths: draft } }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return toast.error(refusal(d, "That list did not save."));
      toast.success("Saved the agent paths.");
      void load();
    } finally {
      setSaving(false);
    }
  };

  const set = (i: number, patch: Partial<PathEntry>) => setDraft((all) => all.map((e, k) => (k === i ? { ...e, ...patch } : e)));
  const people = players.filter((p) => !agents.includes(p.id));

  return (
    <section aria-label="Agent accounts" className="mt-8 space-y-4 border-t border-border pt-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Agent accounts</h3>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          An agent account is held by software, such as an Operations agent working through the village connector. It holds no role, and what it may call as an admin is the list below. Only a person marks an account or changes the list.
        </p>
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-white p-4">
        {agents.length === 0 && <p className="text-sm text-muted-foreground">No account is marked as an agent's.</p>}
        {agents.map((id) => (
          <div key={id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-foreground">
              {nameOf(id)} <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-foreground">Agent</span>
            </span>
            <button type="button" className={button} onClick={() => void mark(id, false)}>Mark as a person's account</button>
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-2 pt-2">
          <label className="w-full text-sm text-foreground sm:w-auto">
            Account
            <select aria-label="Account to mark as an agent's" className={field} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="" />
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <button type="button" className={button} disabled={!pick} onClick={() => void mark(pick, true)}>Mark as an agent account</button>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-white p-4">
        <p className="text-sm font-semibold text-foreground">Admin paths an agent may call</p>
        <p className="text-sm text-muted-foreground">
          A path missing from this list stays closed to agents. For each write, say who confirms it: the agent itself, for routine Operations work, or a person, who makes the change in the app.
        </p>
        {draft.map((e, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[6rem_2fr_7rem_2fr_auto]">
            <select aria-label="Method" className={field} value={e.method} onChange={(x) => set(i, { method: x.target.value as Method })}>
              {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input aria-label="Path" className={field} value={e.path} onChange={(x) => set(i, { path: x.target.value })} />
            <select aria-label="Who confirms" className={field} value={e.confirm} onChange={(x) => set(i, { confirm: x.target.value as "agent" | "person" })}>
              <option value="agent">The agent</option>
              <option value="person">A person</option>
            </select>
            <input aria-label="What it is for" className={field} value={e.label} onChange={(x) => set(i, { label: x.target.value })} />
            <button type="button" className={button} onClick={() => setDraft((all) => all.filter((_, k) => k !== i))}>Remove</button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={() => setDraft((all) => [...all, { method: "GET", path: "/api/admin/", confirm: "person", label: "" }])}>Add a path</button>
          <button type="button" className={button} onClick={() => setDraft(paths.shipped.paths.map((e) => ({ ...e })))}>Back to the shipped list</button>
          <button type="button" className={primary} disabled={saving} onClick={() => void save()}>{saving ? "Saving" : "Save"}</button>
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Always a person, whatever this list says</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
            {paths.alwaysAPerson.map((r) => <li key={r.key}>{r.words}</li>)}
          </ul>
        </div>
      </div>
      <AiAgentsApprovalPanel password={password} />
    </section>
  );
}
