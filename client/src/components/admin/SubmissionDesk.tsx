/**
 * The submissions toolbar: the filter, named views, and a bulk action.
 *
 * One reason and one note cover every selected request. The reason is posted
 * once per request to the handling route. Redirect does not delete.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { REDIRECT_CHOICES, REMOVE_CHOICES, SCREEN_REASON_WORDS, type ScreenReason } from "@shared/memberTaskFeedback";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import { FORM_TYPES, putSubmissionStatus } from "@/components/admin/submissionStatus";
import { readSavedViews, rememberView, type SavedView } from "./savedViews";
import { holdUndo } from "./adminUndo";

const TAP = "inline-flex min-h-[44px] items-center justify-center rounded-lg px-3 text-sm font-medium";

interface Row { id: string; type: string; data: Record<string, unknown> }

const PickContext = createContext<{ picked: Set<string>; toggle: (id: string) => void } | null>(null);

export function Pick({ id }: { id: string }) {
  const ctx = useContext(PickContext);
  if (!ctx) return null;
  return (
    <input
      type="checkbox"
      aria-label="Select this request"
      className="mt-3 h-11 w-11 shrink-0"
      checked={ctx.picked.has(id)}
      onClick={(e) => e.stopPropagation()}
      onChange={() => ctx.toggle(id)}
    />
  );
}

function prettyType(value: string) {
  return value.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function feedbackId(): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `fb-${id}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

export default function SubmissionDesk({
  password, filter, onFilter, rows, onChanged, children,
}: {
  password: string;
  filter: string;
  onFilter: (next: string) => void;
  rows: Row[];
  onChanged: () => void;
  children: ReactNode;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [views, setViews] = useState<SavedView[]>(() => readSavedViews());
  const [viewName, setViewName] = useState("");
  const [mode, setMode] = useState<"remove" | "redirect" | "done" | null>(null);
  const [reason, setReason] = useState<ScreenReason>("already_done");
  const [note, setNote] = useState("");
  const [to, setTo] = useState("");
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const chosen = new Set(picked);
  const targets = rows.filter((row) => chosen.has(row.id));

  useEffect(() => {
    let gone = false;
    fetch(`${API_BASE}/admin/submissions/hand-targets`, { headers: authHeaders(password) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (gone || !d) return;
        setPeople(Array.isArray(d.people) ? d.people : []);
        setRoles(Array.isArray(d.roles) ? d.roles : []);
      })
      .catch(() => {});
    return () => { gone = true; };
  }, [password]);

  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const run = async () => {
    if (busy || targets.length === 0) return;
    if (mode === "redirect" && !to) return;
    setBusy(true);
    setProblem(null);
    const [kind, who] = to.split(":");
    let done = 0;
    try {
      for (const row of targets) {
        const res = await fetch(`${API_BASE}/admin/submissions/${encodeURIComponent(row.id)}/handling`, {
          method: "POST",
          headers: authHeaders(password, { "Content-Type": "application/json" }),
          body: JSON.stringify({
            action: mode,
            feedbackId: feedbackId(),
            reason: mode === "done" ? null : reason,
            note: note.trim() || null,
            share: true,
            data: row.data,
            ...(mode === "redirect" ? (kind === "p" ? { toUserId: who } : { toRoleId: who }) : {}),
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(refusal(body, "That reason did not save. The rest were left as they were."));
        if (mode === "remove") {
          const removed = await fetch(`${API_BASE}/admin/submissions/${encodeURIComponent(row.id)}`, { method: "DELETE", headers: authHeaders(password) });
          if (!removed.ok) throw new Error("The reason was kept, and that request is still here.");
        } else {
          const status = mode === "done" ? "accepted" : "in-conversation";
          const moved = await putSubmissionStatus(password, row.id, status, row.type);
          if (!moved) throw new Error("The reason was kept, and that request is still here.");
        }
        done += 1;
      }
      setPicked([]);
      setMode(null);
      setNote("");
      onChanged();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "That did not finish.");
      if (done > 0) onChanged();
    }
    setBusy(false);
  };

  return (
    <PickContext.Provider value={{ picked: chosen, toggle }}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-900">Form Submissions</h2>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
          <select
            value={filter}
            onChange={(e) => onFilter(e.target.value)}
            aria-label="Form type"
            className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-gray-200 px-3 text-base text-gray-900 sm:flex-none sm:text-sm"
          >
            <option value="all">All types</option>
            {FORM_TYPES.map((t) => <option key={t} value={t}>{prettyType(t)}</option>)}
          </select>
          <button type="button" onClick={onChanged} aria-label="Look again for new submissions" className={`${TAP} border border-gray-200 bg-white text-gray-900`}>Look again</button>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-sm text-gray-700">
          <span className="sr-only">Name this view</span>
          <input value={viewName} maxLength={40} placeholder="Name this view" onChange={(e) => setViewName(e.target.value)} className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-base text-gray-900" />
        </label>
        <button
          type="button"
          className={`${TAP} border border-gray-300 bg-white text-gray-900`}
          onClick={() => { setViews(rememberView(viewName, filter)); setViewName(""); }}
        >
          Save this view
        </button>
        {views.map((view) => (
          <button key={view.name} type="button" className={`${TAP} border border-gray-200 bg-white text-gray-900`} onClick={() => onFilter(view.filter)}>
            {view.name}
          </button>
        ))}
      </div>
      {targets.length > 0 && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 max-sm:sticky max-sm:bottom-3 max-sm:z-30">
          <p className="text-sm text-gray-900">{targets.length} selected. The reason you pick applies to every form you selected.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={`${TAP} bg-teal-deep text-white`} onClick={() => setMode("done")}>Done</button>
            <button type="button" className={`${TAP} border border-gray-300 bg-white text-gray-900`} onClick={() => { setMode("remove"); setReason("already_done"); }}>Remove</button>
            <button type="button" className={`${TAP} border border-gray-300 bg-white text-gray-900`} onClick={() => { setMode("redirect"); setReason("better_for_someone_else"); }}>Redirect</button>
            <button type="button" className={`${TAP} admin-nowrap border border-gray-300 bg-white text-gray-900`} onClick={() => setPicked(rows.map((row) => row.id))}>Select all</button>
          </div>
          {mode && mode !== "done" && (
            <fieldset className="mt-3">
              <legend className="text-sm font-medium text-gray-900">{mode === "remove" ? "Why remove them?" : "Why hand them on?"}</legend>
              <div className="mt-2 flex flex-wrap gap-1">
                {(mode === "remove" ? REMOVE_CHOICES : REDIRECT_CHOICES).map((c) => (
                  <label key={c} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-900">
                    <input type="radio" name="bulk-why" value={c} checked={reason === c} onChange={() => setReason(c)} />
                    {SCREEN_REASON_WORDS[c]}
                  </label>
                ))}
              </div>
              {mode === "redirect" && (
                <label className="mt-2 block text-sm text-gray-700">
                  Who should have these?
                  <select className="mt-1 block min-h-[44px] w-full rounded-lg border border-gray-200 bg-white px-3 text-base text-gray-900" value={to} onChange={(e) => setTo(e.target.value)}>
                    <option value="">Choose a person or a role</option>
                    {people.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name || "A member"}</option>)}
                    {roles.map((r) => <option key={r.id} value={`r:${r.id}`}>{r.name}</option>)}
                  </select>
                </label>
              )}
              <label className="mt-2 block text-sm text-gray-700">
                A note, if you want one
                <textarea className="mt-1 block min-h-20 w-full rounded-lg border border-gray-200 px-3 py-2 text-base" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <p className="mt-2 text-sm text-gray-700">
                {mode === "remove" ? "This takes the selected requests out of the list." : "This keeps them and marks them in conversation. Nothing is deleted."}
              </p>
            </fieldset>
          )}
          {mode && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={`${TAP} bg-teal-deep text-white disabled:opacity-40`} disabled={busy || (mode === "redirect" && !to)} onClick={() => holdUndo(`Applying this to ${targets.length} requests.`, () => { void run(); })}>
                {mode === "done" ? "Mark them done" : mode === "remove" ? "Remove them" : "Hand them on"}
              </button>
              <button type="button" className={`${TAP} border border-gray-300 bg-white text-gray-900`} onClick={() => setMode(null)}>Cancel</button>
            </div>
          )}
          {problem && <p role="alert" className="mt-2 text-sm text-gray-900">{problem}</p>}
        </div>
      )}
      {children}
    </PickContext.Provider>
  );
}
