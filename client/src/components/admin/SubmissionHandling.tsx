/**
 * Remove, Redirect and Done on one form submission.
 *
 * Remove and Redirect ask for a reason and an optional note. The reason is
 * kept here, and it is sent to Sera when telling Sera is on and the request
 * is one of Sera's tasks. Redirect does not delete the request. The count of
 * what this device handled stays in the browser.
 */
import { useEffect, useState } from "react";
import { REDIRECT_CHOICES, REMOVE_CHOICES, SCREEN_REASON_WORDS, type ScreenReason } from "@shared/memberTaskFeedback";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import { putSubmissionStatus } from "@/components/admin/submissionStatus";
import { storedText, writeStored } from "@/lib/safeStorage";

const TAP = "inline-flex min-h-[44px] items-center justify-center rounded-lg px-3 text-sm font-medium";
const FIELD = "mt-1 block min-h-[44px] w-full rounded-lg border border-gray-200 bg-white px-3 text-base text-gray-900";

interface Row {
  id: string;
  type: string;
  data: Record<string, unknown>;
  status?: string;
}

function rememberHandled() {
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  let count = 1;
  try {
    const parsed = JSON.parse(storedText("local", "admin.handledToday") || "null") as { day?: string; count?: number } | null;
    if (parsed && parsed.day === day && typeof parsed.count === "number" && parsed.count > 0) count = Math.floor(parsed.count) + 1;
  } catch { /* a broken value starts again at one */ }
  writeStored("local", "admin.handledToday", JSON.stringify({ day, count }));
  window.dispatchEvent(new CustomEvent("admin:handled"));
}

function feedbackId(): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `fb-${id}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

export default function SubmissionHandling({
  password, submission, onChanged,
}: {
  password: string;
  submission: Row;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"remove" | "redirect" | null>(null);
  const [reason, setReason] = useState<ScreenReason>("already_done");
  const [note, setNote] = useState("");
  const [to, setTo] = useState("");
  const [share, setShare] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [targets, setTargets] = useState<{ people: { id: string; name: string }[]; roles: { id: string; name: string }[] }>({ people: [], roles: [] });

  useEffect(() => {
    let gone = false;
    fetch(`${API_BASE}/member-tasks/me/feedback`, { headers: authHeaders(password) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!gone && d && typeof d.on === "boolean") setShare(d.on); })
      .catch(() => {});
    fetch(`${API_BASE}/admin/submissions/hand-targets`, { headers: authHeaders(password) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (gone || !d) return;
        setTargets({
          people: Array.isArray(d.people) ? d.people : [],
          roles: Array.isArray(d.roles) ? d.roles : [],
        });
      })
      .catch(() => {});
    return () => { gone = true; };
  }, [password]);

  const choices = mode === "redirect" ? REDIRECT_CHOICES : REMOVE_CHOICES;
  const ready = mode === "remove" || (mode === "redirect" && !!to);

  const postReason = async (action: "remove" | "redirect" | "done", extra: Record<string, unknown> = {}) => {
    const res = await fetch(`${API_BASE}/admin/submissions/${encodeURIComponent(submission.id)}/handling`, {
      method: "POST",
      headers: authHeaders(password, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        action,
        feedbackId: feedbackId(),
        reason: action === "done" ? null : reason,
        note: note.trim() || null,
        share,
        data: submission.data,
        ...extra,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(refusal(data, "That reason did not save. Nothing was changed."));
    return data as { sentence?: string };
  };

  const finish = async (action: "remove" | "redirect" | "done") => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const [kind, id] = to.split(":");
      const saved = await postReason(action, action === "redirect" ? (kind === "p" ? { toUserId: id } : { toRoleId: id }) : {});
      if (action === "remove") {
        const res = await fetch(`${API_BASE}/admin/submissions/${encodeURIComponent(submission.id)}`, { method: "DELETE", headers: authHeaders(password) });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(refusal(body, "The reason was kept, and the request is still here."));
        }
      } else {
        const status = action === "done" ? "accepted" : "in-conversation";
        const moved = await putSubmissionStatus(password, submission.id, status, submission.type);
        if (!moved) throw new Error("The reason was kept, and the request is still here.");
      }
      rememberHandled();
      setMode(null);
      setNote("");
      if (saved.sentence) setProblem(saved.sentence);
      onChanged();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "That did not save. Nothing was changed.");
    }
    setBusy(false);
  };

  const flipShare = async () => {
    const next = !share;
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(`${API_BASE}/member-tasks/me/feedback`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ on: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(refusal(data, "That switch did not save."));
      setShare(Boolean(data.on));
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "That switch did not save.");
    }
    setBusy(false);
  };

  return (
    <div className="border-t border-gray-100 px-4 py-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`${TAP} bg-teal-deep text-white`} disabled={busy} onClick={() => void finish("done")}>Done</button>
        <button type="button" className={`${TAP} border border-gray-300 bg-white text-gray-900`} aria-expanded={mode === "remove"} disabled={busy} onClick={() => { setMode(mode === "remove" ? null : "remove"); setReason("already_done"); }}>Remove</button>
        <button type="button" className={`${TAP} border border-gray-300 bg-white text-gray-900`} aria-expanded={mode === "redirect"} disabled={busy} onClick={() => { setMode(mode === "redirect" ? null : "redirect"); setReason("better_for_someone_else"); }}>Redirect</button>
      </div>
      {mode && (
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-50 max-sm:mt-0 max-sm:rounded-b-none max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
          <fieldset>
            <legend className="text-sm font-medium text-gray-900">{mode === "remove" ? "Why remove it?" : "Why hand it on?"}</legend>
            <div className="mt-2 flex flex-wrap gap-1">
              {choices.map((c) => (
                <label key={c} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-900">
                  <input type="radio" name={`why-${submission.id}`} value={c} checked={reason === c} onChange={() => setReason(c)} />
                  {SCREEN_REASON_WORDS[c]}
                </label>
              ))}
            </div>
          </fieldset>
          {mode === "redirect" && (
            <label className="mt-2 block text-sm text-gray-700">
              Who should have this?
              {targets.people.length === 0 && targets.roles.length === 0 && (
                <p className="mt-1 text-sm text-gray-700">No one is available to hand this to yet.</p>
              )}
              <select className={FIELD} value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Choose a person or a role</option>
                {targets.people.length > 0 && (
                  <optgroup label="A person">
                    {targets.people.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name || "A member"}</option>)}
                  </optgroup>
                )}
                {targets.roles.length > 0 && (
                  <optgroup label="A role">
                    {targets.roles.map((r) => <option key={r.id} value={`r:${r.id}`}>{r.name}</option>)}
                  </optgroup>
                )}
              </select>
            </label>
          )}
          <label className="mt-2 block text-sm text-gray-700">
            A note, if you want one
            <textarea className={`${FIELD} min-h-20 py-2`} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <p className="mt-2 text-sm text-gray-700">
            {mode === "remove"
              ? "This takes the request out of the list. The reason stays here."
              : "This keeps the request and marks it in conversation. Nothing is deleted."}
            {" "}
            {share ? "Sera is told when this is one of Sera's tasks." : "Sera is not told."}
          </p>
          <label className="mt-2 flex min-h-[44px] items-center gap-2 text-sm text-gray-900">
            <input type="checkbox" checked={share} disabled={busy} onChange={() => void flipShare()} />
            Tell Sera, so it can learn from this reason
          </label>
          {problem && <p role="status" className="mt-2 text-sm text-gray-900">{problem}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={`${TAP} bg-teal-deep text-white disabled:opacity-40`} disabled={busy || !ready} onClick={() => void finish(mode)}>
              {mode === "remove" ? "Remove it" : "Hand it on"}
            </button>
            <button type="button" className={`${TAP} border border-gray-300 bg-white text-gray-900`} onClick={() => setMode(null)}>Cancel</button>
          </div>
        </div>
      )}
      {!mode && problem && <p role="status" className="mt-2 text-sm text-gray-900">{problem}</p>}
    </div>
  );
}
