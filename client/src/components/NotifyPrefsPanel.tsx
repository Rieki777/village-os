/**
 * Notification preferences + data rights (S16/S18): cadence choices per
 * event family, the global email switch, and the two Law-8968 surfaces —
 * export everything, or leave and be anonymized.
 */
import { useEffect, useState } from "react";
import { Bell, Download, ShieldOff } from "lucide-react";
import { authToken, clearAuthToken } from "@/lib/gameApi";
import { actionError } from "@/lib/actionOutcome";

const CADENCES: Record<string, Array<{ v: string; label: string }>> = {
  questsEmail: [
    { v: "immediate", label: "Right away" },
    { v: "daily", label: "Daily digest" },
    { v: "off", label: "In-app only" },
  ],
  rolesEmail: [
    { v: "immediate", label: "Right away" },
    { v: "daily", label: "Daily digest" },
    { v: "off", label: "In-app only" },
  ],
  gratitudeEmail: [
    { v: "daily", label: "Daily digest" },
    { v: "off", label: "In-app only" },
  ],
  mentionsEmail: [
    { v: "immediate", label: "Right away" },
    { v: "daily", label: "Daily digest" },
    { v: "off", label: "In-app only" },
  ],
  repliesEmail: [
    { v: "immediate", label: "Right away" },
    { v: "daily", label: "Daily digest" },
    { v: "off", label: "In-app only" },
  ],
  messagesEmail: [
    { v: "immediate", label: "Right away" },
    { v: "daily", label: "Daily digest" },
    { v: "off", label: "In-app only" },
  ],
  governanceEmail: [
    { v: "immediate", label: "Right away" },
    { v: "daily", label: "Daily digest" },
    { v: "off", label: "In-app only" },
  ],
};

const LABELS: Record<string, string> = {
  questsEmail: "Quest decisions",
  rolesEmail: "Role appointments",
  gratitudeEmail: "Appreciation received",
  mentionsEmail: "Someone mentions you",
  repliesEmail: "Replies to your threads",
  messagesEmail: "New messages",
  governanceEmail: "Votes and proposals",
};

export default function NotifyPrefsPanel({ onDeleted }: { onDeleted?: () => void }) {
  const [prefs, setPrefs] = useState<any>(null);
  const [contactable, setContactable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  /**
   * Its own slot, beside the switch it is about. The panel's other `error`
   * lives with the export and delete controls at the foot of the card, and a
   * refused consent change has to be readable where the finger just was.
   */
  const [contactNote, setContactNote] = useState("");
  /**
   * The same slot again, for the switches above the consent one.
   *
   * `saveContactable` was fixed in the sweep and `save` beside it was not, so
   * this card had one control that explained a refusal and six that let the
   * switch snap back and said nothing. A member reading that sees a setting
   * that will not stay put and no reason anywhere on the page.
   */
  const [notifyNote, setNotifyNote] = useState("");
  /** Set only when an outside store did not confirm. Holds the redirect open. */
  const [farewell, setFarewell] = useState("");

  const headers = () => ({ Authorization: `Bearer ${authToken()}`, "Content-Type": "application/json" });

  useEffect(() => {
    fetch("/api/profile/prefs", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPrefs(d?.notify ?? null))
      .catch(() => {});
    fetch("/api/profile", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setContactable(d.contactable !== false); })
      .catch(() => {});
  }, []);

  /*
   * SWEEP (the incomplete loop). This is a CONSENT switch: it decides whether
   * other members may reach you through the relay. It moved the switch first
   * and swallowed every answer, so a member turning contact off saw it turn
   * off, the server never heard, and the messages kept coming with the screen
   * insisting they had opted out.
   *
   * The switch now follows the answer instead of leading it, and a refusal
   * puts it back where it was and says so.
   */
  const saveContactable = async (next: boolean) => {
    setContactNote("");
    const res = await fetch("/api/game/preferences", {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ contactable: next }),
    }).catch(() => null);
    const wrong = actionError({ ok: !!res?.ok, error: null });
    if (wrong) {
      setContactNote(`${wrong} Your contact setting is unchanged.`);
      return;
    }
    setContactable(next);
  };

  const save = (patch: Record<string, any>) => {
    setSaving(true);
    setNotifyNote("");
    fetch("/api/profile/prefs", { method: "PUT", headers: headers(), body: JSON.stringify({ notify: patch }) })
      .then(async (r) => {
        if (!r.ok) {
          // `r.json()` on a refusal hands back the ERROR body, and `d?.notify`
          // is then undefined, so the old code fell back to `prefs` and the
          // switch quietly returned to where it started.
          setNotifyNote("That did not save. These settings are unchanged.");
          return;
        }
        const d = await r.json().catch(() => null);
        setPrefs(d?.notify ?? prefs);
      })
      .catch(() => setNotifyNote("That did not reach the server. These settings are unchanged."))
      .finally(() => setSaving(false));
  };

  const deleteAccount = () => {
    setError("");
    fetch("/api/profile/delete-account", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ password }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.message ?? d.error ?? "Could not delete");
        clearAuthToken();
        onDeleted?.();
        /*
         * A member is never told "deleted" about a store that did not answer.
         *
         * Where a connected service has not confirmed, the redirect waits and
         * the sentence is shown, because a page that vanishes the instant the
         * local scrub finishes would have told this person the whole job was
         * done. Where everything confirmed, nothing changes.
         */
        if (d?.external?.unconfirmed?.length) {
          setFarewell(d.message || "Some connected services have not confirmed yet.");
          return;
        }
        window.location.href = "/";
      })
      .catch((e) => setError(e.message));
  };

  if (!prefs) return null;

  return (
    <div className="bg-card rounded-2xl shadow-lg p-8">
      <div className="flex items-center gap-2 mb-4">
        <Bell className="w-5 h-5 text-notice" />
        <h2 className="font-display text-xl font-bold text-card-foreground">Notifications &amp; your data</h2>
      </div>

      {/* min-h-11 is the TAP TARGET, not decoration: the label is what a finger
          hits, and this row measured 294x20 at 390px. WCAG 2.5.8 asks 24x24 and
          a thumb wants 44. The box grows with it so the check is findable. */}
      <label className="flex min-h-11 items-center gap-3 text-sm text-card-foreground mb-4">
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0"
          checked={!prefs.emailsOff}
          disabled={saving}
          onChange={(e) => save({ emailsOff: !e.target.checked })}
        />
        Email me about village activity
      </label>

      {!prefs.emailsOff && (
        <div className="space-y-2.5 mb-6">
          {Object.keys(LABELS).map((key) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">{LABELS[key]}</span>
              <select
                value={prefs[key]}
                disabled={saving}
                onChange={(e) => save({ [key]: e.target.value })}
                className="text-xs border border-border rounded-lg px-2 py-1.5 bg-card"
              >
                {CADENCES[key].map((c) => (
                  <option key={c.v} value={c.v}>{c.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Nothing to do with email. This is the moment that appears on the page
          when one of the four rare things happens: a stage crossed, a vote
          carried, a cycle settled, a quest consented. The notice itself lands
          in the bell either way, so turning this off loses no information. */}
      <label className="flex items-start gap-2 text-sm text-card-foreground mb-4">
        {/* The toggle names itself; the four moments are a description. A
            wrapping <label> read the whole paragraph as this checkbox's name. */}
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0"
          checked={prefs.celebrations !== "off"}
          disabled={saving}
          aria-label="Mark the rare moments on screen"
          aria-describedby="celebrations-hint"
          onChange={(e) => save({ celebrations: e.target.checked ? "on" : "off" })}
        />
        <span>
          Mark the rare moments on screen
          <span id="celebrations-hint" className="block text-xs text-muted-foreground">
            A stage crossed, a vote carried, a cycle settled, a quest consented. Four things, no sound.
          </span>
        </span>
      </label>

      {notifyNote && <p role="alert" className="text-xs text-destructive mb-4">{notifyNote}</p>}

      {contactable !== null && (
        <div className="mb-4">
          <label className="flex min-h-11 items-center gap-3 text-sm text-card-foreground">
            {/* The setting names the control. The parenthetical says who can
                reach you and how, which is a description, not a name. */}
            <input type="checkbox" className="h-4 w-4 shrink-0" checked={contactable} onChange={(e) => saveContactable(e.target.checked)}
              aria-label="Contactable through the Village Map"
              aria-describedby="contactable-hint" />
            Contactable through the Village Map
            <span id="contactable-hint" className="text-xs text-muted-foreground">(role holders only; senders see a relay, never your email)</span>
          </label>
          {contactNote && <p role="alert" className="text-xs text-destructive mt-1">{contactNote}</p>}
        </div>
      )}

      <div className="border-t border-border pt-4 space-y-3">
        <a
          href="/api/profile/export"
          className="inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-foreground/80"
          onClick={(e) => {
            // Anchor downloads can't carry the auth header; fetch + blob it.
            e.preventDefault();
            setError("");
            fetch("/api/profile/export", { headers: headers() })
              .then((r) => {
                // fetch resolves for 4xx too, so without this check an
                // expired session downloaded a 24-byte {"error":...} file
                // NAMED my-data.json — a member could believe they held
                // their whole record and be holding an error message.
                if (!r.ok) throw new Error("export failed");
                return r.blob();
              })
              .then((b) => {
                const url = URL.createObjectURL(b);
                const a = document.createElement("a");
                a.href = url;
                a.download = "my-data.json";
                a.click();
                URL.revokeObjectURL(url);
              })
              .catch(() => setError("Could not build your export. Please sign in again and retry."));
          }}
        >
          <Download className="w-4 h-4" />
          Download everything the village holds about me
        </a>
        {/* Rendered OUTSIDE the delete-confirmation branch: `error` is shared
            with that flow, and its only renderer used to live in there, so an
            export failure was written to state nothing displayed. */}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

        {farewell ? (
          <div role="status" className="rounded-xl border border-notice/60 bg-muted p-4">
            <p className="text-xs text-notice">{farewell}</p>
            <button
              onClick={() => { window.location.href = "/"; }}
              className="text-sm text-notice underline mt-2"
            >
              I have read this
            </button>
          </div>
        ) : !confirming ? (
          <button
            // Clear a stale export error on the way in, so it cannot appear
            // to be about the deletion the member is now considering.
            onClick={() => { setError(""); setConfirming(true); }}
            className="inline-flex items-center gap-2 text-sm text-destructive hover:text-destructive/80"
          >
            <ShieldOff className="w-4 h-4" />
            Delete my account
          </button>
        ) : (
          <div className="rounded-xl border border-destructive/70 bg-destructive/10 p-4">
            <p className="text-xs text-destructive mb-2">
              This anonymizes you permanently: your name, contact details and profile are
              scrubbed everywhere. The village's shared history (settlements, quest
              records) keeps its numbers, without your name on them. This cannot be undone.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Confirm your password"
                className="text-sm border border-destructive/70 rounded-lg px-3 py-1.5"
              />
              <button onClick={deleteAccount} disabled={!password}
                className="text-sm bg-destructive text-destructive-foreground rounded-lg px-3 py-1.5 font-medium disabled:opacity-40">
                Delete forever
              </button>
              <button onClick={() => { setConfirming(false); setPassword(""); setError(""); }}
                className="text-sm text-muted-foreground">
                Cancel
              </button>
            </div>
            {error && <p role="alert" className="text-xs text-destructive mt-2">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
