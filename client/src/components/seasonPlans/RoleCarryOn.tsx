/**
 * "Carry on into the next moon?" and the state of the access a role comes with.
 *
 * Shown on the member's own season page. A role that runs by the moon asks in
 * its last week; the holder says what they will contribute next moon and files
 * it. Nothing renews until one holder of the power to fill roles renews every
 * filed role. Below it, each access item of the holder's roles and where it
 * stands. This component never shows or stores a credential.
 */
import { useCallback, useEffect, useState } from "react";
import { authToken } from "@/lib/gameApi";
import { CARRY_ON_QUESTION, CONTRIBUTION_MAX } from "@shared/moonRenewal";

interface Card {
  assignmentId: string;
  roleName: string;
  termEndsAt: string;
  nextTermEndsAt: string;
  filed: boolean;
  contribution: string | null;
}
interface AccessItem {
  id: string;
  label: string;
  state: "open" | "done" | "not_needed";
}

const STATE_WORDS: Record<AccessItem["state"], string> = { open: "Waiting to be given", done: "Given", not_needed: "Not needed" };

const hdrs = (): Record<string, string> => {
  const t = authToken();
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
};
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" });

export default function RoleCarryOn() {
  const [cards, setCards] = useState<Card[]>([]);
  const [items, setItems] = useState<AccessItem[]>([]);
  const [words, setWords] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  // Only a holder of the power to fill roles is answered; for everyone else this stays null.
  const [filedCount, setFiledCount] = useState<number | null>(null);
  const [todo, setTodo] = useState<Array<{ id: string; kind: "grant" | "revoke"; label: string }>>([]);
  const [renewedNote, setRenewedNote] = useState("");

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        fetch("/api/me/role-renewals", { headers: hdrs() }).then((r) => (r.ok ? r.json() : { cards: [] })),
        fetch("/api/me/role-access", { headers: hdrs() }).then((r) => (r.ok ? r.json() : { items: [] })),
      ]);
      setCards(Array.isArray(a.cards) ? a.cards : []);
      setItems(Array.isArray(b.items) ? b.items : []);
      const t = await fetch("/api/role-access-tasks", { headers: hdrs() });
      setTodo(t.ok ? ((await t.json()).tasks ?? []) : []);
      const c = await fetch("/api/admin/role-renewals", { headers: hdrs() });
      setFiledCount(c.ok ? ((await c.json()).filed ?? []).length : null);
    } catch {
      /* Nothing to show is a fine answer. */
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function file(c: Card) {
    setError("");
    const res = await fetch("/api/me/role-renewals", {
      method: "POST",
      headers: hdrs(),
      body: JSON.stringify({ assignmentId: c.assignmentId, contribution: words[c.assignmentId] ?? c.contribution ?? "" }),
    });
    if (!res.ok) setError((await res.json().catch(() => null))?.error ?? "That did not save. Try again.");
    await load();
  }
  async function takeBack(c: Card) {
    await fetch(`/api/me/role-renewals/${encodeURIComponent(c.assignmentId)}`, { method: "DELETE", headers: hdrs() });
    await load();
  }

  async function mark(id: string, state: "done" | "not_needed") {
    await fetch(`/api/role-access-tasks/${encodeURIComponent(id)}`, { method: "POST", headers: hdrs(), body: JSON.stringify({ state }) });
    await load();
  }

  async function renewAll() {
    setError("");
    const res = await fetch("/api/admin/role-renewals/renew-all", { method: "POST", headers: hdrs(), body: "{}" });
    const out = await res.json().catch(() => null);
    if (!res.ok) setError(out?.error ?? "That did not work. Try again.");
    else setRenewedNote(`Renewed ${out.renewed?.length ?? 0} role(s) for the next moon.`);
    await load();
  }

  if (!cards.length && !items.length && !filedCount && !todo.length) return null;
  return (
    <section aria-labelledby="rco-h" className="space-y-4">
      {cards.map((c) => (
        <div key={c.assignmentId} className="rounded-xl border border-stone-300 bg-white p-4">
          <h2 id="rco-h" className="text-xl font-bold text-stone-900">
            {CARRY_ON_QUESTION}
          </h2>
          <p className="mt-1 text-stone-700">
            {c.roleName} runs to {day(c.termEndsAt)}. Carrying on takes it to {day(c.nextTermEndsAt)}. Nothing renews on its own.
          </p>
          <label className="mt-3 block text-sm font-medium text-stone-800" htmlFor={`rco-${c.assignmentId}`}>
            What you will contribute next moon
          </label>
          <textarea
            id={`rco-${c.assignmentId}`}
            className="mt-1 w-full rounded-md border border-stone-400 p-2 text-stone-900"
            rows={3}
            maxLength={CONTRIBUTION_MAX}
            defaultValue={c.contribution ?? ""}
            onChange={(e) => setWords((w) => ({ ...w, [c.assignmentId]: e.target.value }))}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void file(c)} className="rounded-md bg-teal-deep px-4 py-2 font-semibold text-white">
              {c.filed ? "Update what I will contribute" : "Carry on"}
            </button>
            {c.filed && (
              <>
                <span role="status" className="text-sm text-stone-800">Filed. The village renews filed roles together.</span>
                <button type="button" onClick={() => void takeBack(c)} className="text-sm underline text-stone-800">
                  Take it back
                </button>
              </>
            )}
          </div>
          {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
        </div>
      ))}
      {filedCount ? (
        <div className="rounded-xl border border-stone-300 bg-white p-4">
          <h2 className="text-xl font-bold text-stone-900">Roles carrying on into the next moon</h2>
          <p className="mt-1 text-stone-700">{filedCount} filed. One action renews every filed role for the next moon.</p>
          <button type="button" onClick={() => void renewAll()} className="mt-2 rounded-md bg-teal-deep px-4 py-2 font-semibold text-white">
            Renew all filed roles
          </button>
          {renewedNote && <p role="status" className="mt-2 text-sm text-stone-800">{renewedNote}</p>}
          {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
        </div>
      ) : null}
      {todo.length > 0 && (
        <div className="rounded-xl border border-stone-300 bg-white p-4">
          <h2 className="text-xl font-bold text-stone-900">Access to give or take back</h2>
          <ul className="mt-2 space-y-2">
            {todo.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 text-stone-800">
                <span>
                  {t.kind === "grant" ? "Give" : "Take back"}: {t.label}
                </span>
                <span className="flex gap-3">
                  <button type="button" className="font-semibold underline" onClick={() => void mark(t.id, "done")}>
                    Done
                  </button>
                  <button type="button" className="underline" onClick={() => void mark(t.id, "not_needed")}>
                    Not needed
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {items.length > 0 && (
        <div className="rounded-xl border border-stone-300 bg-white p-4">
          <h2 className="text-xl font-bold text-stone-900">Your access</h2>
          <ul className="mt-2 space-y-1">
            {items.map((i) => (
              <li key={i.id} className="flex justify-between gap-3 text-stone-800">
                <span>{i.label}</span>
                <span className="font-medium">{STATE_WORDS[i.state]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
