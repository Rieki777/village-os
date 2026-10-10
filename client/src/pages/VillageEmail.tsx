/**
 * HOW THE VILLAGE EMAILS (the comms build spec 5.13, ruling 2026-09-25: the
 * dials are visible and proposable). Every journey with whether it is on, its
 * steps and their timing, each email's words as the village sends them, and
 * the comms dials. Read-only: nothing on this page changes the village's
 * email. Every item has a "Propose a change" door, and where it leads is
 * decided in shared/comms/memberView.ts: an open dial goes to the Game
 * Mechanics page, where the village votes on dials, and everything else is
 * filed for the people who run the village's email.
 *
 * Reached from the Game Mechanics page, beside the dials it explains. A
 * member's page, so semantic tokens throughout and the theme the village chose.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import Layout from "@/components/Layout";
import { authToken } from "@/lib/gameApi";
import {
  dialLink,
  PROPOSAL_LIMITS,
  type MemberCommsView,
  type MemberDialView,
  type MemberEmailView,
  type ProposeTarget,
} from "@shared/comms/memberView";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

interface Door {
  target: ProposeTarget;
  key: string;
  step?: string | null;
  /** What the change is about, in the words the page shows. */
  about: string;
}

/** The door itself: a button that opens a short form, and the answer once it is sent. */
function ProposeDoor({ door }: { door: Door }) {
  const [open, setOpen] = useState(false);
  const [change, setChange] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async () => {
    setBusy(true);
    setSaid(null);
    try {
      const res = await fetch("/api/comms/village/propose", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ target: door.target, key: door.key, step: door.step ?? null, change }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaid({ ok: false, text: typeof body?.error === "string" ? body.error : "That didn't send. Try again." });
        return;
      }
      setSaid({ ok: true, text: "Sent. The people who run the village's email will read it." });
      setChange("");
      setOpen(false);
    } catch {
      setSaid({ ok: false, text: "That didn't send. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2">
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="text-sm text-primary underline underline-offset-2">
          Propose a change
        </button>
      )}
      {open && (
        <div className="space-y-2">
          <label className="block text-sm text-card-foreground">
            What would you change about {door.about}?
            <textarea
              value={change}
              onChange={(e) => setChange(e.target.value)}
              maxLength={PROPOSAL_LIMITS.max}
              rows={3}
              className="mt-1 block w-full rounded-xl border border-border bg-background p-2 text-sm"
            />
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={send}
              disabled={busy || change.trim().length < PROPOSAL_LIMITS.min}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              Send the proposal
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted-foreground underline underline-offset-2">
              Cancel
            </button>
          </div>
        </div>
      )}
      {said && (
        <p role="status" className={`text-sm mt-1 ${said.ok ? "text-card-foreground" : "text-destructive"}`}>
          {said.text}
        </p>
      )}
    </div>
  );
}

/** One email's words, folded until the reader opens it. */
function EmailWords({ email }: { email: MemberEmailView }) {
  return (
    <details className="rounded-xl border border-border bg-muted p-3">
      <summary className="cursor-pointer text-sm font-medium text-card-foreground">
        {email.label}: {email.subject}
      </summary>
      <p className="text-xs text-muted-foreground mt-2">Preview line: {email.preheader}</p>
      <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm text-card-foreground">{email.text}</pre>
      <ProposeDoor door={{ target: "words", key: email.templateKey, about: `the email "${email.subject}"` }} />
    </details>
  );
}

function DialRow({ dial }: { dial: MemberDialView }) {
  const shown = (v: string) => (dial.unit ? `${v} ${dial.unit}` : v);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-sm font-medium text-card-foreground">{dial.label}</span>
        <span className="text-sm text-card-foreground">
          {shown(dial.value)}
          {!dial.isDefault && <span className="ml-2 text-xs text-muted-foreground">default {shown(dial.defaultValue)}</span>}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{dial.description}</p>
      {dial.door === "mechanics" ? (
        <Link href={dialLink(dial.key)} className="mt-2 inline-block text-sm text-primary underline underline-offset-2">
          Propose a change
        </Link>
      ) : (
        <ProposeDoor door={{ target: "dial", key: dial.key, about: dial.label.toLowerCase() }} />
      )}
    </li>
  );
}

export default function VillageEmail() {
  const [view, setView] = useState<MemberCommsView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/comms/village", { headers: headers() });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) return setFailed("Sign in to see how the village emails.");
      if (res.status === 404) return setFailed("The village's email isn't running yet.");
      if (!res.ok) return setFailed(typeof body?.error === "string" ? body.error : "This page didn't load. Reload to try again.");
      setView(body as MemberCommsView);
    } catch {
      setFailed("This page didn't load. Reload to try again.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Layout>
      <section className="py-12 sm:py-16 bg-background min-h-[60vh]">
        <div className="container px-4 max-w-3xl mx-auto">
          <h1 className="font-display text-2xl font-bold text-card-foreground mb-2">How the village emails</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Every email the village sends, and when. Open any of them to read its words, and propose a change.
          </p>
          {failed && <p className="text-sm text-destructive">{failed}</p>}
          {!view && !failed && <p className="text-sm text-muted-foreground">Loading.</p>}
          {view && (
            <div className="space-y-10">
              <section aria-labelledby="journeys-heading">
                <h2 id="journeys-heading" className="font-display text-xl font-semibold text-card-foreground mb-3">
                  Journeys
                </h2>
                <div className="space-y-4">
                  {view.journeys.map((j) => (
                    <article key={j.key} className="bg-card border border-border rounded-2xl p-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 className="text-base font-semibold text-card-foreground">{j.title}</h3>
                        <span className="text-xs font-medium text-muted-foreground">{j.state === "on" ? "On" : "Off"}</span>
                      </div>
                      <ol className="mt-3 space-y-3">
                        {j.steps.map((s) => (
                          <li key={s.key}>
                            <p className="text-sm text-card-foreground">
                              <span className="font-medium">{s.timing}</span>: {s.label}
                            </p>
                            {s.skipIf.length > 0 && <p className="text-xs text-muted-foreground">Waits or skips when: {s.skipIf.join("; ")}</p>}
                            {s.email ? (
                              <div className="mt-1">
                                <EmailWords email={s.email} />
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">This email's words didn't load.</p>
                            )}
                            <ProposeDoor door={{ target: "step", key: j.key, step: s.key, about: `when "${s.label}" goes` }} />
                          </li>
                        ))}
                      </ol>
                      {j.stops.length > 0 && <p className="text-xs text-muted-foreground mt-3">Ends when: {j.stops.join("; ")}</p>}
                      <ProposeDoor door={{ target: "journey", key: j.key, about: `the ${j.title} journey` }} />
                    </article>
                  ))}
                </div>
              </section>

              <section aria-labelledby="others-heading">
                <h2 id="others-heading" className="font-display text-xl font-semibold text-card-foreground mb-3">
                  Other emails
                </h2>
                <div className="space-y-4">
                  {view.others.map((g) => (
                    <div key={g.title}>
                      <h3 className="text-sm font-semibold text-card-foreground mb-2">{g.title}</h3>
                      <div className="space-y-2">
                        {g.emails.map((e) => (
                          <EmailWords key={e.templateKey} email={e} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section aria-labelledby="dials-heading">
                <h2 id="dials-heading" className="font-display text-xl font-semibold text-card-foreground mb-1">
                  Dials
                </h2>
                <p className="text-sm text-muted-foreground mb-2">The village votes on most of these on the Game Mechanics page.</p>
                <ul className="divide-y divide-border">
                  {view.dials.map((d) => (
                    <DialRow key={d.key} dial={d} />
                  ))}
                </ul>
              </section>
            </div>
          )}
        </div>
      </section>
    </Layout>
  );
}
