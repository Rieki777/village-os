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
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { API_BASE, authHeaders, refusal } from "./adminApi";
import type { Player } from "./PlayerCard";
import AiAgentsApprovalPanel from "./AiAgentsApprovalPanel";
import LetterDraftsPanel from "./LetterDraftsPanel";
import ApprovedWritesPanel from "./ApprovedWritesPanel";
import { PathTree } from "./AgentPathTree";
import { Trans, useLingui } from "@lingui/react/macro";
import { mergePastedAgentPaths, type PastedPathsPlan } from "@shared/agentAdmin";

/** The inbox is its own chunk: the tab's first page carries none of it. */
const ApprovalInbox = lazy(() => import("@/components/approvals/ApprovalInbox"));

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
interface PathEntry { method: Method; path: string; confirm: "agent" | "person"; label: string }
interface PathsAnswer {
  document: { paths: PathEntry[] };
  shipped: { paths: PathEntry[] };
  edited: boolean;
  alwaysAPerson: Array<{ key: string; words: string }>;
  /** The village's opt-in for lead-approved writes (shared/agentAdmin.ts); the save parser reads it. */
  leadApprovedWrites?: { on: boolean };
}

const METHODS: readonly Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const field = "w-full rounded-md border border-border bg-white px-2 py-1 text-sm text-foreground";
const button = "min-h-9 rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium text-foreground";
const primary = "min-h-9 rounded-md bg-teal-deep px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60";

export default function AgentsPanel({ password, players }: { password: string; players: Player[] }) {
  const { t } = useLingui();
  const [agents, setAgents] = useState<string[] | null>(null);
  const [paths, setPaths] = useState<PathsAnswer | null>(null);
  const [draft, setDraft] = useState<PathEntry[]>([]);
  const [pick, setPick] = useState("");
  const [saving, setSaving] = useState(false);
  // "Paste a list": the pasted text, and what it would do to the list on screen once read.
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [plan, setPlan] = useState<PastedPathsPlan | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  // The tree: rows added on this screen and not saved yet, and rows open for editing, by index in `draft`.
  const [fresh, setFresh] = useState<Set<number>>(() => new Set());
  const [editing, setEditing] = useState<Set<number>>(() => new Set());

  const resetDraft = (entries: readonly PathEntry[]) => {
    setDraft(entries.map((e) => ({ ...e })));
    setFresh(new Set());
    setEditing(new Set());
  };

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
      resetDraft(answer.document.paths);
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

  const readPasted = () => {
    const r = mergePastedAgentPaths(draft, pasted, { leadApprovedWrites: paths.leadApprovedWrites?.on === true });
    setPlan(r.ok ? r.plan : null);
    setPasteError(r.ok ? null : r.error);
  };

  const usePasted = () => {
    if (!plan) return;
    const from = draft.length;
    setDraft(plan.merged.map((e) => ({ ...e })) as PathEntry[]);
    // The pasted paths that are new sit under "New, not saved yet" until Save.
    setFresh((all) => {
      const next = new Set(all);
      for (let k = from; k < plan.merged.length; k++) next.add(k);
      return next;
    });
    setPlan(null);
    setPasted("");
    setPasteOpen(false);
  };

  const addedCount = plan?.added.length ?? 0;
  const changedCount = plan?.changed.length ?? 0;
  const sameCount = plan?.unchanged ?? 0;

  const set = (i: number, patch: Partial<PathEntry>) => setDraft((all) => all.map((e, k) => (k === i ? { ...e, ...patch } : e)));
  /** Indices after a removed row move up one. */
  const shift = (all: Set<number>, i: number) => new Set(Array.from(all).filter((k) => k !== i).map((k) => (k > i ? k - 1 : k)));
  const remove = (i: number) => {
    setDraft((all) => all.filter((_, k) => k !== i));
    setFresh((all) => shift(all, i));
    setEditing((all) => shift(all, i));
  };
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
          A path missing from this list stays closed to agents. The paths are grouped by the part of the village they reach; open a group to see, change or remove its paths. For each write, say who confirms it: the agent itself, for routine Operations work, or a person, who makes the change in the app.
        </p>
        <PathTree
          draft={draft}
          fresh={fresh}
          editing={editing}
          onEdit={(i) => setEditing((all) => new Set(all).add(i))}
          onDone={(i) =>
            setEditing((all) => {
              const next = new Set(all);
              next.delete(i);
              return next;
            })
          }
          onSet={set}
          onRemove={remove}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={button}
            onClick={() => {
              const at = draft.length;
              setDraft((all) => [...all, { method: "GET", path: "/api/admin/", confirm: "person", label: "" }]);
              setFresh((all) => new Set(all).add(at));
              setEditing((all) => new Set(all).add(at));
            }}
          >
            Add a path
          </button>
          <button type="button" className={button} aria-expanded={pasteOpen} onClick={() => setPasteOpen((o) => !o)}><Trans context="agent paths">Paste a list</Trans></button>
          <button type="button" className={button} onClick={() => resetDraft(paths.shipped.paths)}>Back to the shipped list</button>
          <button type="button" className={primary} disabled={saving} onClick={() => void save()}>{saving ? "Saving" : "Save"}</button>
        </div>
        {pasteOpen && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <label className="block text-sm text-foreground">
              <Trans>Paste the paths as JSON, in the shape the list saves: a paths list of method, path, confirm and label. Paths already on the list stay; a pasted one that is there already takes the pasted confirm and words.</Trans>
              <textarea
                aria-label={t({ message: "Pasted paths", context: "agent paths, the box a list is pasted into" })}
                className={`${field} mt-1 min-h-32 font-mono`}
                value={pasted}
                onChange={(x) => {
                  setPasted(x.target.value);
                  setPlan(null);
                  setPasteError(null);
                }}
              />
            </label>
            <button type="button" className={button} disabled={!pasted.trim()} onClick={readPasted}><Trans>Read the pasted list</Trans></button>
            {pasteError && <p role="alert" className="text-sm text-destructive">{pasteError}</p>}
            {plan && (
              <div className="space-y-2 text-sm text-foreground" aria-label={t`What the pasted list does`}>
                <p>
                  <Trans>Adds {addedCount}, changes {changedCount}, already there {sameCount}. Nothing is removed. Nothing is saved until you press Save.</Trans>
                </p>
                {plan.added.length > 0 && (
                  <ul className="list-disc pl-5">
                    {plan.added.map((e) => <li key={`a ${e.method} ${e.path}`}><Trans context="agent paths, a pasted path that is new">Adds</Trans> {e.method} {e.path} ({e.confirm === "agent" ? <Trans context="agent paths">the agent confirms</Trans> : <Trans context="agent paths">a person confirms</Trans>})</li>)}
                  </ul>
                )}
                {plan.changed.length > 0 && (
                  <ul className="list-disc pl-5">
                    {plan.changed.map((c) => <li key={`c ${c.after.method} ${c.after.path}`}><Trans context="agent paths, a pasted path that changes one already listed">Changes</Trans> {c.after.method} {c.after.path}: {c.before.confirm} {"->"} {c.after.confirm}, {c.after.label}</li>)}
                  </ul>
                )}
                <button type="button" className={button} onClick={usePasted}><Trans>Put these on the list</Trans></button>
              </div>
            )}
          </div>
        )}
        <div>
          <p className="text-sm font-medium text-foreground">Always a person, whatever this list says</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
            {paths.alwaysAPerson.map((r) => <li key={r.key}>{r.words}</li>)}
          </ul>
        </div>
      </div>
      <ApprovedWritesPanel password={password} />
      <AiAgentsApprovalPanel password={password} />
      <LetterDraftsPanel password={password} />
      <a href="/admin/proposals" className="inline-flex min-h-11 items-center text-sm text-teal-deep underline">
        <Trans context="proposed changes">Proposed changes: review, edit and accept what agents propose</Trans>
      </a>
      <div className="space-y-3 rounded-xl border border-border bg-white p-4">
        <p className="text-sm font-semibold text-foreground"><Trans context="approval inbox">Approval inbox</Trans></p>
        <a href="/approvals" className="inline-flex min-h-9 items-center text-sm text-teal-deep underline"><Trans>Open it on its own page</Trans></a>
        <Suspense fallback={null}>
          <ApprovalInbox headers={() => authHeaders(password, { "Content-Type": "application/json" })} />
        </Suspense>
      </div>
    </section>
  );
}
