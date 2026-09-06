import { gameFetch, QuestClaim } from "@/lib/gameApi";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, Send, Sparkles } from "lucide-react";
import Celebration from "@/components/natural/Celebration";
import { useCountUp, useMomentWindow } from "@/components/natural/moments";
import { claimMoment } from "@/lib/celebrated";
import { formatTokenAmount } from "@/lib/tokenAmount";
import { playMoment } from "@/lib/sound";

// questIdFromTitle is gone (S10): quest ids are REAL server references now.
// Deriving ids from titles meant a rename silently orphaned every claim.

/**
 * THE REWARD MOMENT: a quest consented, which is the emotional peak of the
 * whole game and shipped as a static green span.
 *
 * It is `moment` intensity, the rationed one. A member consents a handful of
 * quests a season and every one of them is a piece of real work somebody else
 * agreed was worth releasing value for, so this is exactly the event the
 * budget was reserved for. Seeds on the wind: the work leaves and lands
 * somewhere.
 *
 * ONCE, EVER. `claimMoment` is checked before anything plays, keyed on the
 * claim id, so the celebration belongs to the consent and not to the mount.
 * Coming back to the quest page next week shows the settled line.
 *
 * WHAT THE NUMBER IS. `credited` is what the ledger moved; `amount` is what
 * the witness granted. They differ only when a standing badge multiplied the
 * grant, and when they do, both are named. The old line printed `amount`
 * alone, which under-reported every badge holder's payout.
 *
 * IT NEVER BLOCKS. The drawing is `pointer-events: none` and absolutely
 * positioned, so the row below stays clickable while it plays and the layout
 * does not move underneath a thumb.
 */
function ConsentedReward({ claim, decimals }: { claim: QuestClaim; decimals: number }) {
  const granted = claim.amount ?? 0;
  const credited = claim.credited ?? granted;
  const bonus = credited - granted;
  /*
   * WHAT SCALE THESE NUMBERS ARE IN. A quest pays the recognition token, and
   * both `amount` and `credited` are ledger figures, so they are MINOR units
   * like every other row. GameDashboard divides that same token's balance
   * through this same formatter and ProfileJourney divides its ledger lines,
   * so the biggest green number in the game was the one contradicting them.
   *
   * `seed` stays the raw INT deliberately: it picks which drawing plays and is
   * never read as a quantity.
   */
  const show = (n: number) => formatTokenAmount(n, decimals);
  // Read once on mount: claiming the moment IS the check, so a re-render can
  // never re-open it, and two mounted copies cannot both play it.
  const [fresh] = useState(() => claimMoment(`quest:${claim.id}`));
  const showing = useMomentWindow(fresh);
  const shown = useCountUp(credited, fresh);

  useEffect(() => {
    if (fresh) playMoment("quest_complete", "confirm");
  }, [fresh]);

  return (
    /* The right gutter is CONSTANT, not conditional. The seeds are drawn over
       it, and padding that appeared with them would reflow the sentence
       underneath twice: once when the moment opens and again when it closes.
       A few empty pixels beside a status line cost nothing; text jumping
       under someone's eyes costs the sentence. */
    <div className="relative pr-24">
      {/* pointer-events-none on the WRAPPER. The kit sets it on
          `.nat-celebrate` itself, which is one element further in: a
          positioned wrapper without it is still hit-testable, and a hit test
          proved it was swallowing clicks on the row underneath. */}
      {showing && (
        <span className="absolute right-0 -top-3 z-10 pointer-events-none">
          <Celebration
            kind="seeds"
            intensity="moment"
            size={88}
            seed={granted}
            message={`Your quest was consented. ${show(credited)} released.`}
          />
        </span>
      )}
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
        <CheckCircle2 className="w-4 h-4" /> Completed{credited ? ` · +${show(shown)}` : ""}
      </span>
      {/* The bonus is information, so it stays after the drawing has gone. A
          badge holder was previously told the pre-multiplier grant and never
          saw the rest of what landed. */}
      {bonus > 0 && (
        <p className="text-xs text-emerald-800 mt-1">
          {show(granted)} granted, and {show(bonus)} more for a standing badge you hold.
        </p>
      )}
    </div>
  );
}

export default function QuestActions({
  questId,
  signedIn,
  claim,
  decimals = 0,
  onChanged,
}: {
  questId: string;
  signedIn: boolean;
  claim: QuestClaim | undefined;
  /**
   * The recognition token's scale, from `/api/game/me`'s `gratitude.decimals`.
   * Defaults to 0, which is what every token in the registry carried before
   * Voice and what an unanswered payload honestly means.
   */
  decimals?: number;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [artifactUrl, setArtifactUrl] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  // This is the conversion CTA for every signed-out visitor on the quests
  // board — it was a 17px tap target, under WCAG 2.5.8's 24px floor and well
  // under a comfortable thumb. Now a full-width 44px row.
  if (!signedIn) {
    return (
      <div className="px-6 py-1 border-t border-border">
        <Link
          href="/register"
          className="flex items-center min-h-[44px] text-sm font-semibold text-teal-deep hover:text-teal transition-colors"
        >
          Sign in to claim this quest
        </Link>
      </div>
    );
  }

  const doClaim = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await gameFetch(`/api/game/quests/${questId}/claim`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.message ?? d.error ?? "Could not claim");
      } else {
        onChanged();
      }
    } catch {
      setError("Could not claim. Try again.");
    }
    setBusy(false);
  };

  const doSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await gameFetch(`/api/game/quests/${questId}/submit`, {
        method: "POST",
        body: JSON.stringify({ artifactUrl, note }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.message ?? d.error ?? "Could not submit");
      } else {
        setShowSubmit(false);
        onChanged();
      }
    } catch {
      setError("Could not submit. Try again.");
    }
    setBusy(false);
  };

  return (
    <div className="px-6 py-3 border-t border-border">
      {!claim || claim.status === "declined" ? (
        <button
          onClick={doClaim}
          disabled={busy}
          className="inline-flex items-center gap-2 text-sm font-semibold bg-teal-deep text-white px-4 py-2 rounded-lg hover:bg-teal disabled:opacity-50 transition-colors pointer-coarse:min-h-11"
        >
          <Sparkles className="w-4 h-4" /> {busy ? "Claiming..." : "Claim this quest"}
        </button>
      ) : claim.status === "claimed" ? (
        showSubmit ? (
          <form onSubmit={doSubmit} className="space-y-2">
            <input
              type="url"
              value={artifactUrl}
              onChange={(e) => setArtifactUrl(e.target.value)}
              placeholder="Link to your work (photo, doc...)"
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg outline-none focus:border-teal-deep"
            />
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="A few words about what you did"
              rows={2}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg outline-none focus:border-teal-deep resize-y"
            />
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 text-sm font-semibold bg-teal-deep text-white px-3 py-1.5 rounded-lg hover:bg-teal disabled:opacity-50 transition-colors pointer-coarse:min-h-11">
                <Send className="w-3.5 h-3.5" /> Submit
              </button>
              <button type="button" onClick={() => setShowSubmit(false)} className="text-sm text-muted-foreground px-2 pointer-coarse:min-h-11 pointer-coarse:px-3">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setShowSubmit(true)}
            className="inline-flex items-center gap-2 text-sm font-semibold bg-amber text-foreground px-4 py-2 rounded-lg hover:bg-amber/90 transition-colors pointer-coarse:min-h-11"
          >
            <Send className="w-4 h-4" /> Submit your work
          </button>
        )
      ) : claim.status === "submitted" ? (
        <span className="inline-flex items-center gap-2 text-sm font-medium text-blue-700">
          <Send className="w-4 h-4" /> Submitted, awaiting circle consent
        </span>
      ) : (
        <ConsentedReward claim={claim} decimals={decimals} />
      )}
      {/* role="alert": claiming, submitting and abandoning a quest all
          report their refusal here, and it is the only report. Without the
          role a member using a screen reader presses Claim, hears nothing,
          and has no way to learn the quest was already taken. */}
      {error && <p role="alert" className="text-xs text-red-600 mt-1.5">{error}</p>}
    </div>
  );
}
