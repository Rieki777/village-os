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
import { Trans, useLingui } from "@lingui/react/macro";
import { authToken } from "@/lib/gameApi";
import { CONTRIBUTION_MAX } from "@shared/moonRenewal";

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

const hdrs = (): Record<string, string> => {
  const t = authToken();
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
};
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" });

const box = "rounded-xl border border-border bg-card p-4";
const primary = "rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground";

export default function RoleCarryOn() {
  const { t } = useLingui();
  const [cards, setCards] = useState<Card[]>([]);
  const [items, setItems] = useState<AccessItem[]>([]);
  const [words, setWords] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  // Only a holder of the power to fill roles is answered; for everyone else this stays null.
  const [filedCount, setFiledCount] = useState<number | null>(null);
  const [todo, setTodo] = useState<Array<{ id: string; kind: "grant" | "revoke"; label: string }>>([]);
  const [renewedNote, setRenewedNote] = useState("");

  const stateWords = {
    open: t`Waiting to be given`,
    done: t({ message: "Given", context: "role access state" }),
    not_needed: t({ message: "Not needed", context: "role access state" }),
  } as const;

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        fetch("/api/me/role-renewals", { headers: hdrs() }).then((r) => (r.ok ? r.json() : { cards: [] })),
        fetch("/api/me/role-access", { headers: hdrs() }).then((r) => (r.ok ? r.json() : { items: [] })),
      ]);
      setCards(Array.isArray(a.cards) ? a.cards : []);
      setItems(Array.isArray(b.items) ? b.items : []);
      const tk = await fetch("/api/role-access-tasks", { headers: hdrs() });
      setTodo(tk.ok ? ((await tk.json()).tasks ?? []) : []);
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
    if (!res.ok) setError((await res.json().catch(() => null))?.error ?? t`That did not save. Try again.`);
    await load();
  }
  async function takeBack(c: Card) {
    const res = await fetch(`/api/me/role-renewals/${encodeURIComponent(c.assignmentId)}`, { method: "DELETE", headers: hdrs() });
    if (!res.ok) setError(t`That did not work. Try again.`);
    await load();
  }
  async function mark(id: string, state: "done" | "not_needed") {
    const res = await fetch(`/api/role-access-tasks/${encodeURIComponent(id)}`, { method: "POST", headers: hdrs(), body: JSON.stringify({ state }) });
    if (!res.ok) setError(t`That did not work. Try again.`);
    await load();
  }
  async function renewAll() {
    setError("");
    const res = await fetch("/api/admin/role-renewals/renew-all", { method: "POST", headers: hdrs(), body: "{}" });
    const out = await res.json().catch(() => null);
    if (!res.ok) setError(out?.error ?? t`That did not work. Try again.`);
    else setRenewedNote(t`Renewed ${out.renewed?.length ?? 0} role(s) for the next moon.`);
    await load();
  }

  if (!cards.length && !items.length && !filedCount && !todo.length) return null;
  return (
    <section aria-labelledby="rco-h" className="space-y-4">
      {cards.map((c) => (
        <div key={c.assignmentId} className={box}>
          <h2 id="rco-h" className="text-xl font-bold text-foreground">
            <Trans>Carry on into the next moon?</Trans>
          </h2>
          <p className="mt-1 text-muted-foreground">
            <Trans>
              {c.roleName} runs to {day(c.termEndsAt)}. Carrying on takes it to {day(c.nextTermEndsAt)}. Nothing renews on its own.
            </Trans>
          </p>
          <label className="mt-3 block text-sm font-medium text-foreground" htmlFor={`rco-${c.assignmentId}`}>
            <Trans>What you will contribute next moon</Trans>
          </label>
          <textarea
            id={`rco-${c.assignmentId}`}
            className="mt-1 w-full rounded-md border border-border bg-background p-2 text-foreground"
            rows={3}
            maxLength={CONTRIBUTION_MAX}
            defaultValue={c.contribution ?? ""}
            onChange={(e) => setWords((w) => ({ ...w, [c.assignmentId]: e.target.value }))}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void file(c)} className={primary}>
              {c.filed ? t`Update what I will contribute` : t({ message: "Carry on", context: "moon renewal action" })}
            </button>
            {c.filed && (
              <>
                <span role="status" className="text-sm text-foreground">
                  <Trans>Filed. The village renews filed roles together.</Trans>
                </span>
                <button type="button" onClick={() => void takeBack(c)} className="text-sm text-foreground underline">
                  <Trans context="moon renewal action">Take it back</Trans>
                </button>
              </>
            )}
          </div>
        </div>
      ))}
      {filedCount ? (
        <div className={box}>
          <h2 className="text-xl font-bold text-foreground">
            <Trans>Roles carrying on into the next moon</Trans>
          </h2>
          <p className="mt-1 text-muted-foreground">
            <Trans>{filedCount} filed. One action renews every filed role for the next moon.</Trans>
          </p>
          <button type="button" onClick={() => void renewAll()} className={`mt-2 ${primary}`}>
            <Trans>Renew all filed roles</Trans>
          </button>
          {renewedNote && (
            <p role="status" className="mt-2 text-sm text-foreground">
              {renewedNote}
            </p>
          )}
        </div>
      ) : null}
      {todo.length > 0 && (
        <div className={box}>
          <h2 className="text-xl font-bold text-foreground">
            <Trans>Access to give or take back</Trans>
          </h2>
          <ul className="mt-2 space-y-2">
            {todo.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 text-foreground">
                <span>{x.kind === "grant" ? t({ message: `Give: ${x.label}`, context: "role access task" }) : t({ message: `Take back: ${x.label}`, context: "role access task" })}</span>
                <span className="flex gap-3">
                  <button type="button" className="font-semibold underline" onClick={() => void mark(x.id, "done")}>
                    <Trans context="role access action">Done</Trans>
                  </button>
                  <button type="button" className="underline" onClick={() => void mark(x.id, "not_needed")}>
                    <Trans context="role access action">Not needed</Trans>
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {items.length > 0 && (
        <div className={box}>
          <h2 className="text-xl font-bold text-foreground">
            <Trans context="role access heading">Your access</Trans>
          </h2>
          <ul className="mt-2 space-y-1">
            {items.map((i) => (
              <li key={i.id} className="flex justify-between gap-3 text-foreground">
                <span>{i.label}</span>
                <span className="font-medium">{stateWords[i.state]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
