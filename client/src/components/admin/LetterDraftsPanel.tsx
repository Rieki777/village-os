/**
 * DRAFTED LETTERS, on the Players tab beside the agent accounts (role journey L13).
 * The connector drafts a first reply or a decision letter into a queue and
 * sends nothing. Here a person reads it, changes the subject and the words,
 * and presses Send, or discards it. Sending goes through the village's mail
 * door and an address on the suppression list gets nothing, which the screen
 * says. It rides the agent panel's chunk, so the tab's first page carries none
 * of it. Light-only, like the rest of the admin tabs.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Trans, useLingui } from "@lingui/react/macro";
import { API_BASE, authHeaders, refusal } from "./adminApi";

interface Letter {
  id: string;
  kind: "first_reply" | "decision";
  subject: string;
  body: string;
  applicationRef: string | null;
  to: { email: string; name: string | null } | null;
  suppressed: boolean;
}

const field = "w-full rounded-md border border-border bg-white px-2 py-1 text-sm text-foreground";
const primary = "min-h-9 rounded-md bg-teal-deep px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60";
const button = "min-h-9 rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-60";

export default function LetterDraftsPanel({ password }: { password: string }) {
  const { t } = useLingui();
  const [letters, setLetters] = useState<Letter[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [edits, setEdits] = useState<Record<string, { subject: string; body: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/admin/letter-drafts`, { headers: authHeaders(password) });
      if (!r.ok) throw new Error("read failed");
      const d = (await r.json()) as { letters: Letter[] };
      setLetters(d.letters);
      setEdits({});
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [password]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (l: Letter, what: "save" | "send" | "discard") => {
    setBusy(l.id);
    try {
      const e = edits[l.id] ?? { subject: l.subject, body: l.body };
      const id = encodeURIComponent(l.id);
      // Sending reads what the person sees: any edit is saved first, so the letter that goes is the one on screen.
      if (what === "save" || (what === "send" && (e.subject !== l.subject || e.body !== l.body))) {
        const s = await fetch(`${API_BASE}/admin/letter-drafts/${id}`, {
          method: "PUT",
          headers: authHeaders(password, { "Content-Type": "application/json" }),
          body: JSON.stringify({ subject: e.subject, body: e.body }),
        });
        if (!s.ok) {
          toast.error(refusal(await s.json().catch(() => ({})), t`That could not be saved`));
          return;
        }
        if (what === "save") {
          toast.success(t`Saved. Nothing was sent.`);
          await load();
          return;
        }
      }
      if (what === "discard") {
        const r = await fetch(`${API_BASE}/admin/letter-drafts/${id}/discard`, { method: "POST", headers: authHeaders(password) });
        if (!r.ok) toast.error(refusal(await r.json().catch(() => ({})), t`That could not be discarded`));
        await load();
        return;
      }
      const r = await fetch(`${API_BASE}/admin/letter-drafts/${id}/send`, { method: "POST", headers: authHeaders(password) });
      if (!r.ok) {
        toast.error(refusal(await r.json().catch(() => ({})), t`That could not be sent`));
      } else {
        toast.success(t({ message: `Sent`, context: "drafted letters" }));
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (failed) {
    return (
      <p className="text-sm text-muted-foreground">
        <Trans>The drafted letters could not be read. Reload to try again.</Trans>
      </p>
    );
  }
  if (!letters) return null;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-white p-4" aria-label={t({ message: `Drafted letters`, context: "drafted letters" })}>
      <p className="text-sm font-semibold text-foreground">
        <Trans context="drafted letters">Drafted letters</Trans>
      </p>
      <p className="text-sm text-muted-foreground">
        <Trans>An agent drafted these and sent nothing. Read each one, change what you like, and send it or discard it.</Trans>
      </p>
      {letters.length === 0 && (
        <p className="text-sm text-muted-foreground">
          <Trans>No letters are waiting.</Trans>
        </p>
      )}
      {letters.map((l) => {
        const e = edits[l.id] ?? { subject: l.subject, body: l.body };
        const cannotSend = !l.to || l.suppressed;
        return (
          <div key={l.id} className="space-y-2 border-t border-border pt-3" data-testid={`letter-${l.id}`}>
            <p className="text-xs text-muted-foreground">
              {l.kind === "first_reply" ? <Trans context="drafted letters">First reply</Trans> : <Trans context="drafted letters">Decision letter</Trans>}
              {" · "}
              {l.to ? l.to.email : <Trans>No address on this application</Trans>}
            </p>
            {l.suppressed && (
              <p className="text-sm text-foreground">
                <Trans>This address is on the suppression list, so nothing can be sent. Discard the letter, or reach the applicant another way.</Trans>
              </p>
            )}
            <label className="block text-sm text-foreground">
              <Trans context="drafted letters">Subject</Trans>
              <input className={field} value={e.subject} maxLength={160} onChange={(x) => setEdits((all) => ({ ...all, [l.id]: { ...e, subject: x.target.value } }))} />
            </label>
            <label className="block text-sm text-foreground">
              <Trans context="drafted letters">Letter</Trans>
              <textarea className={field} rows={9} value={e.body} maxLength={6000} onChange={(x) => setEdits((all) => ({ ...all, [l.id]: { ...e, body: x.target.value } }))} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primary} disabled={busy === l.id || cannotSend} onClick={() => void act(l, "send")}>
                <Trans context="drafted letters">Send</Trans>
              </button>
              <button type="button" className={button} disabled={busy === l.id} onClick={() => void act(l, "save")}>
                <Trans context="drafted letters">Save changes</Trans>
              </button>
              <button type="button" className={button} disabled={busy === l.id} onClick={() => void act(l, "discard")}>
                <Trans context="drafted letters">Discard</Trans>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
