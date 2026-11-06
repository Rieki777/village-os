/**
 * One list of requests, feedback, and Sera tasks.
 *
 * Each row opens the tab that already knows how to handle it. The kind of
 * list you were looking at stays in the address and on this device.
 */
import { useEffect, useState } from "react";
import { API_BASE, authHeaders } from "@/components/admin/adminApi";
import { storedText, writeStored } from "@/lib/safeStorage";
import { requestRow } from "./waitingWork";

export type InboxKind = "all" | "requests" | "feedback" | "sera";

export interface InboxItem {
  id: string;
  kind: Exclude<InboxKind, "all">;
  title: string;
  detail: string;
  next: string;
  tab: string;
}

const NEXT: Record<InboxItem["kind"], string> = {
  requests: "Open it and answer.",
  feedback: "Read it and say what you will do.",
  sera: "Open the Sera board and decide.",
};

export function inboxItem(kind: InboxItem["kind"], id: string, title: string, tab: string, detail = ""): InboxItem {
  return { id: `${kind}:${id}`, kind, title: title.trim() || "Untitled", detail, next: NEXT[kind], tab };
}

const VIEW_KEY = "admin.inboxView";

export function inboxViewFrom(search: string): InboxKind {
  const value = new URLSearchParams(search).get("inbox");
  if (value === "requests" || value === "feedback" || value === "sera" || value === "all") return value;
  const stored = storedText("local", VIEW_KEY);
  if (stored === "requests" || stored === "feedback" || stored === "sera" || stored === "all") return stored;
  return "all";
}

export function rememberInboxView(kind: InboxKind): void {
  writeStored("local", VIEW_KEY, kind);
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (kind === "all") params.delete("inbox");
  else params.set("inbox", kind);
  const query = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

export default function UnifiedInbox({ password, onOpen }: { password: string; onOpen: (tab: string) => void }) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [kind, setKind] = useState<InboxKind>(() => inboxViewFrom(window.location.search));
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let gone = false;
    Promise.all([
      fetch(`${API_BASE}/admin/submissions`, { headers: authHeaders(password) }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API_BASE}/admin/feedback`, { headers: authHeaders(password) }).then((r) => (r.ok ? r.json() : { items: [] })),
      fetch(`${API_BASE}/admin/member-tasks/bridge`, { headers: authHeaders(password) }).then((r) => (r.ok ? r.json() : { review: [] })),
    ]).then(([subs, feedback, bridge]) => {
      if (gone) return;
      const requests = (Array.isArray(subs) ? subs : []).slice(0, 30).map((s: { id?: string; type?: string; status?: string; submittedAt?: string; data?: { name?: string } }) => {
        const row = requestRow({ id: s.id, name: s.data?.name, type: s.type, status: s.status, submittedAt: s.submittedAt });
        return { ...inboxItem("requests", row.id, row.title, "submissions"), detail: row.detail, next: row.next };
      });
      const notes = (Array.isArray(feedback?.items) ? feedback.items : []).slice(0, 30).map((f: { id?: string; body?: string; message?: string }) =>
        inboxItem("feedback", String(f.id ?? ""), String(f.body || f.message || "A note"), "feedback"));
      const tasks = (Array.isArray(bridge?.review) ? bridge.review : []).slice(0, 30).map((t: { feedbackId?: string; title?: string }) =>
        inboxItem("sera", String(t.feedbackId ?? ""), String(t.title || "A Sera task"), "modules"));
      setItems([...requests, ...notes, ...tasks]);
    }).catch(() => { if (!gone) setProblem("The inbox did not load. Try again in a moment."); });
    return () => { gone = true; };
  }, [password]);

  const shown = items.filter((item) => kind === "all" || item.kind === kind);
  const choose = (next: InboxKind) => {
    setKind(next);
    rememberInboxView(next);
  };

  return (
    <section aria-label="Inbox" className="mt-4">
      <div className="flex flex-wrap gap-2">
        {(["all", "requests", "feedback", "sera"] as InboxKind[]).map((value) => (
          <button key={value} type="button" aria-pressed={kind === value} onClick={() => choose(value)} className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900">
            {value === "all" ? "All" : value === "requests" ? "Requests" : value === "feedback" ? "Feedback" : "Sera tasks"}
          </button>
        ))}
      </div>
      {problem && <p role="alert" className="mt-2 text-sm text-gray-900">{problem}</p>}
      <ul className="mt-3 space-y-2">
        {shown.length === 0 && !problem ? <li className="text-sm text-gray-700">Nothing in this view.</li> : shown.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => item.kind === "sera" ? window.location.assign("/modules/saberra") : onOpen(item.tab)} className="flex min-h-[44px] w-full flex-col items-start rounded-xl border border-gray-200 bg-white px-3 py-2 text-left">
              <span className="text-base font-medium text-gray-900">{item.title}</span>
              {item.detail ? <span className="text-sm text-gray-700">{item.detail}</span> : null}
              <span className="text-sm text-gray-700">{item.next}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
