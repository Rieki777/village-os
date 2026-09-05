import { authToken, gameFetch, GameMe } from "@/lib/gameApi";
import { useTokenName } from "@/hooks/useTokenNames";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Compass, Heart, Sparkles } from "lucide-react";
import StageAdvanced from "@/components/StageAdvanced";
import { claimMoment } from "@/lib/celebrated";
import { onProfileRefresh } from "@/lib/profileRefresh";
import { formatTokenAmount } from "@/lib/tokenAmount";

const CLAIM_STATUS: Record<string, { label: string; cls: string }> = {
  claimed: { label: "In progress", cls: "bg-notice/10 text-notice" },
  submitted: { label: "Awaiting consent", cls: "bg-open/10 text-open" },
  consented: { label: "Completed", cls: "bg-emerald-100 text-emerald-700" },
  // 4.39:1 at 12px, which is under the 4.5 floor for text this size, and the
  // one chip on the row that has to be read carefully. stone-600 on the same
  // stone-100 measures 7.00:1 and keeps the chip the quietest of the four.
  // Both figures read off the SHIPPED stylesheet in Chromium, not off the
  // token values, because the palette is oklch and the arithmetic is sRGB.
  declined: { label: "Not accepted", cls: "bg-muted text-muted-foreground" },
};

export default function GameDashboard() {
  const [me, setMe] = useState<GameMe | null>(null);
  const currency = useTokenName("Recognition");
  /**
   * The advance to celebrate, or null.
   *
   * Claimed the instant the data lands, and claiming is the check, so a
   * re-render cannot re-open it and a member who crossed this rung last month
   * sees the ladder without the fanfare. The key mirrors the server's own
   * notification dedupe key for the same event, `stage:<member>:<stage>`,
   * with the event's timestamp standing in for the member id because this
   * ledger is per browser.
   */
  const [advance, setAdvance] = useState<GameMe["lastAdvance"]>(null);
  /**
   * "Still coming", "here" and "the request failed" are three different facts.
   *
   * This component used to be `if (!me) return null`, and `fetchGameMe()`
   * answers null for a dropped connection, a 500 and a signed-out reader
   * alike. So one failed read silently deleted the next step, the balance,
   * the sending budget and every quest chip, and the page rendered as though
   * the member had no game state at all. `WalletCard` next door keeps the
   * three apart for exactly this reason, and this is that pattern: the read
   * is done here rather than through `fetchGameMe` because that helper
   * collapses the three into one null before this file can see them.
   */
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  // `quiet` re-reads without blanking the card, which is what a refresh after
  // a write on the same page wants. Only the first read and an explicit Retry
  // show the loading line.
  const load = (quiet = false) => {
    // No token is not a failure, it is a reader who is not signed in. The
    // profile page only mounts this behind a session, so this is the
    // belt-and-braces branch, and it must not paint a Retry button.
    if (!authToken()) {
      setMe(null);
      setStatus("ready");
      return;
    }
    if (!quiet) setStatus("loading");
    gameFetch("/api/game/me")
      .then((r) => {
        if (!r.ok) throw new Error(`game/me ${r.status}`);
        return r.json();
      })
      .then((next: GameMe) => {
        setMe(next);
        setStatus("ready");
        const fresh = next?.lastAdvance;
        if (fresh && claimMoment(`stage:${fresh.toStage}:${fresh.at}`)) setAdvance(fresh);
      })
      .catch(() => setStatus("failed"));
  };

  useEffect(() => {
    load();
  }, []);
  // A write anywhere on the sheet moves the balance and the quest chips, and
  // this card had no way to hear about it. See lib/profileRefresh.ts.
  useEffect(() => onProfileRefresh(() => load(true)), []);

  /*
   * THESE TWO LINES SIT ON THE PAGE, NOT ON A CARD, and the whole file now
   * takes the semantic pair. Measured in Chromium against the built
   * stylesheet: text-muted-foreground 6.98 light / 6.49 dark, text-foreground
   * 16.01 / 14.73.
   *
   * WHAT THIS PARAGRAPH USED TO SAY, AND WHY IT STOPPED BEING TRUE. It read:
   * "every card below is a hardcoded bg-white holding hardcoded text-stone-*,
   * and that pairing is safe because neither half answers to `.dark`". That
   * was correct, and it stayed correct right up until Profile.tsx became a
   * night ground. Then the frozen pair was still internally consistent and was
   * two white slabs on black, which is the second-order trap in full: a frozen
   * pair is safe until the page around it moves, and nothing warns you.
   *
   * It survived three sweeps because all three searched `gray` and `white`.
   * This file's neutral is `stone`, and a whole family can hide behind the
   * wrong noun. What found it was reading the LIVE page and asking which
   * elements carrying `bg-white` were inside `.sheet-night`.
   *
   * `role="status"` makes the arrival of each one audible, which is item 9's
   * requirement for this card: the whole top of the sheet appearing or failing
   * to appear was silent.
   */
  if (status === "loading") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading your next step…
      </p>
    );
  }

  if (status === "failed") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Couldn't load your next step.{" "}
        <button
          type="button"
          onClick={() => load()}
          className="min-h-11 font-medium text-foreground underline underline-offset-2"
        >
          Retry
        </button>
      </p>
    );
  }

  if (!me) return null;

  const activeQuests = me.quests.filter((q) => q.status === "claimed" || q.status === "submitted");
  const doneQuests = me.quests.filter((q) => q.status === "consented");

  return (
    <div className="space-y-6">
      {advance && (
        <StageAdvanced advance={advance} stages={me.stages} onClose={() => setAdvance(null)} />
      )}

      {/* Next best action */}
      <Link
        href={me.nextAction.href}
        className="flex items-center justify-between gap-4 bg-teal-deep text-white rounded-2xl px-6 py-5 shadow-md hover:bg-teal transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Compass className="w-6 h-6 text-amber shrink-0" />
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-white font-semibold">Your next step</p>
            {/* `truncate` cut this banner's own headline: "Continue your community
                  training" needs 294px and the box is 241px at 393px, so a member
                  read "Continue your community tr...". At 320 barely half survived.
                  It is the ONE call to action on the page, so ellipsising it hides
                  the thing the banner exists to say. Two lines is cheaper than a
                  guess. */}
                <p className="font-display text-lg font-semibold leading-snug">{me.nextAction.label}</p>
          </div>
        </div>
        <ArrowRight className="w-5 h-5 shrink-0" />
      </Link>

      {/* The stage ladder used to stand here as "Path of Growth". It moved to
          `components/profile/MaturityLadder.tsx`, which the character sheet
          renders as its own Maturity section. The move IS the fix: the rungs a
          member had not reached were text-stone-400 at 2.52:1, the rung they
          stood on was signalled by background colour with no aria-current, and
          the separator between rungs was a literal middle dot that screen
          readers announce. Drawing it in two places would have meant fixing it
          in two places. */}

      {/* Gratitude + quests */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
          <div className="flex items-center gap-2 mb-3">
            <Heart className="w-5 h-5 text-coral" />
            <h2 className="font-display text-lg font-bold text-card-foreground">{currency}</h2>
          </div>
          {/* Recognition carries decimals 0 today, so this number does not
              move. It divides anyway: this is the biggest number on the
              dashboard, and it is the one a member would quote back. See
              client/src/lib/tokenAmount.ts. */}
          <p className="text-3xl font-display font-bold text-notice mb-1">
            {formatTokenAmount(Number(me.gratitude.balance ?? 0), Number(me.gratitude.decimals ?? 0))}
          </p>
          <p className="text-sm text-muted-foreground mb-4">earned so far</p>
          {me.gratitude.budget.total > 0 && (
            <p className="text-sm text-muted-foreground mb-4">
              Sending budget: <span className="font-semibold">{me.gratitude.budget.remaining}</span> of{" "}
              {me.gratitude.budget.total} left this cycle
            </p>
          )}
          <Link href="/gratitude" className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground underline underline-offset-2 hover:text-notice transition-colors">
            Visit the {currency} Wall <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-5 h-5 text-gold" />
            <h2 className="font-display text-lg font-bold text-card-foreground">Quests</h2>
          </div>
          {me.quests.length === 0 ? (
            <p className="text-sm text-muted-foreground mb-4">You haven't claimed a quest yet.</p>
          ) : (
            <ul className="space-y-2 mb-4">
              {[...activeQuests, ...doneQuests].slice(0, 4).map((q) => (
                <li key={q.id}>
                  {/* Each row opens the quest's own page, the same door the
                      board opens. Submitting and the story both live there, so
                      a member reading their four quests here can reach the one
                      they want in a tap instead of walking back to the board.
                      quest_claims.quest_id is NOT NULL since 0001, so this
                      href always names a real quest. */}
                  <Link
                    href={`/quests/${q.questId}`}
                    className="flex items-center justify-between gap-2 text-sm group"
                  >
                    <span className="text-card-foreground truncate group-hover:text-notice transition-colors">
                      {q.questTitle}
                    </span>
                    <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${CLAIM_STATUS[q.status]?.cls ?? ""}`}>
                      {CLAIM_STATUS[q.status]?.label ?? q.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/quests" className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground underline underline-offset-2 hover:text-notice transition-colors">
            Browse open quests <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
