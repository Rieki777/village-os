/**
 * THE MEMBRANE, ON SOMEBODY'S PROFILE.
 *
 * Every member arrives because somebody already here knew them, and whoever
 * invites is vouching (Rye, 2026-09-08). This is where that is said out loud:
 * how far along somebody is, who has spoken for them, and the one button that
 * adds your name to that list.
 *
 * ── IT DRAWS NOTHING FOR A MEMBER WHO IS ALREADY IN ─────────────────────────
 *
 * A vouch panel on somebody who has been here two years is an offer to do a
 * thing that cannot be done, and the server refuses it by name. Somebody
 * already admitted has no membrane left to cross.
 *
 * ── AND NOTHING WHILE THE ANSWER IS UNKNOWN ─────────────────────────────────
 *
 * Null draws nothing, the same contract every other read on this page holds.
 * A count assembled out of undefined would tell somebody a stranger had two
 * vouches when nobody had asked.
 *
 * ── A REFUSAL IS TEACHING, NOT AN ERROR ─────────────────────────────────────
 *
 * Vouching opens at Contributor, so most people who press this early cannot do
 * it yet, and the server answers with the sentence that says which rung and
 * what reaches it. That sentence is shown as written rather than replaced with
 * "something went wrong", because it is the most useful thing this panel ever
 * says to somebody who has just arrived.
 */
import { useEffect, useState } from "react";
import { HeartHandshake } from "lucide-react";

import { gameFetch } from "@/lib/gameApi";

interface VouchState {
  count: number;
  needed: number;
  met: boolean;
  bySuper: boolean;
  vouchers: string[];
}

export default function VouchPanel({
  handle,
  name,
  alreadyMember,
}: {
  /** The public handle from /profile/:handle. The route resolves either. */
  handle: string;
  name: string;
  /** True when this person is already in, so there is nothing to cross. */
  alreadyMember?: boolean;
}) {
  const [state, setState] = useState<VouchState | null>(null);
  const [sentence, setSentence] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");

  useEffect(() => {
    if (!handle || alreadyMember) return;
    let live = true;
    gameFetch(`/api/members/${encodeURIComponent(handle)}/vouches`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d?.state) return;
        // `isMember` and a met count are different questions: somebody admitted
        // by an old grant holds membership with no vouches at all.
        if (d.isMember) return;
        setState(d.state as VouchState);
        setSentence(String(d.sentence ?? ""));
      })
      .catch(() => {
        /* Unknown draws nothing. */
      });
    return () => {
      live = false;
    };
  }, [handle, alreadyMember]);

  if (alreadyMember || !state || state.met) return null;

  const vouch = async () => {
    if (busy) return;
    setBusy(true);
    setSaid("");
    try {
      const res = await gameFetch(`/api/members/${encodeURIComponent(handle)}/vouch`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // The server's own sentence. It names the rung and what reaches it,
        // which is more useful than anything this component could invent.
        setSaid(String(body?.error ?? "That did not save. Try again in a moment."));
        return;
      }
      if (body?.vouches) setState(body.vouches as VouchState);
      setSentence(String(body?.sentence ?? ""));
      setSaid(body?.admitted ? `${name} is a member now.` : `You vouched for ${name}.`);
    } catch {
      setSaid("That did not save. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <HeartHandshake className="mt-0.5 h-5 w-5 shrink-0 text-notice" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-semibold text-card-foreground">
            Vouching for {name}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{sentence}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            A vouch says you know this person and you would have them here. It cannot be taken
            back, so it is worth meaning.
          </p>
          <button
            type="button"
            onClick={() => void vouch()}
            disabled={busy}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-notice px-4 py-2 font-medium text-background disabled:opacity-60"
          >
            {busy ? "Saving" : `Vouch for ${name}`}
          </button>
          {/* Mounted on every render and empty until there is something to
              say: a live region inserted with its text already in it announces
              nothing to anybody. */}
          <p aria-live="polite" className={said ? "mt-3 text-sm text-foreground" : "sr-only"}>
            {said}
          </p>
        </div>
      </div>
    </section>
  );
}
