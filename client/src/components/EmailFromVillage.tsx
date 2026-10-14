/**
 * "Email from the village": a member's own switches for the village's
 * gathering reminders, path emails and letters, inside their notification
 * settings (the comms build spec 5.4 and 6).
 *
 * The notification emails themselves keep the switches above this section in
 * NotifyPrefsPanel, unchanged: they follow `users.prefs` exactly as before.
 * These three are the address book's answers, read and written through
 * `/api/comms/me` as the member, so a change here is recorded on the basis of
 * the account (`account`), and letters need no confirming email: the account
 * is the proof.
 *
 * The full page (a pause, stop everything, start again) is one link away, on
 * a fresh signed link the server hands back with the answers.
 *
 * Every switch follows the server's answer and never leads it: a refusal puts
 * nothing on screen that the village does not hold, and says why beside it.
 */
import { useEffect, useState } from "react";
import { authToken } from "@/lib/gameApi";
import { KIND_WORDS, type KindView, type PreferencesView } from "@shared/comms/preferences";
import type { PermissionKind } from "@shared/comms/kinds";

/** The kinds this section offers. Notification emails have their own switches above. */
const SHOWN: readonly PermissionKind[] = ["events", "paths", "letters"];

export default function EmailFromVillage() {
  const [view, setView] = useState<PreferencesView | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const headers = () => ({ Authorization: `Bearer ${authToken()}`, "Content-Type": "application/json" });

  useEffect(() => {
    fetch("/api/comms/me", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.view) return;
        setView(d.view);
        setLink(typeof d.preferencesToken === "string" ? `/email/preferences?t=${encodeURIComponent(d.preferencesToken)}` : null);
      })
      .catch(() => {});
  }, []);

  const save = async (kind: PermissionKind, on: boolean) => {
    setBusy(true);
    setNote("");
    const res = await fetch("/api/comms/me", { method: "PUT", headers: headers(), body: JSON.stringify({ kind, on }) }).catch(
      () => null,
    );
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res?.ok || !body?.view) {
      setNote(`${String(body?.error ?? "That did not reach the village.")} This setting is unchanged.`);
      return;
    }
    setView(body.view);
    if (body.notice) setNote(String(body.notice));
  };

  if (!view) return null;
  const kinds = SHOWN.map((k) => view.kinds.find((v) => v.kind === k)).filter((k): k is KindView => Boolean(k));
  const quiet = view.stopped || view.blocked;
  return (
    <section aria-labelledby="email-from-village" className="border-t border-border pt-4 mb-4">
      <h3 id="email-from-village" className="text-sm font-semibold text-card-foreground mb-2">
        Email from the village
      </h3>
      {quiet ? (
        <p className="text-xs text-muted-foreground mb-2">
          {view.blocked ? view.blocked.sentence : "You asked us to stop every email to this address."}
        </p>
      ) : (
        <div className="space-y-1 mb-2">
          {kinds.map((k) => (
            <label key={k.kind} className="flex min-h-11 items-start gap-3 text-sm text-card-foreground">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                checked={k.on}
                disabled={busy || !k.changeable}
                aria-describedby={`email-kind-${k.kind}`}
                onChange={(e) => void save(k.kind, e.target.checked)}
              />
              <span>
                {KIND_WORDS[k.kind].label}
                <span id={`email-kind-${k.kind}`} className="block text-xs text-muted-foreground">
                  {KIND_WORDS[k.kind].description}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
      {note && (
        <p role="status" className="text-xs text-muted-foreground mb-2">
          {note}
        </p>
      )}
      {link && (
        <a href={link} className="text-sm text-foreground underline underline-offset-2">
          {view.stopped ? "Start your email again" : view.blocked ? "Your email choices" : "Every kind of email, a pause, and stop everything"}
        </a>
      )}
    </section>
  );
}
